import type { Anomaly, Evidence, RootCauseHypothesis } from '@sentinelops/shared-types';

/** Directed dependency edge: `from` depends on / calls `to`. */
export interface DirectedEdge {
  from: string;
  to: string;
}

export interface DeploymentInfo {
  service: string;
  deployedAt: string; // ISO
}

export interface RootCauseInput {
  anomalies: Anomaly[];
  services: string[];
  /** Directed dependency edges (from → to). */
  edges: DirectedEdge[];
  deployments?: DeploymentInfo[];
  incidentStartMs?: number;
}

const WEIGHTS = { dependents: 0.4, earliest: 0.25, severity: 0.2, deploy: 0.15 };
const DEPLOY_WINDOW_MS = 15 * 60_000;

/** Directed reachability: services reachable from `start` following edges. */
function reachable(start: string, adj: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop() as string;
    for (const nb of adj.get(n) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return seen;
}

/**
 * Rank root-cause hypotheses for a correlated incident. The heuristic combines:
 *  - dependency depth (how many affected services depend on the candidate),
 *  - temporal precedence (the cause tends to fail first),
 *  - anomaly severity on the candidate, and
 *  - a recent deployment on the candidate.
 *
 * Deterministic and evidence-based — it never asserts certainty; each hypothesis
 * carries a confidence and the evidence behind it (see ARCHITECTURE §11).
 */
export function rankRootCauses(input: RootCauseInput): RootCauseHypothesis[] {
  const { anomalies, services, edges, deployments = [], incidentStartMs } = input;
  if (services.length === 0) return [];

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
  }

  // Per-service anomaly aggregates.
  const byService = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    if (!byService.has(a.service)) byService.set(a.service, []);
    byService.get(a.service)!.push(a);
  }

  const earliestOf = (svc: string): number => {
    const list = byService.get(svc) ?? [];
    return list.reduce(
      (min, a) => Math.min(min, Date.parse(a.windowStart)),
      Number.POSITIVE_INFINITY
    );
  };
  const globalEarliest = Math.min(...services.map(earliestOf));

  const scored = services.map(c => {
    // How many OTHER affected services depend (transitively) on c?
    const dependents = services.filter(s => s !== c && reachable(s, adj).has(c)).length;
    const depScore = dependents / Math.max(1, services.length - 1);

    const earlyScore = earliestOf(c) === globalEarliest ? 1 : 0;

    const maxSev = (byService.get(c) ?? []).reduce((m, a) => Math.max(m, a.anomalyScore), 0);

    const recentDeploy = deployments.find(
      d =>
        d.service === c &&
        incidentStartMs !== undefined &&
        incidentStartMs - Date.parse(d.deployedAt) >= 0 &&
        incidentStartMs - Date.parse(d.deployedAt) <= DEPLOY_WINDOW_MS
    );
    const deployScore = recentDeploy ? 1 : 0;

    const score =
      WEIGHTS.dependents * depScore +
      WEIGHTS.earliest * earlyScore +
      WEIGHTS.severity * maxSev +
      WEIGHTS.deploy * deployScore;

    return { service: c, score, dependents, earlyScore, maxSev, recentDeploy };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter(s => (byService.get(s.service)?.length ?? 0) > 0 || s.dependents > 0)
    .map((s): RootCauseHypothesis => {
      const evidence: Evidence[] = [];
      for (const a of byService.get(s.service) ?? []) {
        evidence.push({
          kind: 'anomaly',
          summary: `${a.metric} on ${a.service}: ${Math.round(a.value)} vs baseline ${Math.round(a.baseline)} (score ${a.anomalyScore.toFixed(2)})`,
          data: { metric: a.metric, value: a.value, baseline: a.baseline, score: a.anomalyScore },
          weight: a.anomalyScore,
        });
      }
      if (s.dependents > 0) {
        evidence.push({
          kind: 'dependency',
          summary: `${s.dependents} affected service(s) depend on ${s.service}`,
          data: { dependents: s.dependents },
          weight: 0.6,
        });
      }
      if (s.earlyScore === 1) {
        evidence.push({
          kind: 'metric',
          summary: `${s.service} showed the earliest anomaly (temporal precedence)`,
          data: {},
          weight: 0.5,
        });
      }
      if (s.recentDeploy) {
        evidence.push({
          kind: 'deployment',
          summary: `Deployment on ${s.service} at ${s.recentDeploy.deployedAt}, shortly before the incident`,
          data: { deployedAt: s.recentDeploy.deployedAt },
          weight: 0.7,
        });
      }
      return {
        title: `${s.service} is the probable root cause`,
        description:
          `${s.service} is the most likely origin: ${s.dependents} affected ` +
          `service(s) depend on it${s.earlyScore ? ', it failed first' : ''}` +
          `${s.recentDeploy ? ', and it was recently deployed' : ''}.`,
        confidence: Math.min(0.99, s.score),
        evidence,
      };
    });
}
