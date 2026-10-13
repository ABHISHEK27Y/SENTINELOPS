import { timingSafeEqual } from 'node:crypto';

import { context, trace } from '@opentelemetry/api';
import Fastify, { type FastifyInstance } from 'fastify';

import { getEnv } from '@sentinelops/config';
import { EventProducer } from '@sentinelops/kafka';
import { createLogger, type Logger } from '@sentinelops/logger';
import {
  ServiceHealth,
  FaultType,
  Topics,
  EventType,
  makeEnvelope,
  type FaultType as FaultTypeT,
} from '@sentinelops/shared-types';

import { FaultController, type FaultParams } from './faults.js';
import { createMetrics, type ServiceMetrics } from './metrics.js';
import { TelemetryPublisher } from './telemetry-publisher.js';

export interface ServiceContext {
  app: FastifyInstance;
  log: Logger;
  metrics: ServiceMetrics;
  faults: FaultController;
  serviceName: string;
  /** Simulate a DB query: respects db_latency faults, records metrics. */
  simulateDbQuery: (baseMs?: number) => Promise<number>;
  /** Simulate a Redis op: respects break_redis faults, records metrics. */
  simulateRedisOp: (baseMs?: number) => Promise<number>;
  health: () => ServiceHealth;
  start: (port: number) => Promise<void>;
  stop: () => Promise<void>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface CreateServiceOptions {
  serviceName: string;
  /** Baseline DB query latency in ms when healthy. */
  dbBaselineMs?: number;
  /** Baseline Redis latency in ms when healthy. */
  redisBaselineMs?: number;
}

export function createService(opts: CreateServiceOptions): ServiceContext {
  const { serviceName } = opts;
  const dbBaselineMs = opts.dbBaselineMs ?? 20;
  const redisBaselineMs = opts.redisBaselineMs ?? 2;

  const log = createLogger({ service: serviceName });
  const metrics = createMetrics(serviceName);
  const faults = new FaultController();

  // Kafka telemetry publishing is opt-in (the docker stack sets KAFKA_TELEMETRY=on)
  // so local `npm run dev` without a broker stays quiet. Always best-effort.
  const kafkaEnabled = process.env['KAFKA_TELEMETRY'] === 'on';
  const producer = kafkaEnabled ? new EventProducer({ logger: log.child({ mod: 'kafka' }) }) : null;
  const publisher = producer
    ? new TelemetryPublisher(producer, serviceName, metrics.registry, log)
    : null;

  const app = Fastify({ logger: false });
  const env = getEnv();
  if (env.DEMO_MODE && env.INTERNAL_API_TOKEN.length < 32)
    throw new Error(
      'demo fault administration requires INTERNAL_API_TOKEN of at least 32 characters'
    );
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/admin/')) return;
    if (!env.DEMO_MODE) return reply.code(404).send({ error: 'demo administration disabled' });
    const token = req.headers['x-internal-token'];
    if (
      typeof token !== 'string' ||
      Buffer.byteLength(token) !== Buffer.byteLength(env.INTERNAL_API_TOKEN) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(env.INTERNAL_API_TOKEN))
    ) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // ── Request timing + access logging ──────────────────────────────────
  app.addHook('onRequest', async req => {
    (req as { startTime?: bigint }).startTime = process.hrtime.bigint();
    const rid = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
    (req as { requestId?: string }).requestId = rid;
    const span = trace.getSpan(context.active());
    if (span) (req as { traceId?: string }).traceId = span.spanContext().traceId;
  });
  app.addHook('preHandler', async (req, reply) => {
    if (/^\/(health|metrics|admin)(\/|$)/.test(req.url)) return;
    if (faults.isKilled() || faults.networkBroken())
      return reply.code(503).send({ error: 'injected service/dependency failure' });
    if (Math.random() < faults.errorProbability())
      return reply.code(500).send({ error: 'injected error' });
    const lag = faults.kafkaLagMs();
    if (lag > 0) await sleep(lag); // explicit simulated dependency delay
    const factor = faults.trafficSpikeFactor();
    if (factor > 1) {
      // Real additional demo dependency work; bounded to avoid unbounded fan-out.
      await Promise.all(
        Array.from({ length: Math.min(10, Math.floor(factor)) - 1 }, () => simulateDbQuery())
      );
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const start = (req as { startTime?: bigint }).startTime;
    const durationMs = start ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
    const route = req.routeOptions?.url ?? 'unmatched';
    const status = String(reply.statusCode);
    const labels = { method: req.method, route, status };
    metrics.httpDuration.observe(labels, durationMs);
    metrics.httpTotal.inc(labels);
    if (reply.statusCode >= 500) {
      metrics.httpErrors.inc({ method: req.method, route });
    }
    const line = {
      requestId: (req as { requestId?: string }).requestId,
      method: req.method,
      route,
      status: reply.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };
    if (reply.statusCode >= 500) {
      log.error(line, 'request failed');
      // Ship the error log onto the log.events topic as incident evidence.
      if (producer) {
        const reqTraceId = (req as { traceId?: string }).traceId;
        void producer.send(
          Topics.logs,
          makeEnvelope({
            type: EventType.LOG_RECORD,
            service: serviceName,
            traceId: reqTraceId,
            payload: {
              level: 'ERROR',
              message: 'request failed',
              requestId: (req as { requestId?: string }).requestId,
              fields: { route, status: reply.statusCode, durationMs: line.durationMs },
              ts: new Date().toISOString(),
            },
          } as { type: string; service: string; traceId?: string; payload: unknown })
        );
      }
    } else log.debug(line, 'request');
  });

  // ── Health / readiness / liveness ────────────────────────────────────
  const health = (): ServiceHealth => {
    if (faults.isKilled()) return ServiceHealth.UNHEALTHY;
    if (faults.dbLatencyMs() > 0 || faults.errorProbability() > 0) return ServiceHealth.DEGRADED;
    return ServiceHealth.HEALTHY;
  };

  app.get('/health', async (_req, reply) => {
    const h = health();
    const code = h === ServiceHealth.UNHEALTHY ? 503 : 200;
    return reply.code(code).send({ service: serviceName, health: h });
  });
  app.get('/health/live', async () => ({ status: 'alive' }));
  app.get('/health/ready', async (_req, reply) => {
    const ready = !faults.isKilled();
    return reply.code(ready ? 200 : 503).send({ ready });
  });

  // ── Prometheus metrics ───────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  // ── Fault administration (used by the failure-injection API) ─────────
  app.get('/admin/faults', async () => ({ faults: faults.list() }));
  app.post<{ Body: { type: FaultTypeT; params?: FaultParams } }>(
    '/admin/faults',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type'],
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: Object.values(FaultType) },
            params: {
              type: 'object',
              additionalProperties: false,
              properties: {
                targetMs: { type: 'number', minimum: 0, maximum: 5000 },
                probability: { type: 'number', minimum: 0, maximum: 1 },
                ttlMs: { type: 'number', minimum: 100, maximum: 900000 },
                factor: { type: 'number', minimum: 1, maximum: 10 },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { type, params } = req.body ?? ({} as { type: FaultTypeT });
      const valid = Object.values(FaultType).includes(type);
      if (!valid) return reply.code(400).send({ error: `unknown fault: ${type}` });
      const fault = faults.enable(type, params ?? {});
      log.warn({ fault: type, params }, 'fault injected');
      return { enabled: fault };
    }
  );
  app.delete<{ Params: { type: FaultTypeT } }>('/admin/faults/:type', async req => {
    faults.disable(req.params.type);
    log.info({ fault: req.params.type }, 'fault cleared');
    return { cleared: req.params.type };
  });
  app.delete('/admin/faults', async () => {
    faults.clear();
    return { cleared: 'all' };
  });

  // ── Simulated dependency calls (real timing, fault-aware) ────────────
  const simulateDbQuery = async (baseMs = dbBaselineMs): Promise<number> => {
    if (faults.networkBroken()) throw new Error('injected database network failure');
    const jitter = baseMs * (0.5 + Math.random());
    const latency = jitter + faults.dbLatencyMs();
    metrics.dbPoolUtilization.set(faults.dbPoolPressure(dbBaselineMs));
    await sleep(latency);
    metrics.dbQueryLatency.observe(latency);
    return latency;
  };

  const simulateRedisOp = async (baseMs = redisBaselineMs): Promise<number> => {
    if (faults.networkBroken()) throw new Error('injected cache network failure');
    if (faults.redisBroken()) {
      metrics.redisLatency.observe(250);
      throw new Error('redis connection refused (fault: break_redis)');
    }
    const latency = baseMs * (0.5 + Math.random());
    await sleep(latency);
    metrics.redisLatency.observe(latency);
    return latency;
  };

  // ── Background resource gauges (real process stats) ──────────────────
  let lastCpu = process.cpuUsage();
  let lastHr = process.hrtime.bigint();
  const infraTimer = setInterval(() => {
    const cpu = process.cpuUsage();
    const now = process.hrtime.bigint();
    const elapsedUs = Number(now - lastHr) / 1e3;
    const usedUs = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
    const frac = elapsedUs > 0 ? Math.min(1, usedUs / elapsedUs) : 0;
    metrics.cpuUsage.set(Math.round(frac * 1000) / 1000);
    metrics.memoryUsage.set(process.memoryUsage().rss);
    // Only drive queue_depth from the kafka_lag fault; services that own a real
    // queue (e.g. notification-service) set this gauge themselves.
    if (serviceName !== 'notification-service') metrics.queueDepth.set(faults.kafkaLagMs() / 10);
    lastCpu = cpu;
    lastHr = now;
  }, 2000);
  infraTimer.unref();

  const start = async (port: number): Promise<void> => {
    await app.listen({ port, host: '0.0.0.0' });
    if (producer && publisher) {
      await producer.connect(); // best-effort
      publisher.start();
      log.info('kafka telemetry publishing enabled');
    }
    log.info({ port }, `${serviceName} listening`);
  };

  const stop = async (): Promise<void> => {
    clearInterval(infraTimer);
    await publisher?.stop();
    faults.clear();
    await app.close();
    await producer?.disconnect();
  };

  return {
    app,
    log,
    metrics,
    faults,
    serviceName,
    simulateDbQuery,
    simulateRedisOp,
    health,
    start,
    stop,
  };
}
