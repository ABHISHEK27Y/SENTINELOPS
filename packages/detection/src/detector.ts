import { Severity, type Anomaly, type Severity as SeverityT } from '@sentinelops/shared-types';
import { RollingWindow } from './stats.js';

/** One telemetry sample fed to the detector. */
export interface Sample {
  service: string;
  metric: string;
  value: number;
  ts: string; // ISO
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

  constructor(cfg: DetectorConfig = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  private key(s: Sample): string {
    return `${s.service}|${s.metric}`;
  }

  /** Feed a sample; returns an Anomaly if it deviates, else null. */
  detect(sample: Sample): Anomaly | null {
    const key = this.key(sample);
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

    // Update the baseline with the observed value (after scoring it).
    win.push(sample.value);

    const directional =
      this.cfg.direction === 'both'
        ? Math.abs(z)
        : this.cfg.direction === 'up'
          ? z
          : -z;

    if (directional < this.cfg.zThreshold) return null;

    const score = clamp01(
      (directional - this.cfg.zThreshold) /
        (this.cfg.zSaturation - this.cfg.zThreshold),
    );

    return {
      anomalyId: crypto.randomUUID(),
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
    this.baselines.delete(`${service}|${metric}`);
  }
}
