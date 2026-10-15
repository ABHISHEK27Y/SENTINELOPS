import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockProvider } from '@sentinelops/ai';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  transitionIncident: vi.fn(),
  status: 'DETECTED',
  lockedStatus: '',
  missing: false,
  investigation: null as unknown,
}));
vi.mock('@sentinelops/db', () => ({
  ...db,
  transaction: async (work: () => Promise<unknown>) => work(),
}));
import { registerIncidentRoutes } from './incidents.js';

const apps: ReturnType<typeof Fastify>[] = [];
const retrieved = vi.fn();
const incident = {
  id: 'INC-1',
  title: 'Payment latency',
  severity: 'HIGH',
  affected_services: ['payment-service'],
  root_cause: {
    service: undefined as string | undefined,
    title: 'payment-service degraded',
    confidence: 0.8,
    evidence: [{ summary: 'latency spike' }],
  },
  confidence: 0.8,
  started_at: '2026-10-10T10:00:00Z',
  detected_at: '2026-10-10T10:00:01Z',
  resolved_at: '2026-10-10T10:01:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  incident.title = 'Payment latency';
  incident.root_cause.service = undefined;
  incident.root_cause.title = 'payment-service degraded';
  incident.affected_services = ['payment-service'];
  db.status = 'DETECTED';
  db.lockedStatus = '';
  db.missing = false;
  db.investigation = null;
  retrieved.mockResolvedValue([
    {
      id: 'runbook-a',
      content: 'Inspect pool capacity',
      score: 0.9,
      metadata: { title: 'Pool runbook' },
    },
  ]);
  db.transitionIncident.mockResolvedValue(true);
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith('SELECT status')
      ? [{ status: db.lockedStatus || db.status }]
      : sql.includes('FROM incidents')
        ? db.missing
          ? []
          : [{ ...incident, status: db.status }]
        : sql.includes('FROM anomalies')
          ? [
              {
                service_id: 'payment-service',
                metric: 'request_latency_ms',
                value: 2500,
                baseline: 30,
                anomaly_score: 0.9,
                created_at: incident.detected_at,
              },
            ]
          : sql.includes("kind = 'ai_investigation'")
            ? db.investigation
              ? [{ data: db.investigation }]
              : []
            : sql.includes('FROM incident_events')
              ? [
                  {
                    at: incident.detected_at,
                    kind: 'DETECTED',
                    message: 'latency detected',
                    data: {},
                  },
                ]
              : sql.includes('FROM remediation_actions')
                ? [
                    {
                      type: 'clear_injected_fault',
                      target_service: 'payment-service',
                      status: 'EXECUTED',
                    },
                  ]
                : [],
  }));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});
