import { describe, expect, it } from 'vitest';
import { RollingWindow, Ewma } from './stats.js';
import { AnomalyDetector, scoreToSeverity } from './detector.js';

describe('RollingWindow', () => {
  it('computes mean and std, and evicts beyond capacity', () => {
    const w = new RollingWindow(3);
    [2, 4, 6].forEach((v) => w.push(v));
    expect(w.mean()).toBeCloseTo(4);
    expect(w.std()).toBeCloseTo(Math.sqrt((4 + 0 + 4) / 3)); // pop std ≈ 1.633
    w.push(8); // evicts 2 → window [4,6,8]
    expect(w.size).toBe(3);
    expect(w.mean()).toBeCloseTo(6);
  });
});

describe('Ewma', () => {
  it('tracks a shifting mean', () => {
    const e = new Ewma(0.5);
    [10, 10, 10].forEach((v) => e.update(v));
    expect(e.mean).toBeCloseTo(10);
    e.update(20);
    expect(e.mean).toBeGreaterThan(10);
    expect(e.mean).toBeLessThan(20);
  });
});

describe('AnomalyDetector', () => {
  const steady = (d: AnomalyDetector, n: number, base = 100, jitter = 2) => {
    for (let i = 0; i < n; i++) {
      d.detect({
        service: 'payment-service',
        metric: 'request_latency_ms',
        value: base + (i % 2 === 0 ? jitter : -jitter),
        ts: new Date().toISOString(),
      });
    }
  };

  it('does not flag during warmup or steady state', () => {
    const d = new AnomalyDetector();
    let flagged = 0;
    for (let i = 0; i < 40; i++) {
      const a = d.detect({
        service: 'payment-service',
        metric: 'request_latency_ms',
        value: 100 + (i % 2 ? 2 : -2),
        ts: new Date().toISOString(),
      });
      if (a) flagged++;
    }
    expect(flagged).toBe(0);
  });

  it('flags a large upward spike with high severity', () => {
    const d = new AnomalyDetector();
    steady(d, 30, 180); // baseline ~180ms
    const spike = d.detect({
      service: 'payment-service',
      metric: 'request_latency_ms',
      value: 2800, // the demo scenario: 180ms → 2.8s
      ts: new Date().toISOString(),
    });
    expect(spike).not.toBeNull();
    expect(spike!.anomalyScore).toBeGreaterThan(0.5);
    expect(['HIGH', 'CRITICAL']).toContain(spike!.severity);
    expect(spike!.baseline).toBeGreaterThan(150);
    expect(spike!.deviation).toBeGreaterThan(2000);
  });

  it('ignores a downward move when direction is "up"', () => {
    const d = new AnomalyDetector({ direction: 'up' });
    steady(d, 30, 180);
    const drop = d.detect({
      service: 'payment-service',
      metric: 'request_latency_ms',
      value: 5,
      ts: new Date().toISOString(),
    });
    expect(drop).toBeNull();
  });

  it('maps scores to severities monotonically', () => {
    expect(scoreToSeverity(0)).toBe('INFO');
    expect(scoreToSeverity(0.3)).toBe('LOW');
    expect(scoreToSeverity(0.5)).toBe('MEDIUM');
    expect(scoreToSeverity(0.8)).toBe('HIGH');
    expect(scoreToSeverity(0.95)).toBe('CRITICAL');
  });
});
