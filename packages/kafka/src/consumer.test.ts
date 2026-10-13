import { describe, expect, it, vi } from 'vitest';

import { EventType, makeEnvelope, Topics } from '@sentinelops/shared-types';

import { EventConsumer } from './consumer.js';

async function consumerHarness(delivery = true) {
  let receive: (payload: unknown) => Promise<void> = async () => {};
  const client = {
    connect: vi.fn(),
    subscribe: vi.fn(),
    disconnect: vi.fn(),
    run: vi.fn(async opts => {
      receive = opts.eachMessage;
    }),
  };
  const dlq = { connect: vi.fn(), disconnect: vi.fn(), send: vi.fn().mockResolvedValue(delivery) };
  const processed = new Set<string>();
  const idempotency = {
    hasProcessed: vi.fn(async id => processed.has(id)),
    markProcessed: vi.fn(async id => {
      processed.add(id);
    }),
  };
  const handler = vi.fn();
  const consumer = new EventConsumer({
    groupId: 'test',
    kafka: { consumer: () => client } as never,
    dlqProducer: dlq as never,
    idempotency,
    backoff: { maxRetries: 0 },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });
  await consumer.run({ topics: [Topics.metrics], handler });
  const envelope = makeEnvelope({ type: EventType.METRIC_SAMPLE, service: 'payment', payload: {} });
  const deliver = (raw = JSON.stringify(envelope)) =>
    receive({ topic: Topics.metrics, partition: 0, message: { value: Buffer.from(raw) } });
  return { handler, dlq, idempotency, deliver, envelope };
}

describe('consumer completion and poison-message handling', () => {
  it('marks completion only after the handler and skips a successful redelivery', async () => {
    const h = await consumerHarness();
    h.handler.mockImplementation(async () => {
      expect(h.idempotency.markProcessed).not.toHaveBeenCalled();
    });
    await h.deliver();
    await h.deliver();
    expect(h.handler).toHaveBeenCalledOnce();
    expect(h.idempotency.markProcessed).toHaveBeenCalledWith(h.envelope.eventId);
  });
  it('throws on DLQ failure and processes the original event on redelivery', async () => {
    const h = await consumerHarness(false);
    h.handler
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);
    await expect(h.deliver()).rejects.toThrow('dead-letter delivery failed');
    expect(h.idempotency.markProcessed).not.toHaveBeenCalled();
    await h.deliver();
    expect(h.handler).toHaveBeenCalledTimes(2);
    expect(h.idempotency.markProcessed).toHaveBeenCalledOnce();
  });
  it('preserves the whole malformed message and requires confirmed DLQ delivery', async () => {
    const h = await consumerHarness();
    const raw = 'malformed:' + 'x'.repeat(9000);
    await h.deliver(raw);
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.dlq.send.mock.calls[0]?.[1].payload.original).toBe(raw);
    const failed = await consumerHarness(false);
    await expect(failed.deliver(raw)).rejects.toThrow('dead-letter delivery failed');
  });
});
