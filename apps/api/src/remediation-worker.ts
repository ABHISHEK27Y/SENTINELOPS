import { query, transaction, transitionIncident, enqueueEvent } from '@sentinelops/db';
import {
  FaultApiExecutor,
  evaluateRecovery,
  type ProposedAction,
  type MetricObservation,
} from '@sentinelops/remediation';
import { Topics, EventType, makeEnvelope, type IncidentStatus } from '@sentinelops/shared-types';

import { serviceBaseUrl } from './topology.js';

interface RecoverySignal {
  service_id: string;
  metric: string;
  baseline: number;
  instance: string;
}
interface Job {
  action_id: string;
  phase: 'EXECUTE' | 'VERIFY';
  attempts: number;
  state: { consecutive?: number; last?: Record<string, string>; required?: RecoverySignal[] };
  incident_id: string;
  type: ProposedAction['type'];
  target_service: string;
  risk: ProposedAction['risk'];
  params: Record<string, unknown>;
  rationale: string;
  requires_approval: boolean;
  executed_at: string | null;
  status: IncidentStatus;
}
const executor = new FaultApiExecutor(serviceBaseUrl);

async function recoverySignals(incidentId: string): Promise<RecoverySignal[]> {
  return (
    await query<RecoverySignal>(
      `SELECT DISTINCT ON(service_id,metric,instance) service_id,metric,baseline,instance FROM anomalies
     WHERE incident_id=$1 ORDER BY service_id,metric,instance,created_at DESC`,
      [incidentId]
    )
  ).rows;
}

/** A transaction row lock prevents multiple API replicas executing one job. */
export async function runRemediationJob(): Promise<void> {
  await transaction(async () => {
    const { rows } = await query<Job>(
      `SELECT j.*,a.incident_id,a.type,a.target_service,a.risk,a.params,a.rationale,a.requires_approval,a.executed_at,i.status
       FROM remediation_jobs j JOIN remediation_actions a ON a.id=j.action_id JOIN incidents i ON i.id=a.incident_id
       WHERE j.phase!='DONE' AND j.due_at<=now() ORDER BY j.due_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`
    );
    const job = rows[0];
    if (!job) return;
    const incident = (
      await query<{ status: IncidentStatus }>(
        'SELECT status FROM incidents WHERE id=$1 FOR UPDATE',
        [job.incident_id]
      )
    ).rows[0];
    if (incident) job.status = incident.status;
    if (!incident || job.status !== (job.phase === 'EXECUTE' ? 'REMEDIATING' : 'VERIFYING')) {
      await query(
        "UPDATE remediation_jobs SET phase='DONE',last_error='incident no longer actionable' WHERE action_id=$1",
        [job.action_id]
      );
      return;
    }
    if (job.phase === 'EXECUTE') {
      // Freeze evidence before the external action changes service behavior.
      const required = await recoverySignals(job.incident_id);
      const result = await executor.execute({
        type: job.type,
        targetService: job.target_service,
        risk: job.risk,
        params: job.params,
        rationale: job.rationale,
        requiresApproval: job.requires_approval,
      });
      await query(
        'UPDATE remediation_actions SET status=$2,executed_at=clock_timestamp(),result=$3 WHERE id=$1',
        [job.action_id, result.ok ? 'EXECUTED' : 'FAILED', JSON.stringify(result)]
      );
      await query(
        "INSERT INTO audit_log(actor,action,target,result,data) VALUES ('remediation-worker','execute_remediation',$1,$2,$3)",
        [job.action_id, result.ok ? 'EXECUTED' : 'FAILED', JSON.stringify(result)]
      );
      await enqueueEvent(
        Topics.remediation,
        makeEnvelope({
          type: EventType.REMEDIATION_EXECUTED,
          service: 'api',
          payload: { actionId: job.action_id, incidentId: job.incident_id, ...result },
        }),
        job.incident_id
      );
      await transitionIncident(
        job.incident_id,
        result.ok ? 'VERIFYING' : 'MITIGATION_REQUIRED',
        result.detail,
        'REMEDIATING'
      );
      await query(
        "UPDATE remediation_jobs SET phase=$2,due_at=now()+interval '5 seconds',state=$3,attempts=0 WHERE action_id=$1",
        [job.action_id, result.ok ? 'VERIFY' : 'DONE', JSON.stringify({ required })]
      );
      return;
    }
    // Existing jobs adopt a cohort on their first verification poll.
    const required = job.state.required ?? (await recoverySignals(job.incident_id));
    const previous = job.state.last ?? {};
    const current: Record<string, string> = {};
    const observations: MetricObservation[] = [];
    for (const signal of required) {
      const key = `${signal.service_id}|${signal.metric}|${signal.instance}`;
      const sample = (
        await query<{ value: number; ts: string }>(
          `SELECT value,ts FROM metrics WHERE service_id=$1 AND metric=$2 AND COALESCE(labels->>'instance','default')=$3
         AND ts>$4 AND ts>now()-interval '15 seconds' ORDER BY ts DESC LIMIT 1`,
          [signal.service_id, signal.metric, signal.instance, previous[key] ?? job.executed_at]
        )
      ).rows[0];
      if (!sample) continue;
      current[key] = new Date(sample.ts).toISOString();
      observations.push({
        metric: key,
        observed: sample.value,
        baseline: signal.baseline,
        direction: signal.metric === 'request_rate' ? 'range' : 'lower',
      });
    }
    const complete = required.length > 0 && observations.length === required.length;
    const result = evaluateRecovery(observations);
    const consecutive = complete && result.recovered ? (job.state.consecutive ?? 0) + 1 : 0;
    for (const check of result.checks) {
      await query(
        'INSERT INTO recovery_checks(action_id,incident_id,metric,observed,baseline,passed) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          job.action_id,
          job.incident_id,
          check.metric,
          check.observed,
          check.baseline,
          complete && check.passed,
        ]
      );
    }
    const confirmed = consecutive >= 2;
    const timedOut = job.attempts >= 23;
    if (confirmed || timedOut) {
      const to = confirmed ? 'RESOLVED' : 'MITIGATION_REQUIRED';
      await transitionIncident(
        job.incident_id,
        to,
        confirmed
          ? 'fresh complete metric windows confirm recovery'
          : 'recovery failed or telemetry missing',
        'VERIFYING'
      );
      await enqueueEvent(
        Topics.recovery,
        makeEnvelope({
          type: confirmed ? EventType.RECOVERY_VERIFIED : EventType.RECOVERY_FAILED,
          service: 'api',
          payload: { incidentId: job.incident_id, actionId: job.action_id },
        }),
        job.incident_id
      );
      await query("UPDATE remediation_jobs SET phase='DONE' WHERE action_id=$1", [job.action_id]);
    } else {
      await query(
        "UPDATE remediation_jobs SET state=$2,attempts=attempts+1,due_at=now()+interval '5 seconds' WHERE action_id=$1",
        [
          job.action_id,
          JSON.stringify({ required, consecutive, last: complete ? current : previous }),
        ]
      );
    }
  });
}

export function startRemediationWorker(onError: (err: unknown) => void): () => Promise<void> {
  let running: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (!running)
      running = runRemediationJob()
        .catch(onError)
        .finally(() => {
          running = null;
        });
  }, 1000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
