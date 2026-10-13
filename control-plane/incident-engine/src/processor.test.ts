import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeEnvelope, type Anomaly } from '@sentinelops/shared-types';

const db = vi.hoisted(() => ({ query: vi.fn(), enqueueEvent: vi.fn(), state: null as unknown }));
vi.mock('@sentinelops/db', () => ({
  ...db,
  withPipelineState: async (_: string, work: (state: unknown) => Promise<{ state: unknown }>) => {
    const result = await work(db.state);
    db.state = result.state;
  },
}));
import { handleAnomaly } from './processor.js';

const now = Date.parse('2026-10-10T10:00:00Z');
function anomaly(offset = 0, service = 'payment-service'): Anomaly {
  return {
    anomalyId: makeEnvelope({ type: 'test', service, payload: {} }).eventId,
    service,
    metric: 'http_request_duration_ms',
    value: 2500,
    baseline: 30,
    deviation: 2470,
    anomalyScore: 0.9,
    method: 'zscore',
    severity: 'HIGH',
    windowStart: new Date(now + offset).toISOString(),
    windowEnd: new Date(now + offset).toISOString(),
    instance: 'replica-a',
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  db.state = null;
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('INSERT INTO incidents')
      ? [{ id: 'INC-1' }]
      : sql.includes('UPDATE incidents')
        ? [{ id: 'INC-1', status: 'DETECTED' }]
        : [],
  }));
});
describe('incident processor persistence', () => {
  it('creates one incident and appends related anomalies with stable group identity', async () => {
    const created = vi.fn();
    await handleAnomaly(anomaly(), { created }, now);
    await handleAnomaly(anomaly(2000, 'order-service'), { created }, now + 2000);
    expect(created).toHaveBeenCalledOnce();
    expect(
      db.query.mock.calls.filter(call => String(call[0]).includes('INSERT INTO incidents'))
    ).toHaveLength(1);
    expect(
      db.query.mock.calls.filter(call => String(call[0]).includes('INSERT INTO anomalies'))
    ).toHaveLength(2);
    const events = db.enqueueEvent.mock.calls.map(call => call[1]);
    expect(events.map(event => event.type)).toEqual(['INCIDENT_DETECTED', 'INCIDENT_UPDATED']);
    expect(events[0].correlationId).toBe(events[1].correlationId);
    expect(events[1].payload.anomalyCount).toBe(2);
    expect(events[1].payload.title).toBe('Degradation on payment-service (2 services affected)');
    const update = db.query.mock.calls.find(call => String(call[0]).includes('UPDATE incidents'));
    expect(update?.[1][0]).toBe('Degradation on payment-service (2 services affected)');
  });
  it('archives old evidence without reopening historical incidents', async () => {
    await handleAnomaly(anomaly(-301_000), {}, now);
    expect(db.enqueueEvent).not.toHaveBeenCalled();
    const insert = db.query.mock.calls.find(call =>
      String(call[0]).includes('INSERT INTO anomalies')
    );
    expect(insert?.[1][9]).toBeNull();
    expect(db.query.mock.calls.some(call => String(call[0]).includes('archive_late_anomaly'))).toBe(
      true
    );
    expect(
      db.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO incidents'))
    ).toBe(false);
  });
  it('rejects future clock skew and does not commit pipeline state', async () => {
    await expect(handleAnomaly(anomaly(31_000), {}, now)).rejects.toThrow('future');
    expect(db.state).toBeNull();
    expect(db.enqueueEvent).not.toHaveBeenCalled();
  });
  it('starts a new group when a locked incident has become terminal', async () => {
    await handleAnomaly(anomaly(), {}, now);
    const first = db.enqueueEvent.mock.calls[0]?.[1].correlationId;
    db.query.mockImplementation(async (sql: string, args?: unknown[]) => ({
      rows:
        sql.startsWith('SELECT status') && args?.[0] === first
          ? [{ status: 'RESOLVED' }]
          : sql.includes('INSERT INTO incidents')
            ? [{ id: 'INC-2' }]
            : [],
    }));
    await handleAnomaly(anomaly(2000), {}, now + 2000);
    const last = db.enqueueEvent.mock.calls.at(-1)?.[1];
    expect(last.payload.incidentId).toBe('INC-2');
    expect(last.correlationId).not.toBe(first);
  });
  it('does not retain new pipeline state after persistence failure', async () => {
    db.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(handleAnomaly(anomaly(), {}, now)).rejects.toThrow('unavailable');
    expect(db.state).toBeNull();
    expect(db.enqueueEvent).not.toHaveBeenCalled();
  });
});
