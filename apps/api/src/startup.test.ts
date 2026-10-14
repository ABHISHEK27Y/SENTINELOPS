import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  app: null as FastifyInstance | null,
  metricsApp: null as FastifyInstance | null,
  up: vi.fn(),
  query: vi.fn(),
  closePool: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
  stopConsumer: vi.fn(),
  stopWorker: vi.fn(),
  stopOutbox: vi.fn(),
  fanout: null as null | {
    topics: string[];
    handler: (event: object, context: { topic: string }) => Promise<void>;
  },
  publish: null as null | ((topic: string, envelope: object, key: string) => Promise<boolean>),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
  env: {
    NODE_ENV: 'production',
    DEMO_MODE: true,
    JWT_SECRET: 'test-secret-for-startup-at-least-32-characters',
    JWT_EXPIRES_IN: '1h',
    CORS_ORIGIN: 'http://localhost:3000',
  },
}));
vi.mock('fastify', async original => {
  const actual = await original<typeof import('fastify')>();
  return {
    ...actual,
    default: (options: FastifyServerOptions) => {
      const app: FastifyInstance = actual.default(options);
      if (!deps.app) deps.app = app;
      else deps.metricsApp = app;
      vi.spyOn(app, 'listen').mockImplementation(
        (async () => 'http://localhost:4000') as typeof app.listen
      );
      return app;
    },
  };
});
vi.mock('@sentinelops/config', () => ({ getEnv: () => deps.env }));
vi.mock('@sentinelops/logger', () => ({ createLogger: () => deps.log }));
vi.mock('@sentinelops/db', () => ({
  up: deps.up,
  query: deps.query,
  closePool: deps.closePool,
  startOutbox: (publish: typeof deps.publish) => {
    deps.publish = publish;
    return deps.stopOutbox;
  },
}));
vi.mock('@sentinelops/kafka', () => ({
  EventProducer: class {
    connect = deps.connect;
    disconnect = deps.disconnect;
    send = deps.send;
  },
  EventConsumer: class {
    async run(options: NonNullable<typeof deps.fanout>) {
      deps.fanout = options;
    }
    stop = deps.stopConsumer;
  },
}));
vi.mock('./runbooks.js', () => ({
  buildRunbookRetriever: async () => ({ size: () => 3, search: vi.fn() }),
}));
vi.mock('./remediation-worker.js', () => ({ startRemediationWorker: () => deps.stopWorker }));

const signals = new Map<string, () => void>();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  signals.clear();
  deps.app = null;
  deps.metricsApp = null;
  deps.fanout = null;
  deps.log.child.mockReturnValue(deps.log);
  deps.env.DEMO_MODE = true;
  deps.env.JWT_SECRET = 'test-secret-for-startup-at-least-32-characters';
  deps.up.mockResolvedValue({ applied: [] });
  deps.connect.mockResolvedValue(undefined);
  deps.send.mockResolvedValue(true);
  deps.stopConsumer.mockResolvedValue(undefined);
  deps.query.mockResolvedValue({ rows: [{ count: '1' }], rowCount: 1 });
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:3000');
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
afterEach(async () => {
  await deps.app?.close();
  await deps.metricsApp?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('platform API startup and shutdown', () => {
  it('registers probes, metrics, auth and per-replica event fanout then drains workers on shutdown', async () => {
    await import('./index.js');
    await vi.waitFor(() => expect(signals.has('SIGTERM')).toBe(true));
    const app = deps.app!;
    expect((await app.inject('/api/health')).json()).toMatchObject({
      status: 'ok',
      service: 'api',
      llm: 'mock',
    });
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
    expect((await app.inject('/metrics')).statusCode).toBe(404);
    expect((await deps.metricsApp!.inject('/metrics')).body).toContain('api_requests_total');
    expect((await deps.metricsApp!.inject('/api/incidents')).statusCode).toBe(404);
    expect((await deps.metricsApp!.inject('/ws')).statusCode).toBe(404);
    expect(deps.metricsApp!.listen).toHaveBeenCalledWith({ port: 4001, host: '0.0.0.0' });
    const closeMetrics = vi.spyOn(deps.metricsApp!, 'close');
    expect((await app.inject('/api/incidents')).statusCode).toBe(401);
    deps.query.mockRejectedValueOnce(new Error('database down'));
    expect((await app.inject('/api/ready')).statusCode).toBe(503);
    expect(deps.fanout?.topics).toContain('incident.events');
    await deps.fanout?.handler(
      {
        type: 'INCIDENT_UPDATED',
        payload: { incidentId: 'INC-1' },
        timestamp: new Date().toISOString(),
      },
      { topic: 'incident.events' }
    );
    expect(await deps.publish?.('incident.events', {}, 'INC-1')).toBe(true);
    signals.get('SIGTERM')?.();
    await vi.waitFor(() => expect(deps.closePool).toHaveBeenCalledOnce());
    expect(deps.stopWorker).toHaveBeenCalledOnce();
    expect(deps.stopOutbox).toHaveBeenCalledOnce();
    expect(deps.stopConsumer).toHaveBeenCalledOnce();
    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(closeMetrics).toHaveBeenCalledOnce();
    expect(deps.stopWorker.mock.invocationCallOrder[0]).toBeLessThan(
      deps.disconnect.mock.invocationCallOrder[0]!
    );
  }, 20000);
  it('refuses weak non-demo secrets before migration or opening listeners', async () => {
    deps.env.DEMO_MODE = false;
    deps.env.JWT_SECRET = 'weak';
    await import('./index.js');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(deps.up).not.toHaveBeenCalled();
    expect(deps.app).toBeNull();
  });
  it('refuses wildcard non-demo CORS before connecting the producer', async () => {
    deps.env.DEMO_MODE = false;
    vi.stubEnv('CORS_ORIGIN', '*');
    await import('./index.js');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(deps.connect).not.toHaveBeenCalled();
    expect(deps.log.error).toHaveBeenCalled();
  });
});
