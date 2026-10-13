import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  transitionIncident: vi.fn(),
  enqueueEvent: vi.fn(),
  demo: false,
}));
vi.mock('@sentinelops/db', () => db);
vi.mock('@sentinelops/config', () => ({
  getEnv: () => ({ DEMO_MODE: db.demo, INTERNAL_API_TOKEN: 'test-internal-token' }),
}));
import { registerRemediationRoutes } from './remediation.js';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
  db.demo = false;
  // Models the incident lock to exercise competing route operations. Live
  // Postgres lock/rollback semantics still require the integration environment.
  let pending = Promise.resolve();
  db.transaction.mockImplementation(work => {
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  });
  let incidentStatus = 'MITIGATION_REQUIRED';
  let actionStatus = 'PROPOSED';
  db.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT incident_id')) return { rows: [{ incident_id: 'incident-a' }] };
    if (sql.startsWith('SELECT status')) return { rows: [{ status: incidentStatus }] };
    if (sql.startsWith('UPDATE remediation_actions')) {
      if (actionStatus !== 'PROPOSED') return { rows: [] };
      actionStatus = String(params[1]);
      return { rows: [{ id: 'action-a', type: 'clear_injected_fault' }] };
    }
    return { rows: [] };
  });
  db.transitionIncident.mockImplementation(async (_id, status) => {
    incidentStatus = status;
    return true;
  });
});

describe('scoped remediation proposals', () => {
  function proposalState(
    options: { missing?: boolean; status?: string; lockedStatus?: string; existing?: object[] } = {}
  ) {
    db.demo = true;
    db.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT status,affected_services')
        ? options.missing
          ? []
          : [
              {
                status: options.status ?? 'IDENTIFIED',
                affected_services: ['payment-service'],
                root_cause: { title: 'payment-service latency' },
              },
            ]
        : sql.startsWith('SELECT status')
          ? [{ status: options.lockedStatus ?? 'IDENTIFIED' }]
          : sql.startsWith('SELECT DISTINCT metric')
            ? [{ metric: 'request_latency_ms' }]
            : sql.includes('FROM remediation_actions')
              ? (options.existing ?? [])
              : sql.includes('INSERT INTO remediation_actions')
                ? [{ id: 'action-a' }]
                : [],
    }));
  }
  async function propose(app: ReturnType<typeof Fastify>, token: string) {
    return app.inject({
      method: 'POST',
      url: '/api/incidents/incident-a/remediate',
      payload: {},
      headers: { authorization: `Bearer ${token}` },
    });
  }
  it('proposes only known scoped faults with human approval and a locked incident transition', async () => {
    proposalState();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ faults: [{ type: 'db_latency' }, { type: 'unrecognized' }] }),
    });
    vi.stubGlobal('fetch', fetch);
    const { app, token } = await harness();
    const response = await propose(app, token);
    expect(response.statusCode).toBe(200);
    expect(response.json().actions).toHaveLength(1);
    expect(response.json().actions[0]).toMatchObject({
      type: 'clear_injected_fault',
      targetService: 'payment-service',
      requiresApproval: true,
      params: { faultType: 'db_latency' },
    });
    expect(fetch.mock.calls[0]?.[1].headers['x-internal-token']).toBe('test-internal-token');
    expect(db.transitionIncident).toHaveBeenCalledWith(
      'incident-a',
      'MITIGATION_REQUIRED',
      expect.any(String),
      'IDENTIFIED'
    );
  });
  it('returns pending proposals without duplicating their rows', async () => {
    proposalState({ existing: [{ id: 'existing-action', type: 'clear_injected_fault' }] });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ faults: [{ type: 'db_latency' }] }) })
    );
    const { app, token } = await harness();
    expect((await propose(app, token)).json().actions[0].id).toBe('existing-action');
    expect(
      db.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO remediation_actions'))
    ).toBe(false);
  });
  it('rejects missing incidents, stale status, absent faults and unreachable fault administration', async () => {
    const { app, token } = await harness();
    proposalState({ missing: true });
    expect((await propose(app, token)).statusCode).toBe(404);
    proposalState({ status: 'RESOLVED' });
    expect((await propose(app, token)).statusCode).toBe(409);
    proposalState();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ faults: [] }) });
    vi.stubGlobal('fetch', fetch);
    expect((await propose(app, token)).statusCode).toBe(409);
    fetch.mockResolvedValue({ ok: false });
    expect((await propose(app, token)).statusCode).toBe(502);
    proposalState({ lockedStatus: 'REMEDIATING' });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ faults: [{ type: 'db_latency' }] }) });
    expect((await propose(app, token)).statusCode).toBe(409);
  });
});
async function harness(role = 'ENGINEER') {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'test-secret-approval-at-least-32-characters' });
  registerRemediationRoutes(app);
  const token = app.jwt.sign({ sub: 'user-a', email: 'engineer@example.test', role });
  const approve = () =>
    app.inject({
      method: 'POST',
      url: '/api/remediation/action-a/approve',
      payload: {},
      headers: { authorization: `Bearer ${token}` },
    });
  return { app, token, approve };
}
describe('approval orchestration', () => {
  it('queues exactly one job and audit decision when approvals compete', async () => {
    const { approve } = await harness();
    const responses = await Promise.all([approve(), approve()]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([202, 409]);
    expect(
      db.query.mock.calls.filter(call => String(call[0]).startsWith('INSERT INTO remediation_jobs'))
    ).toHaveLength(1);
    expect(
      db.query.mock.calls.filter(call =>
        String(call[0]).startsWith('INSERT INTO remediation_approvals')
      )
    ).toHaveLength(1);
    expect(db.transitionIncident).toHaveBeenCalledWith(
      'incident-a',
      'REMEDIATING',
      expect.any(String),
      'MITIGATION_REQUIRED'
    );
  });
  it('rejects viewer mutations before touching storage', async () => {
    const { approve } = await harness('VIEWER');
    expect((await approve()).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('records rejection without scheduling execution', async () => {
    const { app, token, approve } = await harness();
    const result = await app.inject({
      method: 'POST',
      url: '/api/remediation/action-a/reject',
      payload: { reason: 'investigate first' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(result.statusCode).toBe(200);
    expect((await approve()).statusCode).toBe(409);
    const approval = db.query.mock.calls.find(call =>
      String(call[0]).startsWith('INSERT INTO remediation_approvals')
    );
    expect(approval?.[1]).toEqual(['action-a', 'user-a', 'REJECTED', 'investigate first']);
    expect(
      db.query.mock.calls.some(call => String(call[0]).startsWith('INSERT INTO remediation_jobs'))
    ).toBe(false);
  });
  it('validates oversized decision reasons', async () => {
    const { app, token } = await harness();
    const result = await app.inject({
      method: 'POST',
      url: '/api/remediation/action-a/approve',
      payload: { reason: 'x'.repeat(2001) },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(result.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
});
