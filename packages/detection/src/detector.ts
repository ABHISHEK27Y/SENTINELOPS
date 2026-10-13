import {
  Severity,
  METRIC_NOISE_FLOORS,
  type Anomaly,
  type Severity as SeverityT,
} from '@sentinelops/shared-types';

import { RollingWindow } from './stats.js';

/** One telemetry sample fed to the detector. */
export interface Sample {
  service: string;
  metric: string;
  value: number;
  ts: string; // ISO
  instance?: string;
}

export interface DetectorConfig {
  /** Rolling window size (samples) for the baseline. */
  windowSize?: number;
  /** Minimum samples before detection starts (warmup). */
  minSamples?: number;
  /** |z| at which a point is first considered anomalous. */
  zThreshold?: number;
  /** |z| that maps to anomalyScore = 1. */
  zSaturation?: number;
  /**
   * Direction that counts as anomalous per metric. Most SRE signals are
   * "higher is worse" (latency, errors, saturation); default 'up'.
   */
  direction?: 'up' | 'down' | 'both';
}

const DEFAULTS: Required<DetectorConfig> = {
  windowSize: 50,
  minSamples: 12,
  zThreshold: 3,
  zSaturation: 8,
  direction: 'up',
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
/** Noisy gauges need repeated abnormal samples before they open an incident. */
const CONFIRMATION_SAMPLES: Readonly<Record<string, number>> = {
  cpu_usage: 3,
  memory_usage: 3,
  queue_depth: 3,
  request_rate: 3,
  db_pool_utilization: 2,
  http_request_duration_ms: 2,
  db_query_latency_ms: 2,
  redis_latency_ms: 2,
};
const CONFIRMATION_MAX_GAP_MS = 20_000;

/** Map a normalized anomaly score (0..1) to a severity bucket. */
export function scoreToSeverity(score: number): SeverityT {
  if (score >= 0.9) return Severity.CRITICAL;
  if (score >= 0.7) return Severity.HIGH;
  if (score >= 0.45) return Severity.MEDIUM;
  if (score > 0) return Severity.LOW;
  return Severity.INFO;
}

/**
 * Per-series statistical anomaly detector. Maintains a rolling baseline per
 * (service, metric) and flags points whose z-score exceeds a threshold in the
 * anomalous direction. Deterministic — the score comes from the data, never
 * random (see ADR-0004).
 */
export class AnomalyDetector {
  private cfg: Required<DetectorConfig>;
  private baselines = new Map<string, RollingWindow>();
  private latest = new Map<string, number>();
  private pending = new Map<string, { count: number; timestamp: number }>();

  constructor(cfg: DetectorConfig = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  private key(s: Sample): string {
    return `${s.service}|${s.metric}|${s.instance ?? 'default'}`;
  }

  /** Feed a sample; returns an Anomaly if it deviates, else null. */
  detect(sample: Sample): Anomaly | null {
    if (!Number.isFinite(sample.value) || !Number.isFinite(Date.parse(sample.ts))) return null;
    const key = this.key(sample);
    const timestamp = Date.parse(sample.ts);
    if (timestamp < (this.latest.get(key) ?? -Infinity)) return null;
    this.latest.set(key, timestamp);
    let win = this.baselines.get(key);
    if (!win) {
      win = new RollingWindow(this.cfg.windowSize);
      this.baselines.set(key, win);
    }

    // Warmup: learn the baseline before judging.
    if (win.size < this.cfg.minSamples) {
      win.push(sample.value);
      return null;
    }

    const mean = win.mean();
    const std = win.std();
    // Scale-aware denominator so flat-but-nonzero series don't over-trigger.
    const denom = Math.max(std, 0.05 * Math.abs(mean), 1e-6);
    const z = (sample.value - mean) / denom;

    const directional =
      this.cfg.direction === 'both' ? Math.abs(z) : this.cfg.direction === 'up' ? z : -z;

    // A sustained fault must not teach the detector that degradation is healthy.
    if (
      directional < this.cfg.zThreshold ||
      Math.abs(sample.value - mean) <= (METRIC_NOISE_FLOORS[sample.metric] ?? 0)
    ) {
      this.pending.delete(key);
      win.push(sample.value);
      return null;
    }

    const required = CONFIRMATION_SAMPLES[sample.metric] ?? 1;
    if (required > 1) {
      const previous = this.pending.get(key);
      const count =
        previous &&
        timestamp > previous.timestamp &&
        timestamp - previous.timestamp <= CONFIRMATION_MAX_GAP_MS
          ? Math.min(previous.count + 1, required)
          : 1;
      this.pending.set(key, { count, timestamp });
      if (count < required) return null;
    }

    const score = clamp01(
      (directional - this.cfg.zThreshold) / (this.cfg.zSaturation - this.cfg.zThreshold)
    );

    return {
      anomalyId: crypto.randomUUID(),
      instance: sample.instance ?? 'default',
      service: sample.service,
      metric: sample.metric,
      value: sample.value,
      baseline: mean,
      deviation: sample.value - mean,
      anomalyScore: score,
      method: 'zscore',
      severity: scoreToSeverity(score),
      windowStart: sample.ts,
      windowEnd: sample.ts,
    };
  }

  /** Reset a series (e.g. after a known deploy/config change). */
  reset(service: string, metric: string): void {
    for (const key of this.baselines.keys())
      if (key.startsWith(`${service}|${metric}|`)) {
        this.baselines.delete(key);
        this.latest.delete(key);
        this.pending.delete(key);
      }
  }

  snapshot(): {
    baselines: Record<string, number[]>;
    latest: Record<string, number>;
    pending: Record<string, { count: number; timestamp: number }>;
  } {
    return {
      baselines: Object.fromEntries(
        [...this.baselines].map(([key, window]) => [key, window.values()])
      ),
      latest: Object.fromEntries(this.latest),
      pending: Object.fromEntries(this.pending),
    };
  }

  restore(state: unknown): void {
    this.baselines.clear();
    this.latest.clear();
    this.pending.clear();
    if (!state || typeof state !== 'object') return;
    const saved = state as { baselines?: unknown; latest?: unknown; pending?: unknown };
    // Adopt the original baseline-only snapshot format on its first new write.
    const baselines =
      saved.baselines && typeof saved.baselines === 'object' ? saved.baselines : state;
    for (const [key, values] of Object.entries(baselines)) {
      if (!Array.isArray(values)) continue;
      const window = new RollingWindow(this.cfg.windowSize);
      for (const value of values)
        if (typeof value === 'number' && Number.isFinite(value)) window.push(value);
      this.baselines.set(key, window);
    }
    if (saved.latest && typeof saved.latest === 'object') {
      for (const [key, value] of Object.entries(saved.latest))
        if (this.baselines.has(key) && typeof value === 'number' && Number.isFinite(value))
          this.latest.set(key, value);
    }
    if (saved.pending && typeof saved.pending === 'object') {
      for (const [key, value] of Object.entries(saved.pending)) {
        const candidate = value as { count?: unknown; timestamp?: unknown } | null;
        if (
          this.baselines.has(key) &&
          candidate &&
          Number.isInteger(candidate.count) &&
          (candidate.count as number) > 0 &&
          (candidate.count as number) <= 3 &&
          typeof candidate.timestamp === 'number' &&
          Number.isFinite(candidate.timestamp)
        )
          this.pending.set(key, {
            count: candidate.count as number,
            timestamp: candidate.timestamp,
          });
      }
    }
  }
}
