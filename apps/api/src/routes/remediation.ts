import type { FastifyInstance } from 'fastify';
import { query } from '@sentinelops/db';
import { canTransition } from '@sentinelops/correlation';
import {
  recommendActions,
  FaultApiExecutor,
  RecoveryTracker,
  type MetricObservation,
} from '@sentinelops/remediation';
import { EventProducer } from '@sentinelops/kafka';
import { Topics, EventType, makeEnvelope, Role } from '@sentinelops/shared-types';
import { authenticate, requireRole, type JwtUser } from '../auth.js';
import { serviceBaseUrl, SERVICES } from '../topology.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const executor = new FaultApiExecutor(serviceBaseUrl);

async function audit(actor: string, action: string, target: string, result: string, data: Record<string, unknown> = {}): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor, action, target, result, data) VALUES ($1,$2,$3,$4,$5)`,
    [actor, action, target, result, JSON.stringify(data)],
  );
}

async function setStatus(id: string, to: string, message: string): Promise<void> {
  const { rows } = await query<{ status: string }>('SELECT status FROM incidents WHERE id=$1', [id]);
  const from = rows[0]?.status;
  if (!from || !canTransition(from as never, to as never)) return;
  const resolved = to === 'RESOLVED' ? ', resolved_at = now()' : '';
  await query(`UPDATE incidents SET status=$1, updated_at=now()${resolved} WHERE id=$2`, [to, id]);
  await query(`INSERT INTO incident_events (incident_id, kind, message) VALUES ($1,'status',$2)`, [id, message]);
}

/** Background recovery verification: watch metrics for consecutive good windows. */
async function verifyRecovery(incidentId: string, producer: EventProducer): Promise<void> {
  const anomalies = (
    await query<{ service_id: string; metric: string; baseline: number }>(
      `SELECT DISTINCT ON (service_id, metric) service_id, metric, baseline
         FROM anomalies WHERE incident_id=$1 ORDER BY service_id, metric, created_at DESC`,
      [incidentId],
    )
  ).rows;

  const tracker = new RecoveryTracker(2, { tolerance: 1.5 });
  for (let window = 0; window < 6; window++) {
    await sleep(3000);
    const obs: MetricObservation[] = [];
    for (const a of anomalies) {
      const latest = (
        await query<{ value: number }>(
          `SELECT value FROM metrics WHERE service_id=$1 AND metric=$2 ORDER BY ts DESC LIMIT 1`,
          [a.service_id, a.metric],
        )
      ).rows[0];
      if (latest) obs.push({ metric: a.metric, observed: latest.value, baseline: a.baseline });
    }
    if (obs.length === 0) continue;
    const { confirmed, result } = tracker.observe(obs);
    for (const c of result.checks) {
      await query(
        `INSERT INTO recovery_checks (action_id, incident_id, metric, observed, baseline, passed)
         SELECT id, $1, $2, $3, $4, $5 FROM remediation_actions
          WHERE incident_id=$1 ORDER BY proposed_at DESC LIMIT 1`,
        [incidentId, c.metric, c.observed, c.baseline, c.passed],
      );
    }
    if (confirmed) {
      await setStatus(incidentId, 'RESOLVED', 'metrics recovered — incident resolved');
      await producer.send(Topics.recovery, makeEnvelope({
        type: EventType.RECOVERY_VERIFIED, service: 'api',
        payload: { incidentId, windows: window + 1 },
      }), incidentId);
      return;
    }
  }
  await setStatus(incidentId, 'MITIGATION_REQUIRED', 'recovery not confirmed — further mitigation required');
  await producer.send(Topics.recovery, makeEnvelope({
    type: EventType.RECOVERY_FAILED, service: 'api', payload: { incidentId },
  }), incidentId);
}

export function registerRemediationRoutes(app: FastifyInstance, producer: EventProducer): void {
  // Propose remediation actions for an incident.
  app.post<{ Params: { id: string } }>(
    '/api/incidents/:id/remediate',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      const { rows } = await query<{
        status: string; severity: string; affected_services: string[]; root_cause: { title?: string } | null;
      }>('SELECT status, severity, affected_services, root_cause FROM incidents WHERE id=$1', [req.params.id]);
      const inc = rows[0];
      if (!inc) return reply.code(404).send({ error: 'unknown incident' });

      const metrics = (
        await query<{ metric: string }>('SELECT DISTINCT metric FROM anomalies WHERE incident_id=$1', [req.params.id])
      ).rows.map((r) => r.metric);
      const rcService =
        SERVICES.find((s) => inc.root_cause?.title?.includes(s.id))?.id ?? inc.affected_services[0] ?? 'unknown';

      const actions = recommendActions({
        rootCauseService: rcService, affectedServices: inc.affected_services, metrics,
      });

      const created: unknown[] = [];
      for (const a of actions) {
        const { rows: r } = await query<{ id: string }>(
          `INSERT INTO remediation_actions
             (incident_id, type, target_service, params, risk, status, rationale, requires_approval)
           VALUES ($1,$2,$3,$4,$5,'PROPOSED',$6,$7) RETURNING id`,
          [req.params.id, a.type, a.targetService, JSON.stringify(a.params ?? {}), a.risk, a.rationale, a.requiresApproval],
        );
        created.push({ id: r[0]!.id, ...a });
      }
      if (inc.status === 'IDENTIFIED' || inc.status === 'INVESTIGATING') {
        await setStatus(req.params.id, 'MITIGATION_REQUIRED', 'remediation proposed — awaiting approval');
      }
      return { actions: created };
    },
  );

  // Approve + execute an action. ENGINEER/ADMIN only.
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/remediation/:id/approve',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      const user = (req as unknown as { user: JwtUser }).user;
      const { rows } = await query<{
        id: string; incident_id: string; type: string; target_service: string;
        risk: string; rationale: string; requires_approval: boolean; status: string;
      }>('SELECT * FROM remediation_actions WHERE id=$1', [req.params.id]);
      const action = rows[0];
      if (!action) return reply.code(404).send({ error: 'unknown action' });
      if (action.status !== 'PROPOSED') return reply.code(409).send({ error: `action is ${action.status}` });

      await query(
        `INSERT INTO remediation_approvals (action_id, user_id, decision, reason)
         VALUES ($1,$2,'APPROVED',$3)`,
        [action.id, user.sub, req.body?.reason ?? null],
      );
      await audit(user.email, 'approve_remediation', action.id, 'APPROVED', { type: action.type });
      await query(`UPDATE remediation_actions SET status='EXECUTING' WHERE id=$1`, [action.id]);
      await setStatus(action.incident_id, 'REMEDIATING', `approved: ${action.type} on ${action.target_service}`);
      await producer.send(Topics.remediation, makeEnvelope({
        type: EventType.REMEDIATION_APPROVED, service: 'api',
        payload: { actionId: action.id, incidentId: action.incident_id, type: action.type, by: user.email },
      }), action.incident_id);

      const result = await executor.execute({
        type: action.type as never, targetService: action.target_service,
        risk: action.risk as never, rationale: action.rationale, requiresApproval: action.requires_approval,
      });
      await query(
        `UPDATE remediation_actions SET status=$1, executed_at=now(), result=$2 WHERE id=$3`,
        [result.ok ? 'EXECUTED' : 'FAILED', JSON.stringify(result), action.id],
      );
      await audit(user.email, 'execute_remediation', action.id, result.ok ? 'EXECUTED' : 'FAILED', { ...result });
      await producer.send(Topics.remediation, makeEnvelope({
        type: EventType.REMEDIATION_EXECUTED, service: 'api',
        payload: { actionId: action.id, incidentId: action.incident_id, ok: result.ok },
      }), action.incident_id);

      if (result.ok) {
        await setStatus(action.incident_id, 'VERIFYING', 'remediation executed — verifying recovery');
        // Fire-and-forget recovery verification.
        void verifyRecovery(action.incident_id, producer);
      }
      return { result, action: { id: action.id, status: result.ok ? 'EXECUTED' : 'FAILED' } };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/remediation/:id/reject',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      const user = (req as unknown as { user: JwtUser }).user;
      const { rowCount } = await query(`UPDATE remediation_actions SET status='REJECTED' WHERE id=$1 AND status='PROPOSED'`, [req.params.id]);
      if (!rowCount) return reply.code(409).send({ error: 'action not pending' });
      await query(
        `INSERT INTO remediation_approvals (action_id, user_id, decision, reason) VALUES ($1,$2,'REJECTED',$3)`,
        [req.params.id, user.sub, req.body?.reason ?? null],
      );
      await audit(user.email, 'reject_remediation', req.params.id, 'REJECTED', {});
      return { status: 'REJECTED' };
    },
  );

  app.get('/api/audit', { preHandler: [authenticate] }, async () => {
    const { rows } = await query('SELECT actor, action, target, result, data, at FROM audit_log ORDER BY at DESC LIMIT 100');
    return rows;
  });
}
