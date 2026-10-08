import { describe, expect, it } from 'vitest';
import { computeSeverity, DEFAULT_SEVERITY_RULES } from './severity.js';

describe('computeSeverity', () => {
  it('returns INFO for a healthy system', () => {
    const { severity, score } = computeSeverity({
      errorRate: 0.001,
      latencyRatio: 1.0,
      affectedServices: 0,
      requestVolume: 10,
      durationSeconds: 0,
    });
    expect(severity).toBe('INFO');
    expect(score).toBeLessThan(DEFAULT_SEVERITY_RULES.thresholds.low);
  });

  it('escalates to HIGH/CRITICAL for the payment-pool-exhaustion scenario', () => {
    // Mirrors the spec example: 17% errors, 2.8s vs 180ms baseline (~15x),
    // 3 services affected, sustained ~4 minutes.
    const { severity, score } = computeSeverity({
      errorRate: 0.17,
      latencyRatio: 2800 / 180,
      affectedServices: 3,
      requestVolume: 220,
      durationSeconds: 240,
    });
    expect(['HIGH', 'CRITICAL']).toContain(severity);
    expect(score).toBeGreaterThan(DEFAULT_SEVERITY_RULES.thresholds.high);
  });

  it('is monotonic in error rate', () => {
    const base = {
      latencyRatio: 1,
      affectedServices: 1,
      requestVolume: 50,
      durationSeconds: 30,
    };
    const low = computeSeverity({ ...base, errorRate: 0.02 }).score;
    const high = computeSeverity({ ...base, errorRate: 0.4 }).score;
    expect(high).toBeGreaterThan(low);
  });

  it('clamps signals beyond their caps (no score > 1)', () => {
    const { score } = computeSeverity({
      errorRate: 5,
      latencyRatio: 1000,
      affectedServices: 99,
      requestVolume: 100000,
      durationSeconds: 1_000_000,
    });
    expect(score).toBeLessThanOrEqual(1);
  });
});
