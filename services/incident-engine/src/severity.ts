import { computeSeverity, type SeveritySignals } from '@sentinelops/config';
import type { CorrelationGroup } from '@sentinelops/correlation';
import type { Severity } from '@sentinelops/shared-types';

/**
 * Derive measurable severity signals from a correlation group's anomalies, then
 * score them with the configurable severity model (see ARCHITECTURE §8). Severity
 * is computed from data, never guessed.
 */
export function severityForGroup(group: CorrelationGroup): {
  score: number;
  severity: Severity;
  signals: SeveritySignals;
} {
  let latencyRatio = 1;
  let errorRate = 0;

  for (const a of group.anomalies) {
    if (a.metric.includes('latency') || a.metric.includes('duration')) {
      const ratio = a.baseline > 0 ? a.value / a.baseline : 1;
      latencyRatio = Math.max(latencyRatio, ratio);
    }
    if (a.metric.includes('error')) {
      // error_rate anomalies carry a fractional value; pool/queue don't count here.
      errorRate = Math.max(errorRate, a.value <= 1 ? a.value : a.value / 100);
    }
  }

  const durationSeconds = Math.max(0, (group.lastSeen - group.firstSeen) / 1000);
  const signals: SeveritySignals = {
    errorRate,
    latencyRatio,
    affectedServices: group.services.size,
    // Request volume isn't in the anomaly payload; use anomaly count as a proxy
    // for blast intensity until the ingestor supplies true rate (Phase 5).
    requestVolume: Math.min(500, group.anomalies.length * 40),
    durationSeconds,
  };

  return { ...computeSeverity(signals), signals };
}
