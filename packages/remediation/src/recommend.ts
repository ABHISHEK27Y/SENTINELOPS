import {
  RemediationActionType,
  RemediationRisk,
  type RemediationActionType as ActionType,
  type RemediationRisk as Risk,
} from '@sentinelops/shared-types';

export interface ProposedAction {
  type: ActionType;
  targetService: string;
  risk: Risk;
  rationale: string;
  /** Low-risk, reversible actions may auto-apply; the rest need a human. */
  requiresApproval: boolean;
  params?: Record<string, unknown>;
}

const RISK: Record<ActionType, Risk> = {
  increase_connection_pool: RemediationRisk.LOW,
  clear_cache: RemediationRisk.LOW,
  scale_service: RemediationRisk.MEDIUM,
  restart_service: RemediationRisk.MEDIUM,
  rollback_deployment: RemediationRisk.MEDIUM,
};

function action(
  type: ActionType,
  targetService: string,
  rationale: string,
  params?: Record<string, unknown>,
): ProposedAction {
  const risk = RISK[type];
  return {
    type,
    targetService,
    risk,
    rationale,
    requiresApproval: risk !== RemediationRisk.LOW,
    params,
  };
}

export interface RecommendInput {
  rootCauseService: string;
  affectedServices: string[];
  /** Metric names implicated in the incident (to infer the failure category). */
  metrics: string[];
  hasRecentDeployment?: boolean;
}

/**
 * Deterministically map a diagnosed incident to a ranked list of remediation
 * actions with risk levels. The LLM narrates these; it does not invent them.
 * Lower-risk, higher-leverage actions come first.
 */
export function recommendActions(input: RecommendInput): ProposedAction[] {
  const svc = input.rootCauseService;
  const m = input.metrics.join(' ');
  const out: ProposedAction[] = [];

  const dbSignal = /pool|db_|query_latency/.test(m) || svc === 'postgres';
  const cacheSignal = /redis|queue/.test(m) || svc === 'redis';
  const resourceSignal = /cpu|memory/.test(m);

  if (dbSignal) {
    out.push(
      action('increase_connection_pool', svc === 'postgres' ? affectedDbClient(input) : svc,
        'DB connection pool is saturated; temporarily increasing the pool relieves pressure.'),
    );
    if (input.hasRecentDeployment) {
      out.push(action('rollback_deployment', primaryService(input),
        'A deployment shortly preceded the incident; rolling back reverts a likely regression.'));
    }
    out.push(action('restart_service', primaryService(input),
      'Restarting resets leaked/held DB connections if the pool does not recover.'));
  } else if (cacheSignal) {
    out.push(action('clear_cache', svc === 'redis' ? primaryService(input) : svc,
      'Cache appears unhealthy; clearing corrupted keys can restore normal operation.'));
    out.push(action('restart_service', svc === 'redis' ? primaryService(input) : svc,
      'Restarting the cache-dependent service re-establishes connections.'));
  } else if (resourceSignal) {
    out.push(action('scale_service', primaryService(input),
      'CPU/memory saturation; scaling out adds headroom.'));
    out.push(action('restart_service', primaryService(input),
      'Restarting clears a memory leak until a fix ships.'));
  } else {
    if (input.hasRecentDeployment) {
      out.push(action('rollback_deployment', primaryService(input),
        'A recent deployment correlates with the incident.'));
    }
    out.push(action('restart_service', primaryService(input),
      'Restarting the unhealthy service is the safest general recovery step.'));
  }

  return out;
}

/** The service to act on: prefer a real service over an infra node like postgres. */
function primaryService(input: RecommendInput): string {
  if (input.rootCauseService !== 'postgres' && input.rootCauseService !== 'redis') {
    return input.rootCauseService;
  }
  return affectedDbClient(input);
}

function affectedDbClient(input: RecommendInput): string {
  return (
    input.affectedServices.find((s) => s !== 'postgres' && s !== 'redis') ??
    input.rootCauseService
  );
}
