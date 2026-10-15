import { describe, expect, it } from 'vitest';

import type { Sample } from '@sentinelops/detection';

import { latestRequestRate } from './request-rate.js';

const sample = (value: number, seconds: number, metric = 'request_rate'): Sample => ({
  service: 'payment-service',
  metric,
  value,
  ts: new Date(seconds * 1000).toISOString(),
});
describe('latest request rate', () => {
  it('selects by timestamp rather than batch order, including a measured zero', () => {
    expect(
      latestRequestRate(
        [sample(20, 2), sample(0, 3), sample(99, 1), sample(999, 4, 'latency')],
        undefined
      )
    ).toEqual({ value: 0, ts: sample(0, 3).ts });
  });
  it('preserves the persisted rate across empty or delayed batches and accepts newer rates', () => {
    const previous = { value: 30, ts: sample(30, 3).ts };
    expect(latestRequestRate([], previous)).toEqual(previous);
    expect(latestRequestRate([sample(100, 2)], previous)).toEqual(previous);
    expect(latestRequestRate([sample(50, 4)], previous)).toEqual({
      value: 50,
      ts: sample(50, 4).ts,
    });
  });
  it('ignores invalid rates and timestamps without inventing a rate for old snapshots', () => {
    expect(
      latestRequestRate([sample(-1, 1), sample(Infinity, 2), { ...sample(12, 3), ts: 'bad' }], {
        value: 'bad',
      })
    ).toBeUndefined();
  });
});
