/**
 * incident-engine — the correlation + lifecycle core. Consumes `anomaly.events`,
 * groups related anomalies into a single incident (time window + dependency
 * graph), computes severity from measurable signals, persists incidents/timeline
 * to Postgres, and emits `incident.events`. Idempotent incident creation via the
 * unique correlation_id (see ARCHITECTURE §6, §7).
 */
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

import { getEnv } from '@sentinelops/config';
import { up, query, closePool, processEvent, startOutbox } from '@sentinelops/db';
import { EventConsumer, EventProducer, RedisIdempotencyStore } from '@sentinelops/kafka';
import { createLogger } from '@sentinelops/logger';
import { startHealthServer } from '@sentinelops/service-kit';
import {
  Topics,
  AnomalySchema,
  type EventEnvelope,
  type TopicName,
} from '@sentinelops/shared-types';

import { handleAnomaly } from './processor.js';

const PORT = Number(process.env['INCIDENT_ENGINE_PORT'] ?? 8090);
const log = createLogger({ service: 'incident-engine' });
const env = getEnv();

const registry = new Registry();
registry.setDefaultLabels({ service: 'incident-engine' });
collectDefaultMetrics({ register: registry });
const mAnomalies = new Counter({
  name: 'anomalies_correlated_total',
  help: 'Anomalies consumed and correlated',
  registers: [registry],
});
const mIncidents = new Counter({
  name: 'incidents_created_total',
  help: 'Incidents created',
  labelNames: ['severity'] as const,
  registers: [registry],
});
const mOpen = new Gauge({
  name: 'open_correlation_groups',
  help: 'Currently open correlation groups',
  registers: [registry],
});

const producer = new EventProducer({ strict: true, logger: log.child({ mod: 'producer' }) });
const consumer = new EventConsumer({
  groupId: 'incident-engine',
  idempotency: new RedisIdempotencyStore({ url: env.REDIS_URL, prefix: 'idem:incident' }),
  dlqProducer: producer,
  logger: log.child({ mod: 'consumer' }),
});

async function main(): Promise<void> {
  await up();
  await producer.connect();
  const stopOutbox = startOutbox(
    (topic, envelope, key) => producer.send(topic as TopicName, envelope as EventEnvelope, key),
    err => log.error({ err }, 'outbox dispatch failed')
  );
  const health = await startHealthServer({
    serviceName: 'incident-engine',
    port: PORT,
    registry,
    ready: async () => consumer.isRunning && Boolean((await query('SELECT 1')).rowCount),
  });
  log.info({ port: PORT }, 'incident-engine health/metrics up');

  await consumer.run({
    topics: [Topics.anomaly],
    handler: async envelope => {
      const parsed = AnomalySchema.safeParse(envelope.payload);
      if (!parsed.success) {
        throw new Error(`invalid anomaly payload: ${parsed.error.message}`);
      }
      await processEvent('incident-engine', envelope.eventId, () =>
        handleAnomaly(parsed.data, {
          anomaly: () => mAnomalies.inc(),
          open: count => mOpen.set(count),
          created: (incidentId, severity, services, trigger) => {
            mIncidents.inc({ severity });
            log.warn({ incidentId, severity, services, trigger }, 'incident created');
          },
        })
      );
    },
  });

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    await consumer.stop();
    await stopOutbox();
    await producer.disconnect();
    await health.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(err => {
  log.error({ err: (err as Error).message }, 'incident-engine failed');
  process.exit(1);
});