async function harness(role = 'ENGINEER') {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long' });
  registerIncidentRoutes(app, { size: () => 1, search: retrieved }, new MockProvider());
  return {
    app,
    headers: { authorization: `Bearer ${app.jwt.sign({ role, email: 'operator@example.test' })}` },
  };
}
describe('incident investigation and postmortem API', () => {
  it.each([
    ['order-service', 'order-service'],
    [undefined, 'payment-service'],
    ['unknown', 'unknown'],
  ])('uses structured service %s and only falls back for old rows', async (service, expected) => {
    incident.root_cause.service = service;
    incident.root_cause.title = 'user-service reports errors caused by a dependency';
    const { app, headers } = await harness();
    expect(
      (await app.inject({ method: 'POST', url: '/api/incidents/INC-1/investigate', headers }))
        .statusCode
    ).toBe(200);
    expect(retrieved).toHaveBeenCalledWith(expect.stringMatching(new RegExp(` ${expected}$`)), 3);
  });
  it('shows the current affected-service count for older stored incidents', async () => {
    incident.title = 'Degradation on payment-service (1 service affected)';
    incident.affected_services = ['payment-service', 'order-service', 'api-gateway'];
    const { app, headers } = await harness('VIEWER');
    const list = (await app.inject({ url: '/api/incidents', headers })).json();
    const detail = (await app.inject({ url: '/api/incidents/INC-1', headers })).json();
    expect(list[0].title).toBe('Degradation on payment-service (3 services affected)');
    expect(detail.title).toBe('Degradation on payment-service (3 services affected)');
  });
  it('protects reads and allows viewer detail access', async () => {
    const { app, headers } = await harness('VIEWER');
    expect((await app.inject('/api/incidents')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/incidents', headers })).json()[0].id).toBe('INC-1');
    const detail = (await app.inject({ url: '/api/incidents/INC-1', headers })).json();
    expect(detail.timeline[0].message).toBe('latency detected');
    expect(detail.anomalies).toHaveLength(1);
    expect(detail.remediation[0].status).toBe('EXECUTED');
    expect(detail.postmortem).toBeNull();
  });
  it('blocks viewer mutations before querying evidence or generating output', async () => {
    const { app, headers } = await harness('VIEWER');
    for (const suffix of ['investigate', 'postmortem'])
      expect(
        (await app.inject({ method: 'POST', url: `/api/incidents/INC-1/${suffix}`, headers }))
          .statusCode
      ).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
    expect(retrieved).not.toHaveBeenCalled();
  });
  it('returns missing incidents consistently', async () => {
    db.missing = true;
    const { app, headers } = await harness();
    for (const suffix of ['', '/investigate', '/postmortem']) {
      expect(
        (
          await app.inject({
            method: suffix ? 'POST' : 'GET',
            url: `/api/incidents/missing${suffix}`,
            headers,
          })
        ).statusCode
      ).toBe(404);
    }
  });
  it('grounds investigation in retrieved evidence and commits legal status changes', async () => {
    const { app, headers } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/incidents/INC-1/investigate',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().investigation.runbookReferences).toContain('Pool runbook');
    expect(response.json().investigation.evidence.join(' ')).toContain('2,500');
    expect(db.transitionIncident.mock.calls.map(call => call[1])).toEqual([
      'INVESTIGATING',
      'IDENTIFIED',
    ]);
    const deployment = db.query.mock.calls.find(call =>
      String(call[0]).includes('FROM deployments')
    );
    expect(deployment?.[1]).toEqual([incident.affected_services, incident.started_at]);
    const lock = db.query.mock.calls.findIndex(call => String(call[0]).startsWith('SELECT status'));
    const persist = db.query.mock.calls.findIndex(call =>
      String(call[0]).includes('INSERT INTO incident_events')
    );
    expect(lock).toBeLessThan(persist);
  });
  it('uses the locked current status when investigation races with remediation', async () => {
    db.lockedStatus = 'REMEDIATING';
    const { app, headers } = await harness();
    expect(
      (await app.inject({ method: 'POST', url: '/api/incidents/INC-1/investigate', headers }))
        .statusCode
    ).toBe(200);
    expect(db.transitionIncident).not.toHaveBeenCalled();
  });
  it('requires resolution and an existing investigation before a postmortem', async () => {
    const { app, headers } = await harness();
    expect(
      (await app.inject({ method: 'POST', url: '/api/incidents/INC-1/postmortem', headers }))
        .statusCode
    ).toBe(409);
    db.status = 'RESOLVED';
    expect(
      (await app.inject({ method: 'POST', url: '/api/incidents/INC-1/postmortem', headers }))
        .statusCode
    ).toBe(400);
  });
  it('persists a postmortem atomically and tolerates another writer completing it first', async () => {
    const { app, headers } = await harness();
    const investigation = (
      await app.inject({ method: 'POST', url: '/api/incidents/INC-1/investigate', headers })
    ).json().investigation;
    db.investigation = investigation;
    db.status = 'RESOLVED';
    db.transitionIncident.mockClear();
    const response = await app.inject({
      method: 'POST',
      url: '/api/incidents/INC-1/postmortem',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().postmortem).toContain('latency detected');
    expect(response.json().postmortem).toContain('clear_injected_fault on payment-service');
    expect(db.transitionIncident).toHaveBeenCalledWith(
      'INC-1',
      'POSTMORTEM',
      expect.any(String),
      'RESOLVED'
    );
    db.lockedStatus = 'POSTMORTEM';
    db.transitionIncident.mockClear();
    expect(
      (await app.inject({ method: 'POST', url: '/api/incidents/INC-1/postmortem', headers }))
        .statusCode
    ).toBe(200);
    expect(db.transitionIncident).not.toHaveBeenCalled();
  });
});
