import { Severity, type Severity as SeverityT } from '@sentinelops/shared-types';

/**
 * Configurable severity model. Severity is derived from measurable signals,
 * never guessed. Weights and thresholds live here so they are tunable without
 * touching engine code (see ARCHITECTURE.md §8).
 */
export interface SeveritySignals {
  /** Fractional error rate 0..1 (e.g. 0.17 = 17%). */
  errorRate: number;
  /** p95 latency divided by the healthy baseline (e.g. 2800/180 ≈ 15.6). */
  latencyRatio: number;
  /** Count of distinct affected services. */
  affectedServices: number;
  /** Requests/sec through the affected path. */
  requestVolume: number;
  /** Incident duration in seconds. */
  durationSeconds: number;
}

export interface SeverityRules {
  weights: {
    errorRate: number;
    latencyRatio: number;
    affectedServices: number;
    requestVolume: number;
    duration: number;
  };
  /** Normalization caps — the value at which a signal contributes its full weight. */
  caps: {
    errorRate: number; // e.g. 0.5 -> 50% errors is "max"
    latencyRatio: number; // e.g. 10x baseline is "max"
    affectedServices: number; // e.g. 5 services is "max"
    requestVolume: number; // e.g. 500 rps is "max"
    durationSeconds: number; // e.g. 900s (15m) is "max"
  };
  /** Score thresholds (0..1) mapping to buckets, evaluated high→low. */
  thresholds: { critical: number; high: number; medium: number; low: number };
}

export const DEFAULT_SEVERITY_RULES: SeverityRules = {
  weights: {
    errorRate: 0.35,
    latencyRatio: 0.25,
    affectedServices: 0.2,
    requestVolume: 0.1,
    duration: 0.1,
  },
  caps: {
    errorRate: 0.5,
    latencyRatio: 10,
    affectedServices: 5,
    requestVolume: 500,
    durationSeconds: 900,
  },
  thresholds: { critical: 0.75, high: 0.55, medium: 0.35, low: 0.15 },
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Returns both the raw score (0..1) and the bucketed severity. */
export function computeSeverity(
  signals: SeveritySignals,
  rules: SeverityRules = DEFAULT_SEVERITY_RULES,
): { score: number; severity: SeverityT } {
  const { weights: w, caps: c, thresholds: t } = rules;
  const score = clamp01(
    w.errorRate * clamp01(signals.errorRate / c.errorRate) +
      w.latencyRatio * clamp01(signals.latencyRatio / c.latencyRatio) +
      w.affectedServices *
        clamp01(signals.affectedServices / c.affectedServices) +
      w.requestVolume * clamp01(signals.requestVolume / c.requestVolume) +
      w.duration * clamp01(signals.durationSeconds / c.durationSeconds),
  );

  let severity: SeverityT = Severity.INFO;
  if (score >= t.critical) severity = Severity.CRITICAL;
  else if (score >= t.high) severity = Severity.HIGH;
  else if (score >= t.medium) severity = Severity.MEDIUM;
  else if (score >= t.low) severity = Severity.LOW;

  return { score, severity };
}
