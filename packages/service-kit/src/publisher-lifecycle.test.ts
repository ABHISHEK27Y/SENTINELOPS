import type { Registry } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EventProducer } from '@sentinelops/kafka';
import type { Logger } from '@sentinelops/logger';

import { TelemetryPublisher } from './telemetry-publisher.js';

afterEach(() => vi.useRealTimers());
describe('telemetry publisher lifecycle', () => {
  it('prevents overlapping sends and waits for active publication during shutdown', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        })
    );
    const metrics = vi.fn().mockResolvedValue([{ name: 'cpu_usage', values: [{ value: 0.1 }] }]);
    const publisher = new TelemetryPublisher(
      { send } as unknown as EventProducer,
      'payment-service',
      { getMetricsAsJSON: metrics } as unknown as Registry,
      { warn: vi.fn() } as unknown as Logger
    );
    publisher.start(1000);
    publisher.start(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(send).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = publisher.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    complete();
    await stopping;
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopped).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });
  it('contains registry failures and can stop when no work is running', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const send = vi.fn();
    const publisher = new TelemetryPublisher(
      { send } as unknown as EventProducer,
      'payment-service',
      {
        getMetricsAsJSON: vi.fn().mockRejectedValue(new Error('registry unavailable')),
      } as unknown as Registry,
      { warn } as unknown as Logger
    );
    await publisher.stop();
    publisher.start(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    await publisher.stop();
  });
});
