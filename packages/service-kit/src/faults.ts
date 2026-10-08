/**
 * Fault controller. Holds the set of active faults for a service and exposes
 * the behavioural knobs the service's request path and workload loop read from.
 *
 * Faults produce REAL effects, not fake numbers:
 *  - db_latency        → adds latency to simulated DB ops + raises pool pressure
 *  - error_injection   → a fraction of requests return 500
 *  - kill              → service reports UNHEALTHY and fails requests
 *  - cpu_stress        → a background busy-loop actually raises CPU usage
 *  - memory_leak       → a growing buffer actually raises RSS
 *  - break_redis       → simulated Redis ops fail / spike latency
 *  - traffic_spike     → self-generated extra internal load
 *  - kafka_lag         → producer flush is delayed (reported as queue depth)
 */
import { FaultType, type FaultType as FaultTypeT } from '@sentinelops/shared-types';

export interface FaultParams {
  [key: string]: unknown;
  /** For db_latency: target added latency in ms. */
  targetMs?: number;
  /** For error_injection: probability 0..1. */
  probability?: number;
  /** Auto-clear after N ms (0 = manual). */
  ttlMs?: number;
}

interface ActiveFault {
  type: FaultTypeT;
  params: FaultParams;
  since: number;
  expiresAt: number | null;
}

export class FaultController {
  private active = new Map<FaultTypeT, ActiveFault>();
  private cpuTimer: NodeJS.Timeout | null = null;
  private memTimer: NodeJS.Timeout | null = null;
  private leak: Buffer[] = [];

  enable(type: FaultTypeT, params: FaultParams = {}): ActiveFault {
    const now = Date.now();
    const fault: ActiveFault = {
      type,
      params,
      since: now,
      expiresAt: params.ttlMs && params.ttlMs > 0 ? now + params.ttlMs : null,
    };
    this.active.set(type, fault);
    if (type === FaultType.CPU_STRESS) this.startCpuStress();
    if (type === FaultType.MEMORY_LEAK) this.startMemoryLeak();
    return fault;
  }

  disable(type: FaultTypeT): void {
    this.active.delete(type);
    if (type === FaultType.CPU_STRESS) this.stopCpuStress();
    if (type === FaultType.MEMORY_LEAK) this.stopMemoryLeak();
  }

  clear(): void {
    for (const type of [...this.active.keys()]) this.disable(type);
  }

  private get(type: FaultTypeT): ActiveFault | undefined {
    const f = this.active.get(type);
    if (!f) return undefined;
    if (f.expiresAt && Date.now() > f.expiresAt) {
      this.disable(type);
      return undefined;
    }
    return f;
  }

  list(): Array<{ type: FaultTypeT; params: FaultParams; since: number }> {
    return [...this.active.values()]
      .filter((f) => this.get(f.type))
      .map(({ type, params, since }) => ({ type, params, since }));
  }

  // ── Behavioural knobs read by the service ──────────────────────────────

  isKilled(): boolean {
    return this.get(FaultType.KILL) !== undefined;
  }

  /** Extra latency (ms) to add to a simulated DB call. */
  dbLatencyMs(): number {
    const f = this.get(FaultType.DB_LATENCY);
    if (!f) return 0;
    return typeof f.params.targetMs === 'number' ? f.params.targetMs : 2400;
  }

  /** Probability [0..1] that a request should fail with 500. */
  errorProbability(): number {
    if (this.isKilled()) return 1;
    const f = this.get(FaultType.ERROR_INJECTION);
    if (!f) return 0;
    return typeof f.params.probability === 'number'
      ? Math.max(0, Math.min(1, f.params.probability))
      : 0.5;
  }

  redisBroken(): boolean {
    return this.get(FaultType.BREAK_REDIS) !== undefined;
  }

  trafficSpikeFactor(): number {
    const f = this.get(FaultType.TRAFFIC_SPIKE);
    if (!f) return 1;
    return typeof f.params.factor === 'number' ? f.params.factor : 4;
  }

  kafkaLagMs(): number {
    const f = this.get(FaultType.KAFKA_LAG);
    if (!f) return 0;
    return typeof f.params.targetMs === 'number' ? f.params.targetMs : 1500;
  }

  /**
   * DB pool pressure [0..1]. Held connections rise as query latency rises
   * (Little's law intuition): longer queries ⇒ more concurrent held conns.
   */
  dbPoolPressure(baselineMs = 20): number {
    const extra = this.dbLatencyMs();
    if (extra === 0) return 0.15; // healthy baseline utilization
    const ratio = (baselineMs + extra) / baselineMs;
    return Math.max(0.15, Math.min(0.99, 0.15 + 0.85 * (1 - 1 / ratio)));
  }

  // ── Real resource stressors ────────────────────────────────────────────

  private startCpuStress(): void {
    if (this.cpuTimer) return;
    // Every 50ms, busy-loop for ~25ms → ~50% of one core.
    this.cpuTimer = setInterval(() => {
      const end = Date.now() + 25;
      while (Date.now() < end) {
        Math.sqrt(Math.random() * Math.random());
      }
    }, 50);
  }

  private stopCpuStress(): void {
    if (this.cpuTimer) clearInterval(this.cpuTimer);
    this.cpuTimer = null;
  }

  private startMemoryLeak(): void {
    if (this.memTimer) return;
    // Allocate ~2MB/sec until the fault is cleared.
    this.memTimer = setInterval(() => {
      this.leak.push(Buffer.alloc(2 * 1024 * 1024, 1));
    }, 1000);
  }

  private stopMemoryLeak(): void {
    if (this.memTimer) clearInterval(this.memTimer);
    this.memTimer = null;
    this.leak = [];
  }
}
