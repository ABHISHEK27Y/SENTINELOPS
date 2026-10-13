import type { Anomaly } from '@sentinelops/shared-types';

import { DependencyGraph } from './graph.js';

/**
 * Correlates a stream of anomalies into incident groups so that many related
 * anomalies (payment latency ↑, payment errors ↑, DB pool ↑) become ONE
 * incident rather than four alerts. Grouping uses:
 *   - a sliding time window, and
 *   - service relationship via the dependency graph.
 */
export interface CorrelationGroup {
  correlationId: string;
  services: Set<string>;
  anomalies: Anomaly[];
  firstSeen: number;
  lastSeen: number;
}

export interface CorrelationResult {
  correlationId: string;
  isNew: boolean;
  services: string[];
  anomalyCount: number;
}

export interface CorrelatorOptions {
  /** Anomalies within this window of a group's last activity may join it. */
  windowMs?: number;
  /** Max dependency-graph hops for two services to be "related". */
  maxHops?: number;
  /** Out-of-order events may trail the persisted event watermark by this much. */
  maxLatenessMs?: number;
  /** Injected id generator (tests pass a deterministic one). */
  idGen?: () => string;
}

export class Correlator {
  private groups = new Map<string, CorrelationGroup>();
  private windowMs: number;
  private maxHops: number;
  private idGen: () => string;
  private watermark = 0;
  private maxLatenessMs: number;

  constructor(
    private graph: DependencyGraph,
    opts: CorrelatorOptions = {}
  ) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxHops = opts.maxHops ?? 2;
    this.maxLatenessMs = opts.maxLatenessMs ?? this.windowMs;
    this.idGen = opts.idGen ?? (() => crypto.randomUUID());
  }

  /** Assign an anomaly to a new or existing incident group. */
  ingest(anomaly: Anomaly, nowMs = Date.parse(anomaly.windowEnd)): CorrelationResult {
    if (!Number.isFinite(nowMs)) throw new RangeError('invalid anomaly timestamp');
    if (this.isLate(nowMs)) throw new RangeError('anomaly exceeds correlation lateness allowance');
    this.watermark = Math.max(this.watermark, nowMs);
    this.expire(this.watermark);

    const match = this.findGroup(anomaly, nowMs);
    if (match) {
      match.services.add(anomaly.service);
      match.anomalies.push(anomaly);
      if (match.anomalies.length > 500) match.anomalies.splice(0, match.anomalies.length - 500);
      match.lastSeen = Math.max(match.lastSeen, nowMs);
      return {
        correlationId: match.correlationId,
        isNew: false,
        services: [...match.services],
        anomalyCount: match.anomalies.length,
      };
    }

    const group: CorrelationGroup = {
      correlationId: this.idGen(),
      services: new Set([anomaly.service]),
      anomalies: [anomaly],
      firstSeen: nowMs,
      lastSeen: nowMs,
    };
    this.groups.set(group.correlationId, group);
    return {
      correlationId: group.correlationId,
      isNew: true,
      services: [...group.services],
      anomalyCount: 1,
    };
  }

  private findGroup(anomaly: Anomaly, nowMs: number): CorrelationGroup | undefined {
    for (const group of this.groups.values()) {
      if (nowMs - group.lastSeen > this.windowMs) continue;
      if (nowMs < group.firstSeen - this.windowMs) continue;
      for (const svc of group.services) {
        if (svc === anomaly.service || this.graph.related(svc, anomaly.service, this.maxHops)) {
          return group;
        }
      }
    }
    return undefined;
  }

  /** Remove groups whose activity is older than the window; return them. */
  expire(nowMs: number): CorrelationGroup[] {
    const expired: CorrelationGroup[] = [];
    for (const [id, g] of this.groups) {
      if (nowMs - g.lastSeen > this.windowMs) {
        expired.push(g);
        this.groups.delete(id);
      }
    }
    return expired;
  }

  get(correlationId: string): CorrelationGroup | undefined {
    return this.groups.get(correlationId);
  }

  openGroups(): CorrelationGroup[] {
    return [...this.groups.values()];
  }

  close(correlationId: string): void {
    this.groups.delete(correlationId);
  }

  isLate(timestampMs: number): boolean {
    return timestampMs < this.watermark - this.maxLatenessMs;
  }

  snapshot(): unknown {
    return {
      watermark: this.watermark,
      groups: [...this.groups.values()].map(g => ({ ...g, services: [...g.services] })),
    };
  }

  restore(state: unknown): void {
    this.groups.clear();
    this.watermark = 0;
    const saved = state as { watermark?: number; groups?: unknown } | null;
    const groups = Array.isArray(state) ? state : saved?.groups;
    if (saved && Number.isFinite(saved.watermark)) this.watermark = saved.watermark!;
    if (!Array.isArray(groups)) return;
    for (const raw of groups as Array<
      Omit<CorrelationGroup, 'services'> & { services: string[] }
    >) {
      if (
        raw &&
        typeof raw.correlationId === 'string' &&
        Number.isFinite(raw.firstSeen) &&
        Number.isFinite(raw.lastSeen) &&
        raw.firstSeen <= raw.lastSeen &&
        Array.isArray(raw.services) &&
        Array.isArray(raw.anomalies)
      ) {
        this.groups.set(raw.correlationId, {
          ...raw,
          services: new Set(raw.services),
          anomalies: raw.anomalies.slice(-500),
        });
        this.watermark = Math.max(this.watermark, raw.lastSeen);
      }
    }
  }
}
