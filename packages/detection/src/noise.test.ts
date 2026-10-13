import { expect, it } from 'vitest';

import { evaluateRecovery } from '../../remediation/src/recovery.js';

import { AnomalyDetector } from './detector.js';

it('ignores small CPU jitter while detecting resource saturation and preserving recovery checks', () => {
  const detector = new AnomalyDetector();
  let timestamp = Date.parse('2026-10-13T08:00:00Z');
  const sample = (value: number) => ({
    service: 'payment-service',
    metric: 'cpu_usage',
    value,
    ts: new Date((timestamp += 5000)).toISOString(),
  });
  for (let i = 0; i < 12; i++) detector.detect(sample(0.04));
  expect(detector.detect(sample(0.12))).toBeNull();
  expect(detector.detect(sample(0.9))).toBeNull();
  expect(detector.detect(sample(0.9))).toBeNull();
  expect(detector.detect(sample(0.9))).not.toBeNull();
  expect(
    evaluateRecovery([{ metric: 'cpu_usage', observed: 0.12, baseline: 0.04 }]).recovered
  ).toBe(true);
  expect(evaluateRecovery([{ metric: 'cpu_usage', observed: 0.9, baseline: 0.04 }]).recovered).toBe(
    false
  );
  expect(evaluateRecovery([{ metric: 'request_rate', observed: 0, baseline: 5 }]).recovered).toBe(
    false
  );
});

it('ignores a transient one-item queue and confirms sustained backlog after restart', () => {
  let timestamp = Date.parse('2026-10-13T08:00:00Z');
  const sample = (value: number) => ({
    service: 'notification-service',
    metric: 'queue_depth',
    value,
    ts: new Date((timestamp += 5000)).toISOString(),
  });
  const detector = new AnomalyDetector();
  for (let i = 0; i < 12; i++) detector.detect(sample(0));
  expect(detector.detect(sample(1))).toBeNull();
  expect(detector.detect(sample(2))).toBeNull();
  const restarted = new AnomalyDetector();
  restarted.restore(detector.snapshot());
  expect(restarted.detect(sample(2))).toBeNull();
  expect(restarted.detect(sample(2))?.metric).toBe('queue_depth');
  expect(restarted.detect(sample(0))).toBeNull();
  expect(restarted.detect(sample(2))).toBeNull();
  timestamp += 30_000;
  expect(restarted.detect(sample(2))).toBeNull();
  expect(restarted.detect(sample(2))).toBeNull();
  expect(restarted.detect(sample(2))?.metric).toBe('queue_depth');
});

it('ignores one-request rate jitter but detects a sustained traffic surge', () => {
  let timestamp = Date.parse('2026-10-13T08:00:00Z');
  const sample = (value: number) => ({
    service: 'api-gateway',
    metric: 'request_rate',
    value,
    ts: new Date((timestamp += 5000)).toISOString(),
  });
  const detector = new AnomalyDetector();
  for (let i = 0; i < 12; i++) detector.detect(sample(5));
  expect(detector.detect(sample(6))).toBeNull();
  expect(detector.detect(sample(10))).toBeNull();
  expect(detector.detect(sample(10))).toBeNull();
  expect(detector.detect(sample(10))?.metric).toBe('request_rate');
});
