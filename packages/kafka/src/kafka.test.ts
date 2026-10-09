import { describe, expect, it } from 'vitest';

import { EventEnvelopeSchema, makeEnvelope, Topics } from '@sentinelops/shared-types';

import { backoffCeiling, backoffDelay, shouldRetry } from './backoff.js';
import { InMemoryIdempotencyStore } from './idempotency.js';

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    expect(backoffCeiling(0, { baseMs: 100, capMs: 5000 })).toBe(100);
    expect(backoffCeiling(1, { baseMs: 100, capMs: 5000 })).toBe(200);
    expect(backoffCeiling(3, { baseMs: 100, capMs: 5000 })).toBe(800);
    expect(backoffCeiling(20, { baseMs: 100, capMs: 5000 })).toBe(5000); // capped
  });

  it('full jitter keeps delay within [0, ceiling]', () => {
    const opts = { baseMs: 100, capMs: 5000 };
    for (const r of [0, 0.5, 0.999]) {
      const d = backoffDelay(3, opts, () => r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(backoffCeiling(3, opts));
    }
  });

  it('stops retrying past maxRetries', () => {
    expect(shouldRetry(4, { maxRetries: 5 })).toBe(true);
    expect(shouldRetry(5, { maxRetries: 5 })).toBe(false);
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('marks first occurrence new and subsequent ones duplicate', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.markIfNew('e1')).toBe(true);
    expect(await store.markIfNew('e1')).toBe(false);
    expect(await store.markIfNew('e2')).toBe(true);
  });
});

describe('event envelope', () => {
  it('makeEnvelope produces a schema-valid envelope', () => {
    const env = makeEnvelope({
      type: 'METRIC_SAMPLE',
      service: 'payment-service',
      payload: { metric: 'request_latency_ms', value: 42 },
    });
    const parsed = EventEnvelopeSchema.safeParse(env);
    expect(parsed.success).toBe(true);
    expect(env.eventId).toMatch(/[0-9a-f-]{36}/);
    expect(Topics.metrics).toBe('metrics.events');
  });

  it('rejects a malformed envelope', () => {
    const bad = { type: 'X', service: 's' }; // missing eventId/timestamp/payload
    expect(EventEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});
