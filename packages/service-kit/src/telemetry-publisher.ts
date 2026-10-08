import type { Registry } from 'prom-client';
import { EventProducer } from '@sentinelops/kafka';
import {
  Topics,
  EventType,
  makeEnvelope,
  type MetricSample,
} from '@sentinelops/shared-types';
import type { Logger } from '@sentinelops/logger';

/**
 * Publishes a snapshot of the service's own collected metrics to the
 * `telemetry.events` topic on an interval. This is what feeds the control plane
 * real data: the samples come from the live prom-client registry, not fabricated.
 *
 * Best-effort via EventProducer — a broker outage never blocks the service.
 * Enabled per service by env (KAFKA_TELEMETRY=on), which the docker stack sets.
 */
const TRACKED_METRICS = new Set([
  'cpu_usage',
  'memory_usage',
  'db_pool_utilization',
  'queue_depth',
  'db_query_latency_ms',
  'redis_latency_ms',
  'http_request_duration_ms',
]);

export class TelemetryPublisher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private producer: EventProducer,
    private serviceName: string,
    private registry: Registry,
    private log: Logger,
  ) {}

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const metrics = await this.registry.getMetricsAsJSON();
      const now = new Date().toISOString();
      const samples: MetricSample[] = [];

      for (const m of metrics) {
        if (!TRACKED_METRICS.has(m.name)) continue;
        const mtype = String(m.type);
        if (mtype === 'gauge') {
          const v = m.values[0];
          if (v) samples.push({ metric: m.name, value: v.value, labels: {}, ts: now });
        } else if (mtype === 'histogram') {
          // Emit the running average (sum/count) as the metric's representative value.
          // prom-client tags histogram sub-values with metricName (_sum/_count),
          // but the exported type omits it — narrow locally.
          const named = m.values as Array<{ metricName?: string; value: number }>;
          const sum = named.find((x) => x.metricName?.endsWith('_sum'));
          const count = named.find((x) => x.metricName?.endsWith('_count'));
          if (sum && count && count.value > 0) {
            samples.push({
              metric: m.name,
              value: sum.value / count.value,
              labels: { stat: 'avg' },
              ts: now,
            });
          }
        }
      }

      if (samples.length === 0) return;
      await this.producer.send(
        Topics.telemetry,
        makeEnvelope({
          type: EventType.TELEMETRY_SAMPLE,
          service: this.serviceName,
          payload: { samples },
        }),
      );
    } catch (err) {
      this.log.debug({ err: (err as Error).message }, 'telemetry publish tick failed');
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
