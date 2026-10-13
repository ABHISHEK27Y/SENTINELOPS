import type { FastifyInstance } from 'fastify';

import { query } from '@sentinelops/db';

import { authenticate } from '../auth.js';
import { SERVICES, DEPENDENCIES } from '../topology.js';

interface ActiveIncidentRow {
  affected_services: string[];
  severity: string;
}

async function activeIncidents(): Promise<ActiveIncidentRow[]> {
  const { rows } = await query<ActiveIncidentRow>(
    `SELECT affected_services, severity FROM incidents
      WHERE status NOT IN ('RESOLVED','POSTMORTEM')`
  );
  return rows;
}

export function healthFor(service: string, incidents: ActiveIncidentRow[], fresh: boolean): string {
  if (!fresh) return 'UNKNOWN';
  const affecting = incidents.filter(i => i.affected_services.includes(service));
  if (affecting.length === 0) return 'HEALTHY';
  if (affecting.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) return 'UNHEALTHY';
  return 'DEGRADED';
}

async function freshServices(): Promise<Set<string>> {
  const { rows } = await query<{ service_id: string }>(
    "SELECT DISTINCT service_id FROM metrics WHERE ts > now() - interval '30 seconds'"
  );
  return new Set(rows.map(row => row.service_id));
}

export function registerServiceRoutes(app: FastifyInstance): void {
  app.get('/api/services', { preHandler: [authenticate] }, async () => {
    const incidents = await activeIncidents();
    const fresh = await freshServices();
    return SERVICES.map(s => ({
      ...s,
      health: healthFor(s.id, incidents, fresh.has(s.id)),
      activeIncidents: incidents.filter(i => i.affected_services.includes(s.id)).length,
    }));
  });

  app.get<{ Params: { id: string } }>(
    '/api/services/:id',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const svc = SERVICES.find(s => s.id === req.params.id);
      if (!svc) return reply.code(404).send({ error: 'unknown service' });
      const incidents = await activeIncidents();
      const fresh = await freshServices();

      const metrics = await query<{ metric: string; value: number; ts: string }>(
        `SELECT DISTINCT ON (metric) metric, value, ts
           FROM metrics WHERE service_id = $1
          ORDER BY metric, ts DESC`,
        [svc.id]
      );
      const logs = await query(
        `SELECT level, message, ts, trace_id FROM logs
          WHERE service_id = $1 ORDER BY ts DESC LIMIT 25`,
        [svc.id]
      );
      const anomalies = await query(
        `SELECT metric, value, baseline, anomaly_score, severity, created_at
           FROM anomalies WHERE service_id = $1 ORDER BY created_at DESC LIMIT 25`,
        [svc.id]
      );
      return {
        ...svc,
        health: healthFor(svc.id, incidents, fresh.has(svc.id)),
        dependsOn: DEPENDENCIES.filter(e => e.from === svc.id).map(e => e.to),
        dependedOnBy: DEPENDENCIES.filter(e => e.to === svc.id).map(e => e.from),
        metrics: metrics.rows,
        logs: logs.rows,
        anomalies: anomalies.rows,
      };
    }
  );

  // Phase 8 — service dependency graph for the React Flow view.
  app.get('/api/dependencies', { preHandler: [authenticate] }, async () => {
    const incidents = await activeIncidents();
    const fresh = await freshServices();
    return {
      nodes: SERVICES.map(s => ({
        id: s.id,
        label: s.displayName,
        tier: s.tier,
        health: healthFor(s.id, incidents, fresh.has(s.id)),
        activeIncidents: incidents.filter(i => i.affected_services.includes(s.id)).length,
      })),
      edges: DEPENDENCIES.map(e => ({ source: e.from, target: e.to })),
    };
  });
}
