import type { FastifyInstance } from 'fastify';

import { getEnv } from '@sentinelops/config';
import { query, transaction, transitionIncident, enqueueEvent } from '@sentinelops/db';
import { recommendActions, type ProposedAction } from '@sentinelops/remediation';
import {
  Topics,
  EventType,
  makeEnvelope,
  Role,
  type IncidentStatus,
  FaultType,
} from '@sentinelops/shared-types';

import { authenticate, requireRole, type JwtUser } from '../auth.js';
import { serviceBaseUrl, SERVICES, canInjectFault } from '../topology.js';

const reasonSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { reason: { type: 'string', maxLength: 2000 } },
  },
};
export function registerRemediationRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    '/api/incidents/:id/remediate',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      const inc = (
        await query<{
          status: IncidentStatus;
          affected_services: string[];
          root_cause: { title?: string } | null;
        }>('SELECT status,affected_services,root_cause FROM incidents WHERE id=$1', [req.params.id])
      ).rows[0];
      if (!inc) return reply.code(404).send({ error: 'unknown incident' });
      if (!['IDENTIFIED', 'INVESTIGATING', 'MITIGATION_REQUIRED'].includes(inc.status))
        return reply.code(409).send({ error: 'incident is not ready for remediation' });
      const metrics = (
        await query<{ metric: string }>(
          'SELECT DISTINCT metric FROM anomalies WHERE incident_id=$1',
          [req.params.id]
        )
      ).rows.map(r => r.metric);
      const service =
        SERVICES.find(s => inc.root_cause?.title?.includes(s.id))?.id ??
        inc.affected_services[0] ??
        'unknown';
      let actions: ProposedAction[] = recommendActions({
        rootCauseService: service,
        affectedServices: inc.affected_services,
        metrics,
      });
      if (getEnv().DEMO_MODE) {
        actions = [];
        for (const target of inc.affected_services.filter(canInjectFault)) {
          const res = await fetch(`${serviceBaseUrl(target)}/admin/faults`, {
            headers: { 'x-internal-token': getEnv().INTERNAL_API_TOKEN },
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return reply.code(502).send({ error: 'could not read active demo faults' });
          const data = (await res.json()) as { faults: Array<{ type: string }> };
          for (const fault of data.faults) {
            if (!(Object.values(FaultType) as string[]).includes(fault.type)) continue;
            actions.push({
              type: 'clear_injected_fault',
              targetService: target,
              risk: 'LOW',
              requiresApproval: true,
              rationale: `Clear the injected ${fault.type} demo fault; no restart, scaling or rollback is performed.`,
              params: { faultType: fault.type },
            });
          }
        }
      }
      if (!actions.length)
        return reply.code(409).send({ error: 'no actionable demo faults found' });
      const created = await transaction(async () => {
        const current = (
          await query<{ status: IncidentStatus }>(
            'SELECT status FROM incidents WHERE id=$1 FOR UPDATE',
            [req.params.id]
          )
        ).rows[0];
        if (
          !current ||
          !['IDENTIFIED', 'INVESTIGATING', 'MITIGATION_REQUIRED'].includes(current.status)
        )
          return null;
        const existing = (
          await query(
            'SELECT id,type,target_service AS "targetService",params,risk,rationale,requires_approval AS "requiresApproval" FROM remediation_actions WHERE incident_id=$1 AND status=\'PROPOSED\'',
            [req.params.id]
          )
        ).rows;
        if (existing.length) return existing;
        const result: unknown[] = [];
        for (const action of actions) {
          const row = (
            await query<{ id: string }>(
              `INSERT INTO remediation_actions(incident_id,type,target_service,params,risk,rationale,requires_approval)
            VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id`,
              [
                req.params.id,
                action.type,
                action.targetService,
                JSON.stringify(action.params),
                action.risk,
                action.rationale,
              ]
            )
          ).rows[0]!;
          result.push({ id: row.id, ...action });
        }
        if (current.status !== 'MITIGATION_REQUIRED')
          await transitionIncident(
            req.params.id,
            'MITIGATION_REQUIRED',
            'remediation proposed; human approval required',
            current.status
          );
        await enqueueEvent(
          Topics.remediation,
          makeEnvelope({
            type: EventType.REMEDIATION_PROPOSED,
            service: 'api',
            payload: { incidentId: req.params.id },
          }),
          req.params.id
        );
        return result;
      });
      if (!created) return reply.code(409).send({ error: 'incident state changed' });
      return { actions: created };
    }
  );

  for (const decision of ['approve', 'reject'] as const) {
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(
      `/api/remediation/:id/${decision}`,
      { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)], schema: reasonSchema },
      async (req, reply) => {
        const user = (req as unknown as { user: JwtUser }).user;
        const outcome = await transaction(async () => {
          // Lock incident first consistently with proposal/lifecycle writers.
          const found = (
            await query<{ incident_id: string }>(
              'SELECT incident_id FROM remediation_actions WHERE id=$1',
              [req.params.id]
            )
          ).rows[0];
          if (!found) return 'unknown';
          const incident = (
            await query<{ status: IncidentStatus }>(
              'SELECT status FROM incidents WHERE id=$1 FOR UPDATE',
              [found.incident_id]
            )
          ).rows[0]!;
          if (
            decision === 'approve' &&
            !['MITIGATION_REQUIRED', 'IDENTIFIED'].includes(incident.status)
          )
            return 'conflict';
          const action = (
            await query<{ id: string; type: string }>(
              `UPDATE remediation_actions SET status=$2 WHERE id=$1 AND status='PROPOSED' RETURNING id,type`,
              [req.params.id, decision === 'approve' ? 'EXECUTING' : 'REJECTED']
            )
          ).rows[0];
          if (!action) return 'conflict';
          await query(
            'INSERT INTO remediation_approvals(action_id,user_id,decision,reason) VALUES($1,$2,$3,$4)',
            [
              action.id,
              user.sub,
              decision === 'approve' ? 'APPROVED' : 'REJECTED',
              req.body?.reason ?? null,
            ]
          );
          await query('INSERT INTO audit_log(actor,action,target,result) VALUES($1,$2,$3,$4)', [
            user.email,
            `${decision}_remediation`,
            action.id,
            decision.toUpperCase(),
          ]);
          if (decision === 'approve') {
            await transitionIncident(
              found.incident_id,
              'REMEDIATING',
              `approved ${action.type}; durable execution queued`,
              incident.status
            );
            await query('INSERT INTO remediation_jobs(action_id) VALUES($1)', [action.id]);
            await enqueueEvent(
              Topics.remediation,
              makeEnvelope({
                type: EventType.REMEDIATION_APPROVED,
                service: 'api',
                payload: { actionId: action.id, incidentId: found.incident_id, by: user.email },
              }),
              found.incident_id
            );
          }
          return 'ok';
        });
        if (outcome !== 'ok')
          return reply.code(outcome === 'unknown' ? 404 : 409).send({
            error:
              outcome === 'unknown' ? 'unknown action' : 'action or incident no longer pending',
          });
        return reply.code(decision === 'approve' ? 202 : 200).send({
          action: {
            id: req.params.id,
            status: decision === 'approve' ? 'EXECUTING' : 'REJECTED',
          },
          queued: decision === 'approve',
        });
      }
    );
  }
  app.get(
    '/api/audit',
    { preHandler: [authenticate] },
    async () =>
      (
        await query(
          'SELECT actor,action,target,result,data,at FROM audit_log ORDER BY at DESC LIMIT 100'
        )
      ).rows
  );
}
