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
