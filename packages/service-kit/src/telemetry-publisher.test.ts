import { describe, expect, it } from 'vitest';

import { IntervalSampler } from './telemetry-publisher.js';

const registry = (count: number, sum: number, requests: number, errors: number) => [
  {
    name: 'http_request_duration_ms',
    values: [
      { metricName: 'http_request_duration_ms_sum', value: sum, labels: { route: '/orders' } },
      { metricName: 'http_request_duration_ms_count', value: count, labels: { route: '/orders' } },
      { metricName: 'http_request_duration_ms_sum', value: 99999, labels: { route: '/health' } },
      { metricName: 'http_request_duration_ms_count', value: 99999, labels: { route: '/health' } },
    ],
  },
  {
    name: 'http_requests_total',
    values: [
      { value: requests - errors, labels: { route: '/orders', status: '200' } },
      { value: errors, labels: { route: '/orders', status: '500' } },
      { value: 99999, labels: { route: '/metrics', status: '200' } },
    ],
  },
];

describe('interval telemetry', () => {
  it('aggregates labels, excludes operational requests and measures interval rates', () => {
    const sampler = new IntervalSampler('replica-a');
    expect(sampler.sample(registry(10, 1000, 10, 1), 1000)).toEqual([]);
    const samples = sampler.sample(registry(15, 2000, 15, 2), 6000);
    expect(samples.find(s => s.metric === 'http_request_duration_ms')?.value).toBe(200);
    expect(samples.find(s => s.metric === 'request_rate')?.value).toBe(1);
    expect(samples.find(s => s.metric === 'error_rate')?.value).toBe(0.2);
    expect(samples.every(s => s.labels?.['instance'] === 'replica-a')).toBe(true);
  });

  it('shows recovery immediately rather than averaging the entire process lifetime', () => {
    const sampler = new IntervalSampler();
    sampler.sample(registry(10, 25000, 10, 5), 1000);
    const recovered = sampler.sample(registry(20, 25200, 20, 5), 6000);
    expect(recovered.find(s => s.metric === 'http_request_duration_ms')?.value).toBe(20);
    expect(recovered.find(s => s.metric === 'error_rate')?.value).toBe(0);
  });

  it('does not invent a latency sample for idle periods or counter resets', () => {
    const sampler = new IntervalSampler();
    sampler.sample(registry(10, 1000, 10, 1), 1000);
    for (const metrics of [registry(10, 1000, 10, 1), registry(0, 0, 0, 0)]) {
      const samples = sampler.sample(metrics, 6000);
      expect(samples.some(s => s.metric === 'http_request_duration_ms')).toBe(false);
      expect(samples.every(s => s.value >= 0)).toBe(true);
    }
  });
});
