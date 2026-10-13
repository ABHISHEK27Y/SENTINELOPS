import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  query: vi.fn(),
  transitionIncident: vi.fn(),
  enqueueEvent: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('@sentinelops/db', () => ({
  ...deps,
  transaction: async (work: () => Promise<unknown>) => work(),
}));
vi.mock('@sentinelops/remediation', async importOriginal => ({
  ...(await importOriginal<object>()),
  FaultApiExecutor: class {
    execute = deps.execute;
  },
}));
import { runRemediationJob } from './remediation-worker.js';

const job = {
  action_id: 'action-a',
  incident_id: 'incident-a',
  phase: 'VERIFY',
  attempts: 0,
  state: {},
  status: 'VERIFYING',
  executed_at: '2026-10-10T10:00:00.000Z',
};
const required = [
  { service_id: 'payment-service', metric: 'error_rate', baseline: 0.01, instance: 'a' },
  {
    service_id: 'payment-service',
    metric: 'http_request_duration_ms',
    baseline: 100,
    instance: 'a',
  },
];

function scenario(
  options: {
    job?: object;
    samples?: Array<object | null>;
    required?: object[];
    status?: string;
  } = {}
) {
  let sampleIndex = 0;
  deps.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM remediation_jobs')) return { rows: [{ ...job, ...options.job }] };
    if (sql.startsWith('SELECT status'))
      return { rows: [{ status: options.status ?? 'VERIFYING' }] };
    if (sql.includes('FROM anomalies')) return { rows: options.required ?? required };
    if (sql.includes('FROM metrics')) {
      const sample = options.samples?.[sampleIndex++];
      return { rows: sample ? [sample] : [] };
    }
    return { rows: [] };
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  deps.transitionIncident.mockResolvedValue(true);
});
describe('durable remediation verification', () => {
  it('freezes the verification cohort before executing the action', async () => {
    scenario({ job: { phase: 'EXECUTE' }, status: 'REMEDIATING' });
    deps.execute.mockResolvedValue({ ok: true, detail: 'fault cleared' });
    await runRemediationJob();
    const update = deps.query.mock.calls.find(call => String(call[0]).includes('SET phase=$2'));
    expect(update?.[1][1]).toBe('VERIFY');
    expect(JSON.parse(update?.[1][2]).required).toEqual(required);
    expect(deps.query.mock.invocationCallOrder[2]).toBeLessThan(
      deps.execute.mock.invocationCallOrder[0]!
    );
  });
  it('uses the saved cohort after restart even if incident anomalies change', async () => {
    scenario({ job: { state: { required } }, required: [], samples: [] });
    await runRemediationJob();
    expect(deps.query.mock.calls.some(call => String(call[0]).includes('FROM anomalies'))).toBe(
      false
    );
    expect(
      deps.query.mock.calls.filter(call => String(call[0]).includes('FROM metrics'))
    ).toHaveLength(2);
    const update = deps.query.mock.calls.find(call => String(call[0]).includes('SET state='));
    expect(JSON.parse(update?.[1][1]).required).toEqual(required);
  });
  it('does not resolve a traffic drop as recovery', async () => {
    scenario({
      job: { state: { consecutive: 1 } },
      required: [
        { service_id: 'payment-service', metric: 'request_rate', baseline: 100, instance: 'a' },
      ],
      samples: [{ value: 0, ts: '2026-10-10T10:00:10Z' }],
    });
    await runRemediationJob();
    expect(deps.transitionIncident).not.toHaveBeenCalled();
    const update = deps.query.mock.calls.find(call => String(call[0]).includes('SET state='));
    expect(JSON.parse(update?.[1][1]).consecutive).toBe(0);
  });
  it('never resolves on missing or partial telemetry', async () => {
    scenario({ samples: [{ value: 0, ts: '2026-10-10T10:00:05Z' }, null] });
    await runRemediationJob();
    expect(deps.transitionIncident).not.toHaveBeenCalled();
    const update = deps.query.mock.calls.find(call => String(call[0]).includes('SET state='));
    expect(JSON.parse(update?.[1][1]).consecutive).toBe(0);
    const metrics = deps.query.mock.calls.filter(call => String(call[0]).includes('FROM metrics'));
    expect(metrics.every(call => String(call[0]).includes("interval '15 seconds'"))).toBe(true);
    expect(metrics[0]?.[1][3]).toBe(job.executed_at);
  });
  it('requires two complete distinct windows and resumes durable progress', async () => {
    scenario({
      job: {
        state: {
          consecutive: 1,
          last: {
            'payment-service|error_rate|a': '2026-10-10T10:00:05.000Z',
            'payment-service|http_request_duration_ms|a': '2026-10-10T10:00:05.000Z',
          },
        },
      },
      samples: [
        { value: 0, ts: '2026-10-10T10:00:10Z' },
        { value: 90, ts: '2026-10-10T10:00:10Z' },
      ],
    });
    await runRemediationJob();
    expect(deps.transitionIncident).toHaveBeenCalledWith(
      'incident-a',
      'RESOLVED',
      expect.any(String),
      'VERIFYING'
    );
    const metrics = deps.query.mock.calls.filter(call => String(call[0]).includes('FROM metrics'));
    expect(metrics.every(call => call[1][3] === '2026-10-10T10:00:05.000Z')).toBe(true);
    expect(deps.enqueueEvent.mock.calls[0]?.[1].payload.actionId).toBe('action-a');
  });
  it('returns to mitigation when telemetry remains absent at the deadline', async () => {
    scenario({ job: { attempts: 23 }, required: [] });
    await runRemediationJob();
    expect(deps.transitionIncident).toHaveBeenCalledWith(
      'incident-a',
      'MITIGATION_REQUIRED',
      expect.any(String),
      'VERIFYING'
    );
  });
  it('records failed execution and returns to mitigation without verifying', async () => {
    scenario({ job: { phase: 'EXECUTE', status: 'REMEDIATING' }, status: 'REMEDIATING' });
    deps.execute.mockResolvedValue({ ok: false, detail: 'HTTP 503' });
    await runRemediationJob();
    expect(deps.transitionIncident).toHaveBeenCalledWith(
      'incident-a',
      'MITIGATION_REQUIRED',
      'HTTP 503',
      'REMEDIATING'
    );
    expect(
      deps.query.mock.calls.some(call => String(call[0]).includes('executed_at=clock_timestamp()'))
    ).toBe(true);
    expect(
      deps.query.mock.calls.find(call => String(call[0]).includes('SET phase=$2'))?.[1][1]
    ).toBe('DONE');
  });
  it('rechecks locked incident status before performing an external action', async () => {
    scenario({ job: { phase: 'EXECUTE' }, status: 'RESOLVED' });
    await runRemediationJob();
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.transitionIncident).not.toHaveBeenCalled();
  });
});
