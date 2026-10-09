import type { FastifyInstance } from 'fastify';

import {
  buildInvestigation,
  buildPostmortem,
  type InvestigationContext,
  type LlmProvider,
} from '@sentinelops/ai';
import { canTransition } from '@sentinelops/correlation';
import { query } from '@sentinelops/db';
import type { InMemoryRetriever } from '@sentinelops/rag';
import { recommendActions } from '@sentinelops/remediation';

import { authenticate } from '../auth.js';
import { SERVICES } from '../topology.js';

async function loadIncident(id: string) {
  const { rows } = await query(
    `SELECT id, title, status, severity, affected_services, correlation_id,
            root_cause, confidence, started_at, detected_at, resolved_at
       FROM incidents WHERE id = $1`,
    [id]
  );
  return rows[0] as
    | {
        id: string;
        title: string;
        status: string;
        severity: string;
        affected_services: string[];
        root_cause: unknown;
        confidence: number | null;
        started_at: string;
        detected_at: string;
        resolved_at: string | null;
      }
    | undefined;
}

async function setStatus(id: string, from: string, to: string): Promise<void> {
  if (!canTransition(from as never, to as never)) return;
  await query('UPDATE incidents SET status = $1, updated_at = now() WHERE id = $2', [to, id]);
  await query(`INSERT INTO incident_events (incident_id, kind, message) VALUES ($1,$2,$3)`, [
    id,
    'status',
    `status → ${to}`,
  ]);
}

function rootCauseService(title: string | undefined, affected: string[]): string {
  if (title) {
    const hit = SERVICES.find(s => title.includes(s.id));
    if (hit) return hit.id;
  }
  return affected[0] ?? 'unknown';
}

