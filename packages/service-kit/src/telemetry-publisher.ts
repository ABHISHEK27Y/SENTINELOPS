import { hostname } from 'node:os';

import type { Registry } from 'prom-client';

import { EventProducer } from '@sentinelops/kafka';
import type { Logger } from '@sentinelops/logger';
import { Topics, EventType, makeEnvelope, type MetricSample } from '@sentinelops/shared-types';

interface ExportedMetric {
  name: string;
  values: Array<{ metricName?: string; value: number; labels?: Record<string, string | number> }>;
}
const gauges = new Set(['cpu_usage', 'memory_usage', 'db_pool_utilization', 'queue_depth']);
const histograms = new Set(['db_query_latency_ms', 'redis_latency_ms', 'http_request_duration_ms']);
const application = (v: ExportedMetric['values'][number]) =>
  !/^\/(health|metrics|admin)(\/|$)/.test(String(v.labels?.['route'] ?? ''));

/** Converts cumulative registry data to complete interval samples across labels. */
export class IntervalSampler {
  private previous = new Map<string, number>();
  private at: number | null = null;
  constructor(private instance = process.env['SERVICE_INSTANCE_ID'] ?? hostname()) {}
  sample(metrics: ExportedMetric[], nowMs = Date.now()): MetricSample[] {
    const seconds = this.at === null ? 0 : (nowMs - this.at) / 1000;
    const samples: MetricSample[] = [];
    const emit = (metric: string, value: number, stat = 'gauge') => {
      if (Number.isFinite(value))
        samples.push({
          metric,
          value,
          labels: { instance: this.instance, stat },
          ts: new Date(nowMs).toISOString(),
        });
    };
    let requests = 0;
    let errors = 0;
    for (const m of metrics) {
      const values = m.values.filter(application);
      if (gauges.has(m.name)) {
        emit(
          m.name,
          values.reduce((sum, v) => sum + v.value, 0)
        );
        continue;
      }
      if (histograms.has(m.name)) {
        const sum = values
          .filter(v => v.metricName?.endsWith('_sum'))
          .reduce((s, v) => s + v.value, 0);
        const count = values
          .filter(v => v.metricName?.endsWith('_count'))
          .reduce((s, v) => s + v.value, 0);
        const oldSum = this.previous.get(`${m.name}:sum`);
        const oldCount = this.previous.get(`${m.name}:count`);
        if (oldSum !== undefined && oldCount !== undefined && count > oldCount && sum >= oldSum)
          emit(m.name, (sum - oldSum) / (count - oldCount), 'interval_avg');
        this.previous.set(`${m.name}:sum`, sum);
        this.previous.set(`${m.name}:count`, count);
      }
      if (m.name === 'http_requests_total') {
        const total = values.reduce((s, v) => s + v.value, 0);
        const errorTotal = values
          .filter(v => Number(v.labels?.['status']) >= 500)
          .reduce((s, v) => s + v.value, 0);
        requests = Math.max(0, total - (this.previous.get('requests') ?? total));
        errors = Math.max(0, errorTotal - (this.previous.get('errors') ?? errorTotal));
        this.previous.set('requests', total);
        this.previous.set('errors', errorTotal);
      }
    }
    if (seconds > 0) {
      emit('request_rate', requests / seconds, 'rate');
      if (requests > 0) emit('error_rate', errors / requests, 'fraction');
    }
    this.at = nowMs;
    return samples;
  }
}

export class TelemetryPublisher {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private sampler = new IntervalSampler();
  constructor(
    private producer: EventProducer,
    private serviceName: string,
    private registry: Registry,
    private log: Logger
  ) {}
  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.tick().finally(() => {
          this.running = null;
        });
    }, intervalMs);
    this.timer.unref();
  }
  private async tick(): Promise<void> {
    try {
      const samples = this.sampler.sample(
        (await this.registry.getMetricsAsJSON()) as ExportedMetric[]
      );
      if (samples.length)
        await this.producer.send(
          Topics.telemetry,
          makeEnvelope({
            type: EventType.TELEMETRY_SAMPLE,
            service: this.serviceName,
            payload: { samples },
          })
        );
    } catch (err) {
      this.log.warn({ err }, 'telemetry publish failed');
    }
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}
