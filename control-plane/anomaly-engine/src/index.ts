/**
 * anomaly-engine — consumes normalized telemetry, runs the statistical detector
 * per (service, metric), and emits scored anomalies onto `anomaly.events`.
 * Deterministic detection (z-score over rolling baselines); no LLM, no random
 * scores (see ADR-0004). Self-observable via /metrics.
 */
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import {
  EventConsumer,
  EventProducer,
  RedisIdempotencyStore,
} from '@sentinelops/kafka';
import { AnomalyDetector, type Sample } from '@sentinelops/detection';
import { startHealthServer } from '@sentinelops/service-kit';
import { createLogger } from '@sentinelops/logger';
import { getEnv } from '@sentinelops/config';
import {
  Topics,
  EventType,
  makeEnvelope,
  type Anomaly,
  type MetricSample,
} from '@sentinelops/shared-types';

const PORT = Number(process.env.ANOMALY_ENGINE_PORT ?? 8091);
const log = createLogger({ service: 'anomaly-engine' });
const env = getEnv();

// ── Self-metrics ────────────────────────────────────────────────────────
const registry = new Registry();
registry.setDefaultLabels({ service: 'anomaly-engine' });
collectDefaultMetrics({ register: registry });
const mSamples = new Counter({
  name: 'events_processed',
  help: 'Telemetry samples evaluated',
  registers: [registry],
});
const mAnomalies = new Counter({
  name: 'anomalies_emitted_total',
  help: 'Anomalies detected and published',
  labelNames: ['service', 'severity'] as const,
  registers: [registry],
});
const mLatency = new Histogram({
  name: 'detection_latency_ms',
  help: 'Time to evaluate one telemetry event',
  buckets: [0.5, 1, 2, 5, 10, 25, 50],
  registers: [registry],
});

// ── Detection + Kafka ───────────────────────────────────────────────────
const detector = new AnomalyDetector();
const producer = new EventProducer({ logger: log.child({ mod: 'producer' }) });
const consumer = new EventConsumer({
  groupId: 'anomaly-engine',
  idempotency: new RedisIdempotencyStore({ url: env.REDIS_URL, prefix: 'idem:anomaly' }),
  dlqProducer: producer,
  logger: log.child({ mod: 'consumer' }),
});

/** Map a metric name to the anomaly event type. */
function anomalyEventType(metric: string): string {
  if (metric.includes('latency') || metric.includes('duration'))
    return EventType.LATENCY_ANOMALY;
  if (metric.includes('error')) return EventType.ERROR_RATE_ANOMALY;
  if (metric.includes('cpu') || metric.includes('memory'))
    return EventType.RESOURCE_ANOMALY;
  if (metric.includes('pool') || metric.includes('queue') || metric.includes('lag'))
    return EventType.SATURATION_ANOMALY;
  return EventType.LATENCY_ANOMALY;
}

/** Extract MetricSamples from a telemetry/metrics envelope payload. */
function extractSamples(service: string, payload: unknown): Sample[] {
  const out: Sample[] = [];
  const push = (s: Partial<MetricSample> | undefined) => {
    if (s && typeof s.metric === 'string' && typeof s.value === 'number') {
      out.push({ service, metric: s.metric, value: s.value, ts: s.ts ?? new Date().toISOString() });
    }
  };
  if (payload && typeof payload === 'object') {
    const p = payload as { samples?: unknown; metric?: unknown };
    if (Array.isArray(p.samples)) p.samples.forEach((s) => push(s as MetricSample));
    else if (typeof p.metric === 'string') push(payload as MetricSample);
  }
  return out;
}

async function main(): Promise<void> {
  await producer.connect();
  const health = await startHealthServer({
    serviceName: 'anomaly-engine',
    port: PORT,
    registry,
  });
  log.info({ port: PORT }, 'anomaly-engine health/metrics up');

  await consumer.run({
    topics: [Topics.telemetry, Topics.metrics],
    handler: async (envelope) => {
      const samples = extractSamples(envelope.service, envelope.payload);
      for (const sample of samples) {
        const end = mLatency.startTimer();
        const anomaly: Anomaly | null = detector.detect(sample);
        end();
        mSamples.inc();
        if (!anomaly) continue;
        mAnomalies.inc({ service: anomaly.service, severity: anomaly.severity });
        log.warn(
          {
            service: anomaly.service,
            metric: anomaly.metric,
            value: Math.round(anomaly.value),
            baseline: Math.round(anomaly.baseline),
            score: anomaly.anomalyScore.toFixed(2),
            severity: anomaly.severity,
          },
          'anomaly detected',
        );
        await producer.send(
          Topics.anomaly,
          makeEnvelope({
            type: anomalyEventType(anomaly.metric),
            service: anomaly.service,
            traceId: envelope.traceId,
            payload: anomaly,
          }),
        );
      }
    },
  });

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    await consumer.stop();
    await producer.disconnect();
    await health.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err: (err as Error).message }, 'anomaly-engine failed');
  process.exit(1);
});
