/**
 * Recovery verification. After a remediation executes, the verifier observes key
 * metrics for several windows and confirms they returned to baseline before the
 * incident is resolved (see ARCHITECTURE §13). If not, the incident loops back to
 * MITIGATION_REQUIRED rather than resolving.
 */
export interface MetricObservation {
  metric: string;
  observed: number;
  baseline: number;
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
  const checks = observations.map((o): RecoveryCheck => {
    // "Lower is better" metrics: recovered when observed ≤ baseline * tolerance.
    const threshold = Math.max(o.baseline * tolerance, o.baseline + 1e-9);
    return { ...o, passed: o.observed <= threshold };
  });
  return { recovered: checks.every(c => c.passed), checks };
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
