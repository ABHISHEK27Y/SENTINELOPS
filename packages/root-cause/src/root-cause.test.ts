import { describe, expect, it } from 'vitest';

import type { Anomaly } from '@sentinelops/shared-types';

import { rankRootCauses, type DirectedEdge } from './engine.js';

const edges: DirectedEdge[] = [
  { from: 'api-gateway', to: 'order-service' },
  { from: 'order-service', to: 'payment-service' },
  { from: 'payment-service', to: 'postgres' },
];

function a(service: string, metric: string, tsMs: number, score = 0.8): Anomaly {
  return {
    anomalyId: crypto.randomUUID(),
    service,
    metric,
    value: 2500,
    baseline: 100,
    deviation: 2400,
    anomalyScore: score,
    method: 'zscore',
    severity: 'HIGH',
    windowStart: new Date(tsMs).toISOString(),
    windowEnd: new Date(tsMs).toISOString(),
  };
}

describe('rankRootCauses', () => {
  it('identifies the deepest dependency that failed first as root cause', () => {
    const t0 = 1_000_000;
    const hyps = rankRootCauses({
      services: ['postgres', 'payment-service', 'order-service'],
      anomalies: [
        a('postgres', 'db_query_latency_ms', t0), // failed first
        a('payment-service', 'request_latency_ms', t0 + 2000),
        a('order-service', 'error_rate', t0 + 4000, 0.5),
      ],
      edges,
      incidentStartMs: t0,
    });

    expect(hyps.length).toBeGreaterThan(0);
    expect(hyps[0]!.title).toContain('postgres');
    expect(hyps[0]!.confidence).toBeGreaterThan(hyps[1]!.confidence);
    // postgres has 2 dependents (payment, order) in the incident.
    const depEvidence = hyps[0]!.evidence.find(e => e.kind === 'dependency');
    expect(depEvidence?.data.dependents).toBe(2);
  });

  it('boosts a candidate that was recently deployed', () => {
    const t0 = 2_000_000;
    const withDeploy = rankRootCauses({
      services: ['payment-service', 'order-service'],
      anomalies: [
        a('payment-service', 'request_latency_ms', t0),
        a('order-service', 'error_rate', t0 + 1000),
      ],
      edges,
      deployments: [
        { service: 'payment-service', deployedAt: new Date(t0 - 60_000).toISOString() },
      ],
      incidentStartMs: t0,
    });
    const payment = withDeploy.find(h => h.title.includes('payment-service'))!;
    expect(payment.evidence.some(e => e.kind === 'deployment')).toBe(true);
  });

  it('never asserts certainty (confidence < 1)', () => {
    const hyps = rankRootCauses({
      services: ['postgres'],
      anomalies: [a('postgres', 'db_query_latency_ms', 1)],
      edges,
      incidentStartMs: 1,
    });
    expect(hyps[0]!.confidence).toBeLessThan(1);
  });
});
