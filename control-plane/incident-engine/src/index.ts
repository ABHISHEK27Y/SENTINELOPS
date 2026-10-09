/**
 * incident-engine — the correlation + lifecycle core. Consumes `anomaly.events`,
 * groups related anomalies into a single incident (time window + dependency
 * graph), computes severity from measurable signals, persists incidents/timeline
 * to Postgres, and emits `incident.events`. Idempotent incident creation via the
 * unique correlation_id (see ARCHITECTURE §6, §7).
 */
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

import { getEnv } from '@sentinelops/config';
import { DependencyGraph, Correlator } from '@sentinelops/correlation';
import { getPool, closePool } from '@sentinelops/db';
import { EventConsumer, EventProducer, RedisIdempotencyStore } from '@sentinelops/kafka';
import { createLogger } from '@sentinelops/logger';
import { rankRootCauses } from '@sentinelops/root-cause';
import { startHealthServer } from '@sentinelops/service-kit';
import {
  Topics,
  EventType,
  IncidentStatus,
  makeEnvelope,
  AnomalySchema,
  type Anomaly,
} from '@sentinelops/shared-types';

import { severityForGroup } from './severity.js';
import { SERVICE_DEPENDENCIES } from './topology.js';

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

const graph = new DependencyGraph(SERVICE_DEPENDENCIES);
const correlator = new Correlator(graph, { windowMs: 60_000, maxHops: 2 });
const producer = new EventProducer({ logger: log.child({ mod: 'producer' }) });
const consumer = new EventConsumer({
  groupId: 'incident-engine',
  idempotency: new RedisIdempotencyStore({ url: env.REDIS_URL, prefix: 'idem:incident' }),
  dlqProducer: producer,
  logger: log.child({ mod: 'consumer' }),
});

async function persistAnomaly(a: Anomaly, incidentId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO anomalies
       (id, service_id, metric, value, baseline, deviation, anomaly_score,
        method, severity, incident_id, window_start, window_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [
      a.anomalyId,
      a.service,
      a.metric,
      a.value,
      a.baseline,
      a.deviation,
      a.anomalyScore,
      a.method,
      a.severity,
      incidentId,
      a.windowStart,
      a.windowEnd,
    ]
  );
}

async function appendTimeline(
  incidentId: string,
  kind: string,
  message: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await getPool().query(
    `INSERT INTO incident_events (incident_id, kind, message, data)
     VALUES ($1,$2,$3,$4)`,
    [incidentId, kind, message, JSON.stringify(data)]
  );
}

async function handleAnomaly(anomaly: Anomaly): Promise<void> {
  mAnomalies.inc();
  const result = correlator.ingest(anomaly);
  mOpen.set(correlator.openGroups().length);
  const group = correlator.get(result.correlationId);
  if (!group) return;

  const { severity, score } = severityForGroup(group);
  const services = [...group.services];
  const title = `Degradation on ${anomaly.service} (${services.length} service${
    services.length > 1 ? 's' : ''
  } affected)`;

  // Rank probable root causes from the correlated anomalies + dependency graph.
  const hypotheses = rankRootCauses({
    anomalies: group.anomalies,
    services,
    edges: SERVICE_DEPENDENCIES,
    incidentStartMs: group.firstSeen,
  });
  const topCause = hypotheses[0] ?? null;
  const confidence = topCause ? topCause.confidence : score;
  const rootCauseJson = topCause ? JSON.stringify(topCause) : null;

  if (result.isNew) {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO incidents
         (id, title, status, severity, affected_services, correlation_id,
          root_cause, confidence, started_at, detected_at)
       VALUES ('INC-'||nextval('incident_seq'), $1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (correlation_id) DO NOTHING
       RETURNING id`,
      [
        title,
        IncidentStatus.DETECTED,
        severity,
        services,
        result.correlationId,
        rootCauseJson,
        confidence,
        new Date(group.firstSeen).toISOString(),
      ]
    );
    if (rows.length > 0) {
      const incidentId = rows[0]!.id;
      await persistAnomaly(anomaly, incidentId);
      await appendTimeline(incidentId, 'DETECTED', title, {
        severity,
        score,
        trigger: anomaly.metric,
      });
      if (topCause) {
        await appendTimeline(incidentId, 'root_cause', topCause.title, {
          confidence: topCause.confidence,
          evidence: topCause.evidence.length,
        });
      }
      mIncidents.inc({ severity });
      log.warn({ incidentId, severity, services, trigger: anomaly.metric }, 'incident created');
      await producer.send(
        Topics.incident,
        makeEnvelope({
          type: EventType.INCIDENT_DETECTED,
          service: 'incident-engine',
          correlationId: result.correlationId,
          payload: {
            incidentId,
            title,
            severity,
            affectedServices: services,
            confidence,
            rootCause: topCause?.title ?? null,
          },
        }),
        incidentId
      );
      return;
    }
    // Lost the insert race — fall through to update.
  }

  // Existing incident: update severity/services and append to the timeline.
  const { rows } = await getPool().query<{ id: string; status: string }>(
    `UPDATE incidents
        SET severity = $1, affected_services = $2, root_cause = $3,
            confidence = $4, updated_at = now()
      WHERE correlation_id = $5
      RETURNING id, status`,
    [severity, services, rootCauseJson, confidence, result.correlationId]
  );
  if (rows.length === 0) return;
  const incidentId = rows[0]!.id;
  await persistAnomaly(anomaly, incidentId);
  await appendTimeline(
    incidentId,
    'anomaly_correlated',
    `${anomaly.metric} anomaly on ${anomaly.service}`,
    { score: anomaly.anomalyScore, severity }
  );
  await producer.send(
    Topics.incident,
    makeEnvelope({
      type: EventType.INCIDENT_UPDATED,
      service: 'incident-engine',
      correlationId: result.correlationId,
      payload: {
        incidentId,
        severity,
        affectedServices: services,
        anomalyCount: result.anomalyCount,
      },
    }),
    incidentId
  );
}

async function main(): Promise<void> {
  await producer.connect();
  const health = await startHealthServer({
    serviceName: 'incident-engine',
    port: PORT,
    registry,
  });
  log.info({ port: PORT }, 'incident-engine health/metrics up');

  await consumer.run({
    topics: [Topics.anomaly],
    handler: async envelope => {
      const parsed = AnomalySchema.safeParse(envelope.payload);
      if (!parsed.success) {
        throw new Error(`invalid anomaly payload: ${parsed.error.message}`);
      }
      await handleAnomaly(parsed.data);
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

main().catch(err => {
  log.error({ err: (err as Error).message }, 'incident-engine failed');
  process.exit(1);
});