export function registerIncidentRoutes(
  app: FastifyInstance,
  retriever: InMemoryRetriever,
  provider: LlmProvider
): void {
  app.get('/api/incidents', { preHandler: [authenticate] }, async () => {
    const { rows } = await query(
      `SELECT id, title, status, severity, affected_services, confidence,
              started_at, detected_at, resolved_at
         FROM incidents ORDER BY detected_at DESC LIMIT 100`
    );
    return rows;
  });

  app.get<{ Params: { id: string } }>(
    '/api/incidents/:id',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const incident = await loadIncident(req.params.id);
      if (!incident) return reply.code(404).send({ error: 'unknown incident' });
      const timeline = await query(
        `SELECT at, kind, message, data FROM incident_events
          WHERE incident_id = $1 ORDER BY at ASC`,
        [incident.id]
      );
      const anomalies = await query(
        `SELECT service_id, metric, value, baseline, anomaly_score, severity, created_at
           FROM anomalies WHERE incident_id = $1 ORDER BY created_at ASC`,
        [incident.id]
      );
      const remediation = await query(
        `SELECT id, type, target_service, risk, status, rationale, requires_approval,
                proposed_at, executed_at, result
           FROM remediation_actions WHERE incident_id = $1 ORDER BY proposed_at ASC`,
        [incident.id]
      );
      const postmortem = await query(
        `SELECT content_md, generated_at FROM postmortems WHERE incident_id = $1`,
        [incident.id]
      );
      return {
        ...incident,
        timeline: timeline.rows,
        anomalies: anomalies.rows,
        remediation: remediation.rows,
        postmortem: postmortem.rows[0] ?? null,
      };
    }
  );

  // Phase 11 — AI investigation.
  app.post<{ Params: { id: string } }>(
    '/api/incidents/:id/investigate',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const incident = await loadIncident(req.params.id);
      if (!incident) return reply.code(404).send({ error: 'unknown incident' });

      const anomalyRows = (
        await query<{
          service_id: string;
          metric: string;
          value: number;
          baseline: number;
          anomaly_score: number;
          created_at: string;
        }>(
          `SELECT service_id, metric, value, baseline, anomaly_score, created_at
             FROM anomalies WHERE incident_id = $1 ORDER BY created_at ASC`,
          [incident.id]
        )
      ).rows;

      const rc = (incident.root_cause ?? null) as {
        title?: string;
        confidence?: number;
        evidence?: Array<{ summary: string }>;
      } | null;
      const rcService = rootCauseService(rc?.title, incident.affected_services);
      const metrics = [...new Set(anomalyRows.map(a => a.metric))];

      const deployments = (
        await query<{ service_id: string; deployed_at: string }>(
          `SELECT service_id, deployed_at FROM deployments
            WHERE service_id = ANY($1) ORDER BY deployed_at DESC LIMIT 5`,
          [incident.affected_services]
        )
      ).rows;

      const actions = recommendActions({
        rootCauseService: rcService,
        affectedServices: incident.affected_services,
        metrics,
        hasRecentDeployment: deployments.length > 0,
      });

      const retrieved = await retriever.search(
        `${incident.title} ${metrics.join(' ')} ${rcService}`,
        3
      );

      const ctx: InvestigationContext = {
        incidentId: incident.id,
        severity: incident.severity,
        affectedServices: incident.affected_services,
        startedAt: incident.started_at,
        anomalies: anomalyRows.map(a => ({
          service: a.service_id,
          metric: a.metric,
          value: a.value,
          baseline: a.baseline,
          anomalyScore: a.anomaly_score,
          at: a.created_at,
        })),
        rootCause: rc?.title
          ? {
              title: rc.title,
              confidence: rc.confidence ?? incident.confidence ?? 0,
              evidence: (rc.evidence ?? []).map(e => e.summary),
            }
          : null,
        runbooks: retrieved.map(r => ({
          title: String((r.metadata?.['title'] as string) ?? r.id),
          snippet: r.content.slice(0, 240),
        })),
        recommendedActions: actions,
        deployments: deployments.map(d => ({ service: d.service_id, deployedAt: d.deployed_at })),
      };

      const investigation = await buildInvestigation(ctx, provider);

      await query(
        `INSERT INTO incident_events (incident_id, kind, message, data)
         VALUES ($1,'ai_investigation',$2,$3)`,
        [incident.id, 'AI investigation completed', JSON.stringify(investigation)]
      );
      if (incident.status === 'DETECTED') await setStatus(incident.id, 'DETECTED', 'INVESTIGATING');
      if (rc?.title) {
        const cur = (await loadIncident(incident.id))!.status;
        if (cur === 'INVESTIGATING') await setStatus(incident.id, 'INVESTIGATING', 'IDENTIFIED');
      }
      return { investigation, recommendedActions: actions };
    }
  );

  // Phase 20 — postmortem generation (after resolution).
  app.post<{ Params: { id: string } }>(
    '/api/incidents/:id/postmortem',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const incident = await loadIncident(req.params.id);
      if (!incident) return reply.code(404).send({ error: 'unknown incident' });

      const invEvent = (
        await query<{ data: unknown }>(
          `SELECT data FROM incident_events
            WHERE incident_id = $1 AND kind = 'ai_investigation'
            ORDER BY at DESC LIMIT 1`,
          [incident.id]
        )
      ).rows[0];
      if (!invEvent) return reply.code(400).send({ error: 'run /investigate first' });

      const timeline = (
        await query<{ at: string; message: string }>(
          `SELECT at, message FROM incident_events WHERE incident_id = $1 ORDER BY at ASC`,
          [incident.id]
        )
      ).rows;
      const remediation = (
        await query<{ type: string; target_service: string; status: string }>(
          `SELECT type, target_service, status FROM remediation_actions WHERE incident_id = $1`,
          [incident.id]
        )
      ).rows;

      const md = buildPostmortem({
        incidentId: incident.id,
        title: incident.title,
        severity: incident.severity,
        startedAt: incident.started_at,
        resolvedAt: incident.resolved_at ?? null,
        affectedServices: incident.affected_services,
        investigation: invEvent.data as never,
        remediation: remediation.map(r => ({
          action: `${r.type} on ${r.target_service}`,
          result: r.status,
        })),
        timeline: timeline.map(t => ({ at: t.at, message: t.message })),
      });

      await query(
        `INSERT INTO postmortems (incident_id, content_md) VALUES ($1,$2)
         ON CONFLICT (incident_id) DO UPDATE SET content_md = EXCLUDED.content_md, generated_at = now()`,
        [incident.id, md]
      );
      if (incident.status === 'RESOLVED') await setStatus(incident.id, 'RESOLVED', 'POSTMORTEM');
      return { postmortem: md };
    }
  );
}
