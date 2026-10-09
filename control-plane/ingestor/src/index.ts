/**
 * telemetry-ingestor — the persistence + normalization stage (Phase 5). Consumes
 * `telemetry.events` and `log.events`, writes samples to the `metrics` table and
 * records to `logs`, and republishes normalized samples on `metrics.events`. This
 * is what populates the store the platform API and recovery verifier read from.
 */
import { Registry, Counter, collectDefaultMetrics } from 'prom-client';
import { EventConsumer, EventProducer, RedisIdempotencyStore } from '@sentinelops/kafka';
import { getPool, closePool } from '@sentinelops/db';
import { startHealthServer } from '@sentinelops/service-kit';
import { createLogger } from '@sentinelops/logger';
import { getEnv } from '@sentinelops/config';
import { Topics, EventType, makeEnvelope, type MetricSample } from '@sentinelops/shared-types';

const PORT = Number(process.env.INGESTOR_PORT ?? 8095);
const log = createLogger({ service: 'ingestor' });
const env = getEnv();

const registry = new Registry();
registry.setDefaultLabels({ service: 'ingestor' });
collectDefaultMetrics({ register: registry });
const mMetrics = new Counter({ name: 'metrics_ingested_total', help: 'Metric samples persisted', registers: [registry] });
const mLogs = new Counter({ name: 'logs_ingested_total', help: 'Log records persisted', registers: [registry] });

const producer = new EventProducer({ logger: log.child({ mod: 'producer' }) });
const consumer = new EventConsumer({
  groupId: 'ingestor',
  idempotency: new RedisIdempotencyStore({ url: env.REDIS_URL, prefix: 'idem:ingestor' }),
  dlqProducer: producer,
  logger: log.child({ mod: 'consumer' }),
});

function extractSamples(payload: unknown): MetricSample[] {
  if (payload && typeof payload === 'object') {
    const p = payload as { samples?: MetricSample[] };
    if (Array.isArray(p.samples)) return p.samples;
  }
  return [];
}

async function main(): Promise<void> {
  await producer.connect();
  const health = await startHealthServer({ serviceName: 'ingestor', port: PORT, registry });
  log.info({ port: PORT }, 'ingestor up');

  await consumer.run({
    topics: [Topics.telemetry, Topics.logs],
    handler: async (envelope, ctx) => {
      if (ctx.topic === Topics.telemetry) {
        const samples = extractSamples(envelope.payload);
        for (const s of samples) {
          await getPool().query(
            `INSERT INTO metrics (service_id, metric, value, labels, ts) VALUES ($1,$2,$3,$4,$5)`,
            [envelope.service, s.metric, s.value, JSON.stringify(s.labels ?? {}), s.ts],
          );
          mMetrics.inc();
        }
        // Republish normalized samples for any metrics.events consumer.
        if (samples.length > 0) {
          await producer.send(Topics.metrics, makeEnvelope({
            type: EventType.METRIC_SAMPLE, service: envelope.service, payload: { samples },
          }));
        }
      } else if (ctx.topic === Topics.logs) {
        const p = envelope.payload as {
          level?: string; message?: string; requestId?: string; error?: string;
          fields?: Record<string, unknown>; ts?: string;
        };
        await getPool().query(
          `INSERT INTO logs (service_id, level, message, request_id, trace_id, error, fields, ts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [envelope.service, p.level ?? 'INFO', p.message ?? '', p.requestId ?? null,
           envelope.traceId ?? null, p.error ?? null, JSON.stringify(p.fields ?? {}), p.ts ?? new Date().toISOString()],
        );
        mLogs.inc();
      }
    },
  });

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    await consumer.stop();
    await producer.disconnect();
    await health.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err: (err as Error).message }, 'ingestor failed');
  process.exit(1);
});
