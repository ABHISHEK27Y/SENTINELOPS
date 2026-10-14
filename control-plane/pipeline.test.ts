import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventType, Topics, makeEnvelope, type EventEnvelope } from '@sentinelops/shared-types';

type Handler = (event: EventEnvelope, context: { topic: string }) => Promise<unknown>;
type Registry = { metrics: () => Promise<string> };
const deps = vi.hoisted(() => ({
  up: vi.fn(),
  query: vi.fn(),
  enqueueEvent: vi.fn(),
  closePool: vi.fn(),
  connect: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn(),
  stopConsumer: vi.fn(),
  stopOutbox: vi.fn(),
  pruneTelemetryBatch: vi.fn().mockResolvedValue(0),
  healthClose: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
  handlers: new Map<string, { topics: string[]; handler: Handler }>(),
  state: new Map<string, unknown>(),
  health: null as null | { ready: () => Promise<boolean>; registry: Registry },
}));
vi.mock('@sentinelops/config', async original => ({
  ...(await original<object>()),
  getEnv: () => ({
    REDIS_URL: 'redis://test',
    METRICS_RETENTION_HOURS: 48,
    LOGS_RETENTION_HOURS: 72,
    RETENTION_INTERVAL_MS: 600000,
  }),
}));
vi.mock('@sentinelops/logger', () => ({ createLogger: () => deps.log }));
vi.mock('@sentinelops/db', () => ({
  up: deps.up,
  query: deps.query,
  closePool: deps.closePool,
  enqueueEvent: deps.enqueueEvent,
  processEvent: async (_: string, _id: string, work: () => Promise<unknown>) => work(),
  withPipelineState: async (key: string, work: (state: unknown) => Promise<{ state: unknown }>) => {
    const next = await work(deps.state.get(key));
    deps.state.set(key, next.state);
  },
  startOutbox: () => deps.stopOutbox,
  pruneTelemetryBatch: deps.pruneTelemetryBatch,
}));
vi.mock('@sentinelops/kafka', () => ({
  EventProducer: class {
    connect = deps.connect;
    send = deps.send;
    disconnect = deps.disconnect;
  },
  EventConsumer: class {
    isRunning = true;
    constructor(private options: { groupId: string }) {}
    async run(options: { topics: string[]; handler: Handler }) {
      deps.handlers.set(this.options.groupId, options);
    }
    stop = deps.stopConsumer;
  },
  RedisIdempotencyStore: class {},
}));
vi.mock('@sentinelops/service-kit', () => ({
  startHealthServer: async (options: { ready: () => Promise<boolean>; registry: Registry }) => {
    deps.health = options;
    return { close: deps.healthClose };
  },
}));

