import { describe, expect, it } from 'vitest';

import type { CorrelationGroup } from '@sentinelops/correlation';
import { AnomalySchema, type Anomaly } from '@sentinelops/shared-types';

import { severityForGroup } from './severity.js';

const anomaly: Anomaly = {
  anomalyId: '00000000-0000-4000-8000-000000000001',
  service: 'payment-service',
  metric: 'request_latency_ms',
  value: 200,
  baseline: 100,
  deviation: 100,
  anomalyScore: 0.8,
  method: 'zscore',
  severity: 'HIGH',
  windowStart: '2026-10-14T00:00:00Z',
  windowEnd: '2026-10-14T00:00:00Z',
};
const group = (): CorrelationGroup => ({
  correlationId: 'group-a',
  services: new Set(['payment-service', 'order-service']),
  anomalies: [anomaly, anomaly],
  firstSeen: 0,
  lastSeen: 60000,
});
describe('measured severity request volume', () => {
  it('uses the maximum latest rate across affected services and ignores unrelated services', () => {
    const g = group();
    g.requestRates = {
      'payment-service': { value: 120, ts: anomaly.windowEnd },
      'order-service': { value: 240, ts: anomaly.windowEnd },
      unrelated: { value: 9000, ts: anomaly.windowEnd },
    };
    expect(severityForGroup(g).signals).toMatchObject({
      requestVolume: 240,
      affectedServices: 2,
      latencyRatio: 2,
      durationSeconds: 60,
    });
  });
  it('treats zero as a known rate even when other services have no sample', () => {
    const g = group();
    g.requestRates = { 'payment-service': { value: 0, ts: anomaly.windowEnd } };
    expect(severityForGroup(g).signals.requestVolume).toBe(0);
  });
  it('keeps the capped anomaly-count proxy for legacy groups with no known rate', () => {
    const g = group();
    expect(severityForGroup(g).signals.requestVolume).toBe(80);
    g.requestRates = {};
    g.anomalies = Array.from({ length: 20 }, () => anomaly);
    expect(severityForGroup(g).signals.requestVolume).toBe(500);
  });
  it('retains raw measured volume while the existing severity model caps its contribution', () => {
    const g = group();
    g.requestRates = { 'payment-service': { value: 2000, ts: anomaly.windowEnd } };
    const high = severityForGroup(g);
    g.requestRates['payment-service']!.value = 500;
    expect(high.signals.requestVolume).toBe(2000);
    expect(high.score).toBe(severityForGroup(g).score);
  });
  it('accepts historical anomaly events but validates supplied measured rates', () => {
    expect(AnomalySchema.parse(anomaly).requestRate).toBeUndefined();
    expect(
      AnomalySchema.parse({ ...anomaly, requestRate: { value: 0, ts: anomaly.windowEnd } })
        .requestRate?.value
    ).toBe(0);
    for (const value of [-1, Infinity])
      expect(
        AnomalySchema.safeParse({ ...anomaly, requestRate: { value, ts: anomaly.windowEnd } })
          .success
      ).toBe(false);
  });
});
