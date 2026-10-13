import { describe, expect, it } from 'vitest';

import type { Anomaly } from '@sentinelops/shared-types';

import { Correlator } from './correlator.js';
import { DependencyGraph } from './graph.js';
import { canTransition, transition, isTerminal } from './lifecycle.js';

function anomaly(service: string, metric: string, tsMs: number): Anomaly {
  return {
    anomalyId: crypto.randomUUID(),
    service,
    metric,
    value: 1000,
    baseline: 100,
    deviation: 900,
    anomalyScore: 0.8,
    method: 'zscore',
    severity: 'HIGH',
    windowStart: new Date(tsMs).toISOString(),
    windowEnd: new Date(tsMs).toISOString(),
  };
}

// gateway → order → payment → postgres ; order → notification → redis
const graph = new DependencyGraph([
  { from: 'api-gateway', to: 'order-service' },
  { from: 'order-service', to: 'payment-service' },
  { from: 'payment-service', to: 'postgres' },
  { from: 'order-service', to: 'notification-service' },
  { from: 'notification-service', to: 'redis' },
]);

describe('DependencyGraph.related', () => {
  it('links directly connected services', () => {
    expect(graph.related('payment-service', 'postgres')).toBe(true);
    expect(graph.related('order-service', 'payment-service')).toBe(true);
  });
  it('links within maxHops and not beyond', () => {
    expect(graph.related('order-service', 'postgres', 2)).toBe(true); // order→payment→postgres
    expect(graph.related('api-gateway', 'postgres', 2)).toBe(false); // 3 hops
    expect(graph.related('api-gateway', 'postgres', 3)).toBe(true);
  });
  it('is false for unrelated / unknown nodes', () => {
    expect(graph.related('redis', 'postgres')).toBe(false);
    expect(graph.related('payment-service', 'ghost')).toBe(false);
  });
});

describe('Correlator', () => {
  it('restores identity, bounds evidence and starts a fresh group after closure', () => {
    let n = 0;
    const options = { idGen: () => `corr-${++n}` };
    const original = new Correlator(graph, options);
    const first = original.ingest(anomaly('payment-service', 'latency', 100000));
    for (let i = 1; i < 550; i++)
      original.ingest(anomaly('payment-service', 'latency', 100000 + i));
    const restored = new Correlator(graph, options);
    restored.restore(original.snapshot());
    expect(restored.ingest(anomaly('payment-service', 'errors', 101000)).correlationId).toBe(
      first.correlationId
    );
    expect(restored.get(first.correlationId)?.anomalies).toHaveLength(500);
    restored.close(first.correlationId);
    expect(restored.ingest(anomaly('payment-service', 'latency', 102000)).isNew).toBe(true);
  });
  it('rejects substantially older anomalies instead of creating historical incidents', () => {
    const correlator = new Correlator(graph);
    const current = correlator.ingest(anomaly('payment-service', 'latency', 200000));
    expect(() => correlator.ingest(anomaly('payment-service', 'errors', 100000))).toThrow(
      'lateness'
    );
    expect(correlator.get(current.correlationId)?.lastSeen).toBe(200000);
  });
  it('preserves its watermark after every group is closed and the process restarts', () => {
    const original = new Correlator(graph);
    const group = original.ingest(anomaly('payment-service', 'latency', 200000));
    original.close(group.correlationId);
    const restored = new Correlator(graph);
    restored.restore(original.snapshot());
    expect(restored.isLate(100000)).toBe(true);
    expect(restored.openGroups()).toHaveLength(0);
    expect(() => restored.ingest(anomaly('payment-service', 'errors', 100000))).toThrow('lateness');
  });
  it('accepts bounded cross-partition delay and rejects invalid timestamps', () => {
    const correlator = new Correlator(graph);
    const current = correlator.ingest(anomaly('payment-service', 'latency', 200000));
    expect(correlator.ingest(anomaly('payment-service', 'errors', 180000)).correlationId).toBe(
      current.correlationId
    );
    expect(() => correlator.ingest(anomaly('payment-service', 'errors', 200000), NaN)).toThrow(
      'timestamp'
    );
  });
  it('collapses related anomalies in one window into ONE incident', () => {
    let n = 0;
    const c = new Correlator(graph, { windowMs: 60_000, idGen: () => `corr-${++n}` });
    const t0 = 1_000_000;
    const r1 = c.ingest(anomaly('postgres', 'db_query_latency_ms', t0), t0);
    const r2 = c.ingest(anomaly('payment-service', 'request_latency_ms', t0 + 2000), t0 + 2000);
    const r3 = c.ingest(anomaly('payment-service', 'error_rate', t0 + 3000), t0 + 3000);
    const r4 = c.ingest(anomaly('order-service', 'error_rate', t0 + 4000), t0 + 4000);

    expect(r1.isNew).toBe(true);
    expect(r2.isNew).toBe(false);
    expect(r3.isNew).toBe(false);
    expect(r4.isNew).toBe(false);
    expect(r4.correlationId).toBe('corr-1');
    expect(new Set(r4.services)).toEqual(new Set(['postgres', 'payment-service', 'order-service']));
    expect(r4.anomalyCount).toBe(4);
  });

  it('starts a new incident for an unrelated service', () => {
    let n = 0;
    const c = new Correlator(graph, { idGen: () => `corr-${++n}` });
    const t0 = 2_000_000;
    c.ingest(anomaly('payment-service', 'request_latency_ms', t0), t0);
    const other = c.ingest(anomaly('redis', 'redis_latency_ms', t0 + 1000), t0 + 1000);
    expect(other.isNew).toBe(true);
    expect(other.correlationId).toBe('corr-2');
  });

  it('starts a new incident once the window has elapsed', () => {
    let n = 0;
    const c = new Correlator(graph, { windowMs: 30_000, idGen: () => `corr-${++n}` });
    const t0 = 3_000_000;
    c.ingest(anomaly('payment-service', 'request_latency_ms', t0), t0);
    const later = c.ingest(
      anomaly('payment-service', 'request_latency_ms', t0 + 40_000),
      t0 + 40_000
    );
    expect(later.isNew).toBe(true);
  });
});

describe('lifecycle', () => {
  it('permits legal transitions and blocks illegal ones', () => {
    expect(canTransition('DETECTED', 'INVESTIGATING')).toBe(true);
    expect(canTransition('DETECTED', 'RESOLVED')).toBe(false);
    expect(transition('VERIFYING', 'RESOLVED')).toBe('RESOLVED');
    expect(() => transition('DETECTED', 'RESOLVED')).toThrow(/illegal/);
  });
  it('recognizes terminal states', () => {
    expect(isTerminal('POSTMORTEM')).toBe(true);
    expect(isTerminal('DETECTED')).toBe(false);
  });
});