const signals = new Map<string, () => void>();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  deps.handlers.clear();
  deps.state.clear();
  signals.clear();
  deps.health = null;
  deps.log.child.mockReturnValue(deps.log);
  deps.up.mockResolvedValue({ applied: [] });
  deps.connect.mockResolvedValue(undefined);
  deps.query.mockImplementation(async (sql: string) => ({
    rowCount: 1,
    rows: sql.includes('INSERT INTO incidents') ? [{ id: 'INC-1' }] : [],
  }));
  const originalOn = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
    if (['SIGTERM', 'SIGINT'].includes(event)) {
      signals.set(event, listener);
      return process;
    }
    return originalOn(event, listener);
  }) as typeof process.on);
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => vi.restoreAllMocks());
async function started(group: string) {
  await vi.waitFor(() => {
    expect(deps.handlers.has(group)).toBe(true);
    expect(signals.has('SIGTERM')).toBe(true);
  });
  expect(await deps.health?.ready()).toBe(true);
  return deps.handlers.get(group)!;
}
async function shutdown() {
  signals.get('SIGTERM')?.();
  await vi.waitFor(() => expect(deps.closePool).toHaveBeenCalled());
  expect(deps.stopConsumer).toHaveBeenCalledOnce();
  expect(deps.stopOutbox).toHaveBeenCalledOnce();
  expect(deps.disconnect).toHaveBeenCalledOnce();
  expect(deps.healthClose).toHaveBeenCalledOnce();
}
describe('control-plane startup, ingestion and shutdown', () => {
  it('exposes retention deletion counts and stops pruning before closing the database', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    await import('./ingestor/src/index.js');
    await started('ingestor');
    const tick = interval.mock.calls.find(call => call[1] === 600000)![0] as () => void;
    deps.pruneTelemetryBatch.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    tick();
    await vi.waitFor(() => expect(deps.pruneTelemetryBatch).toHaveBeenCalledTimes(2));
    const metrics = await deps.health!.registry.metrics();
    expect(metrics).toContain('retention_deleted_total{table="metrics",service="ingestor"} 3');
    expect(metrics).toContain('retention_deleted_total{table="logs",service="ingestor"} 2');
    await shutdown();
    tick();
    expect(deps.pruneTelemetryBatch).toHaveBeenCalledTimes(2);
  });
  it('persists normalized metrics/logs and rejects malformed telemetry', async () => {
    await import('./ingestor/src/index.js');
    const consumer = await started('ingestor');
    expect(consumer.topics).toEqual([Topics.telemetry, Topics.logs]);
    const sample = {
      metric: 'request_rate',
      value: 20,
      ts: new Date().toISOString(),
      labels: { instance: 'a' },
    };
    await consumer.handler(
      makeEnvelope({
        type: EventType.METRIC_SAMPLE,
        service: 'payment-service',
        payload: { samples: [sample] },
      }),
      { topic: Topics.telemetry }
    );
    expect(
      deps.query.mock.calls
        .find(call => String(call[0]).includes('INSERT INTO metrics'))?.[1]
        .slice(0, 3)
    ).toEqual(['payment-service', 'request_rate', 20]);
    expect(deps.enqueueEvent.mock.calls[0]?.[0]).toBe(Topics.metrics);
    const log = {
      level: 'ERROR',
      message: 'charge failed',
      ts: sample.ts,
      fields: { path: '/charge' },
    };
    await consumer.handler(
      makeEnvelope({ type: 'LOG', service: 'payment-service', traceId: 'trace-a', payload: log }),
      { topic: Topics.logs }
    );
    expect(
      deps.query.mock.calls.find(call => String(call[0]).includes('INSERT INTO logs'))?.[1][4]
    ).toBe('trace-a');
    await expect(
      consumer.handler(
        makeEnvelope({
          type: EventType.METRIC_SAMPLE,
          service: 'payment-service',
          payload: { samples: [{ ...sample, value: 'bad' }] },
        }),
        { topic: Topics.telemetry }
      )
    ).rejects.toThrow();
    await shutdown();
  });
  it('detects only normalized streams and restores healthy baselines for scored anomalies', async () => {
    await import('./anomaly-engine/src/index.js');
    const consumer = await started('anomaly-engine');
    expect(consumer.topics).toEqual([Topics.metrics]);
    const start = Date.now();
    const metrics = [
      'http_request_duration_ms',
      'error_rate',
      'cpu_usage',
      'queue_depth',
      'other_metric',
    ];
    for (let i = 0; i < 40; i++)
      await consumer.handler(
        makeEnvelope({
          type: EventType.METRIC_SAMPLE,
          service: 'payment-service',
          payload: {
            samples: metrics.map(metric => ({
              metric,
              value: metric === 'error_rate' ? 0.01 : 10,
              ts: new Date(start + i * 1000).toISOString(),
              labels: { instance: 'a' },
            })),
          },
        }),
        { topic: Topics.metrics }
      );
    expect(deps.enqueueEvent).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++)
      await consumer.handler(
        makeEnvelope({
          type: EventType.METRIC_SAMPLE,
          service: 'payment-service',
          traceId: 'trace-a',
          payload: {
            samples: metrics
              .filter(metric => i === 2 || !['error_rate', 'other_metric'].includes(metric))
              .filter(metric => i > 0 || metric !== 'http_request_duration_ms')
              .map(metric => ({
                metric,
                value: metric === 'error_rate' ? 0.99 : 2500,
                ts: new Date(start + 41000 + i * 1000).toISOString(),
                labels: { instance: 'a' },
              })),
          },
        }),
        { topic: Topics.metrics }
      );
    expect(deps.enqueueEvent).toHaveBeenCalledTimes(5);
    const types = deps.enqueueEvent.mock.calls.map(call => call[1].type);
    for (const type of [
      EventType.LATENCY_ANOMALY,
      EventType.ERROR_RATE_ANOMALY,
      EventType.RESOURCE_ANOMALY,
      EventType.SATURATION_ANOMALY,
    ])
      expect(types).toContain(type);
    expect(deps.enqueueEvent.mock.calls.every(call => call[1].traceId === 'trace-a')).toBe(true);
    expect(deps.state.has('detector:payment-service')).toBe(true);
    await shutdown();
  });
  it('validates anomaly events before durable correlation and creation', async () => {
    await import('./incident-engine/src/index.js');
    const consumer = await started('incident-engine');
    await expect(
      consumer.handler(
        makeEnvelope({ type: EventType.LATENCY_ANOMALY, service: 'payment-service', payload: {} }),
        { topic: Topics.anomaly }
      )
    ).rejects.toThrow('invalid anomaly');
    const ts = new Date().toISOString();
    await consumer.handler(
      makeEnvelope({
        type: EventType.LATENCY_ANOMALY,
        service: 'payment-service',
        payload: {
          anomalyId: crypto.randomUUID(),
          service: 'payment-service',
          metric: 'latency',
          value: 2500,
          baseline: 30,
          deviation: 2470,
          anomalyScore: 0.9,
          method: 'zscore',
          severity: 'HIGH',
          windowStart: ts,
          windowEnd: ts,
        },
      }),
      { topic: Topics.anomaly }
    );
    expect(deps.enqueueEvent.mock.calls.at(-1)?.[1].type).toBe(EventType.INCIDENT_DETECTED);
    await shutdown();
  });
  it('fails startup before consumers when migrations cannot complete', async () => {
    deps.up.mockRejectedValue(new Error('migration blocked'));
    await import('./ingestor/src/index.js');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(deps.connect).not.toHaveBeenCalled();
    expect(deps.handlers.size).toBe(0);
  });
});
