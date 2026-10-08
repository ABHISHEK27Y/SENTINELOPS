import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { createLogger } from '@sentinelops/logger';
import { getEnv } from '@sentinelops/config';
import { EventConsumer, EventProducer } from '@sentinelops/kafka';
import { Topics } from '@sentinelops/shared-types';
import { getLlmProvider } from '@sentinelops/ai';
import { closePool } from '@sentinelops/db';
import { seedUsers, registerAuthRoutes } from './auth.js';
import { buildRunbookRetriever } from './runbooks.js';
import { registerServiceRoutes } from './routes/services.js';
import { registerIncidentRoutes } from './routes/incidents.js';
import { registerRemediationRoutes } from './routes/remediation.js';
import { registerFailureRoutes } from './routes/failures.js';

const PORT = Number(process.env.API_PORT ?? 4000);
const log = createLogger({ service: 'api' });
const env = getEnv();

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_EXPIRES_IN } });
  await app.register(websocket);

  // Seed default users (best-effort — needs migrations applied).
  try {
    await seedUsers();
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'user seeding skipped (run db:migrate?)');
  }

  const retriever = await buildRunbookRetriever();
  const provider = getLlmProvider();
  log.info({ llm: provider.name, runbookChunks: retriever.size() }, 'ai + rag ready');

  const producer = new EventProducer({ logger: log.child({ mod: 'producer' }) });
  await producer.connect();

  app.get('/api/health', async () => ({ status: 'ok', service: 'api', llm: provider.name }));

  registerAuthRoutes(app);
  registerServiceRoutes(app);
  registerIncidentRoutes(app, retriever, provider);
  registerRemediationRoutes(app, producer);
  registerFailureRoutes(app);

  // WebSocket: broadcast control-plane events to connected dashboards.
  const sockets = new Set<{ send: (data: string) => void }>();
  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString() }));
    socket.on('close', () => sockets.delete(socket));
  });

  const wsConsumer = new EventConsumer({ groupId: `api-ws-${process.pid}`, dlqProducer: producer, logger: log.child({ mod: 'ws' }) });
  wsConsumer
    .run({
      topics: [Topics.incident, Topics.remediation, Topics.recovery, Topics.anomaly],
      handler: async (envelope, ctx) => {
        const msg = JSON.stringify({ topic: ctx.topic, type: envelope.type, payload: envelope.payload, ts: envelope.timestamp });
        for (const s of sockets) {
          try { s.send(msg); } catch { /* ignore */ }
        }
      },
    })
    .catch((err) => log.warn({ err: (err as Error).message }, 'ws consumer not started'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info({ port: PORT }, 'platform api listening');

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    await wsConsumer.stop().catch(() => undefined);
    await producer.disconnect();
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err: (err as Error).message }, 'api failed to start');
  process.exit(1);
});
