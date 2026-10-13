import type { Kafka } from 'kafkajs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Topics, makeEnvelope } from '@sentinelops/shared-types';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@sentinelops/logger', () => ({ createLogger: () => log }));
import { EventProducer } from './producer.js';

beforeEach(() => vi.clearAllMocks());
function transport(strict = false) {
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const factory = vi.fn(() => client);
  const producer = new EventProducer({ kafka: { producer: factory } as unknown as Kafka, strict });
  return { producer, client, factory };
}
describe('Kafka producer delivery contracts', () => {
  it('coalesces concurrent connections and publishes stable keyed envelopes', async () => {
    const { producer, client, factory } = transport();
    await Promise.all([producer.connect(), producer.connect()]);
    expect(client.connect).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith({
      allowAutoTopicCreation: true,
      idempotent: true,
      maxInFlightRequests: 1,
    });
    const event = makeEnvelope({
      type: 'METRIC_SAMPLE',
      service: 'payment-service',
      payload: { value: 42 },
    });
    expect(await producer.send(Topics.metrics, event, 'incident-a')).toBe(true);
    expect(client.send.mock.calls[0]?.[0]).toMatchObject({
      topic: Topics.metrics,
      messages: [
        {
          key: 'incident-a',
          value: JSON.stringify(event),
          headers: { type: event.type, eventId: event.eventId },
        },
      ],
    });
    await producer.disconnect();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
  it('reports failed best-effort connections and retries on the next send', async () => {
    const { producer, client } = transport();
    client.connect.mockRejectedValueOnce(new Error('offline'));
    const event = makeEnvelope({ type: 'METRIC_SAMPLE', service: 'payment-service', payload: {} });
    expect(await producer.send(Topics.metrics, event)).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
    expect(await producer.send(Topics.metrics, event)).toBe(true);
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls[0]?.[0].messages[0].key).toBe('payment-service');
  });
  it('propagates strict connection/send failures instead of confirming delivery', async () => {
    const { producer, client } = transport(true);
    const event = makeEnvelope({ type: 'METRIC_SAMPLE', service: 'payment-service', payload: {} });
    client.connect.mockRejectedValueOnce(new Error('connect failed'));
    await expect(producer.send(Topics.metrics, event)).rejects.toThrow('connect failed');
    client.send.mockRejectedValueOnce(new Error('send failed'));
    await expect(producer.send(Topics.metrics, event)).rejects.toThrow('send failed');
  });
  it('tolerates best-effort send and disconnect failures without retaining a connected flag', async () => {
    const { producer, client } = transport();
    await producer.disconnect();
    expect(client.disconnect).not.toHaveBeenCalled();
    client.send.mockRejectedValueOnce(new Error('send failed'));
    expect(
      await producer.send(
        Topics.metrics,
        makeEnvelope({ type: 'METRIC_SAMPLE', service: 'payment-service', payload: {} })
      )
    ).toBe(false);
    client.disconnect.mockRejectedValueOnce(new Error('disconnect failed'));
    await producer.disconnect();
    await producer.connect();
    expect(client.connect).toHaveBeenCalledTimes(2);
  });
});
