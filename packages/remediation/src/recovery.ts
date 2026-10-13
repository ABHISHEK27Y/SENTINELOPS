/**
 * Recovery verification. After a remediation executes, the verifier observes key
 * metrics for several windows and confirms they returned to baseline before the
 * incident is resolved (see ARCHITECTURE §13). If not, the incident loops back to
 * MITIGATION_REQUIRED rather than resolving.
 */
import { METRIC_NOISE_FLOORS } from '@sentinelops/shared-types';

export interface MetricObservation {
  metric: string;
  observed: number;
  baseline: number;
  /** Request traffic must return near baseline; latency/error gauges may improve. */
  direction?: 'lower' | 'range';
}

export interface RecoveryCheck extends MetricObservation {
  passed: boolean;
}

export interface RecoveryResult {
  recovered: boolean;
  checks: RecoveryCheck[];
}

export interface RecoveryOptions {
  /** Allowed ratio above baseline to count as recovered (e.g. 1.5 = within 50%). */
  tolerance?: number;
}

/** Evaluate a single window of observations against baselines. */
export function evaluateRecovery(
  observations: MetricObservation[],
  opts: RecoveryOptions = {}
): RecoveryResult {
  const tolerance = opts.tolerance ?? 1.5;
  if (!Number.isFinite(tolerance) || tolerance < 1) {
    throw new RangeError('Recovery tolerance must be finite and at least 1');
  }
  const checks = observations.map((o): RecoveryCheck => {
    const threshold = Math.max(
      o.baseline * tolerance,
      o.baseline + (METRIC_NOISE_FLOORS[o.metric] ?? 1e-9)
    );
    const direction = o.direction ?? (o.metric === 'request_rate' ? 'range' : 'lower');
    const passed =
      Number.isFinite(o.observed) &&
      Number.isFinite(o.baseline) &&
      o.observed >= 0 &&
      o.baseline >= 0 &&
      o.observed <= threshold &&
      (direction !== 'range' || o.observed >= o.baseline / tolerance);
    return { ...o, passed };
  });
  return {
    recovered:
      checks.length > 0 &&
      checks.every(c => Number.isFinite(c.observed) && Number.isFinite(c.baseline) && c.passed),
    checks,
  };
}

/**
 * Track recovery across consecutive windows; declares recovery only after N
 * consecutive passing windows (debounces a brief dip).
 */
export class RecoveryTracker {
  private consecutive = 0;
  constructor(
    private requiredWindows = 2,
    private opts: RecoveryOptions = {}
  ) {}

  /** Feed one window; returns whether recovery is confirmed. */
  observe(observations: MetricObservation[]): {
    confirmed: boolean;
    result: RecoveryResult;
    consecutivePasses: number;
  } {
    const result = evaluateRecovery(observations, this.opts);
    this.consecutive = result.recovered ? this.consecutive + 1 : 0;
    return {
      confirmed: this.consecutive >= this.requiredWindows,
      result,
      consecutivePasses: this.consecutive,
    };
  }
}
