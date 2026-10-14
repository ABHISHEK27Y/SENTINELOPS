import { hostname } from 'node:os';

import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { Registry, collectDefaultMetrics, Histogram, Counter } from 'prom-client';

import { getLlmProvider } from '@sentinelops/ai';
import { getEnv } from '@sentinelops/config';
import { closePool, up, query, startOutbox } from '@sentinelops/db';
import { EventConsumer, EventProducer } from '@sentinelops/kafka';
import { createLogger } from '@sentinelops/logger';
import { Topics, type TopicName, type EventEnvelope } from '@sentinelops/shared-types';

import { seedUsers, registerAuthRoutes } from './auth.js';
import { registerEventSocket } from './event-socket.js';
import { startRemediationWorker } from './remediation-worker.js';
import { registerFailureRoutes } from './routes/failures.js';
import { registerIncidentRoutes } from './routes/incidents.js';
import { registerRemediationRoutes } from './routes/remediation.js';
import { registerServiceRoutes } from './routes/services.js';
import { buildRunbookRetriever } from './runbooks.js';

const PORT = Number(process.env['API_PORT'] ?? 4000);
const log = createLogger({ service: 'api' });
const env = getEnv();

/** Parse CORS_ORIGIN env var (comma-separated) or default to localhost for dev. */
function corsOrigin(): string | string[] | boolean {
  const raw = process.env['CORS_ORIGIN']?.trim();
  if (!raw) return env.CORS_ORIGIN.split(',').map(s => s.trim());
  if (raw === '*' && env.NODE_ENV === 'production' && !env.DEMO_MODE)
    throw new Error('production CORS requires explicit origins');
  if (raw === '*') return true;
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  if (
    env.NODE_ENV === 'production' &&
    !env.DEMO_MODE &&
    (env.JWT_SECRET.length < 32 || /change.me|dev.only/i.test(env.JWT_SECRET))
  ) {
    throw new Error('production API requires a strong explicit JWT_SECRET');
  }
  await up();
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: corsOrigin(), credentials: true });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_EXPIRES_IN } });
  await app.register(websocket);

  await seedUsers();

  const retriever = await buildRunbookRetriever();
  const provider = getLlmProvider();
  log.info({ llm: provider.name, runbookChunks: retriever.size() }, 'ai + rag ready');

  const producer = new EventProducer({ strict: true, logger: log.child({ mod: 'producer' }) });
  await producer.connect();
  const stopOutbox = startOutbox(
    (topic, envelope, key) => producer.send(topic as TopicName, envelope as EventEnvelope, key),
    err => log.error({ err }, 'outbox dispatch failed')
  );
  const stopWorker = startRemediationWorker(err =>
    log.error({ err }, 'remediation worker retrying after failure')
  );

  const registry = new Registry();
  registry.setDefaultLabels({ service: 'api' });
  collectDefaultMetrics({ register: registry });
  const requests = new Counter({
    name: 'api_requests_total',
    help: 'Platform requests',
    labelNames: ['route', 'status'],
    registers: [registry],
  });
  const latency = new Histogram({
    name: 'api_request_duration_seconds',
    help: 'Platform request duration',
    labelNames: ['route'],
    registers: [registry],
  });
  const starts = new WeakMap<object, number>();
  app.addHook('onRequest', async req => {
    starts.set(req, performance.now());
  });
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    requests.inc({ route, status: String(reply.statusCode) });
    latency.observe({ route }, (performance.now() - (starts.get(req) ?? performance.now())) / 1000);
  });
  // A separate listener lets NetworkPolicy expose metrics without exposing the API.
  const metricsApp = Fastify({ logger: false });
  metricsApp.get('/metrics', async (_req, reply) =>
    reply.header('Content-Type', registry.contentType).send(await registry.metrics())
  );
  app.get('/api/ready', async (_req, reply) => {
    try {
      await query('SELECT 1');
      return { ready: true };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });

  app.get('/api/health', async () => ({ status: 'ok', service: 'api', llm: provider.name }));

  registerAuthRoutes(app);
  registerServiceRoutes(app);
  registerIncidentRoutes(app, retriever, provider);
  registerRemediationRoutes(app);
  registerFailureRoutes(app);

  // WebSocket: broadcast control-plane events to connected dashboards.
  const broadcast = registerEventSocket(app, corsOrigin());

  const wsConsumer = new EventConsumer({
    groupId: `api-ws-${process.env['API_INSTANCE_ID'] ?? hostname()}-${PORT}`,
    dlqProducer: producer,
    logger: log.child({ mod: 'ws' }),
  });
  wsConsumer
    .run({
      topics: [Topics.incident, Topics.remediation, Topics.recovery, Topics.anomaly],
      handler: async (envelope, ctx) => {
        const msg = JSON.stringify({
          topic: ctx.topic,
          type: envelope.type,
          payload: envelope.payload,
          ts: envelope.timestamp,
        });
        broadcast(msg);
      },
    })
    .catch(err => log.warn({ err: (err as Error).message }, 'ws consumer not started'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  await metricsApp.listen({ port: 4001, host: '0.0.0.0' });
  log.info({ port: PORT }, 'platform api listening');

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    await wsConsumer.stop().catch(() => undefined);
    await stopWorker();
    await stopOutbox();
    await producer.disconnect();
    await app.close();
    await metricsApp.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(err => {
  log.error({ err: (err as Error).message }, 'api failed to start');
  process.exit(1);
});
