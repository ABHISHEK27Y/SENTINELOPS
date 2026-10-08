import type { FastifyInstance } from 'fastify';
import { FaultType, Role, type FaultType as FaultTypeT } from '@sentinelops/shared-types';
import { requireRole, authenticate, type JwtUser } from '../auth.js';
import { query } from '@sentinelops/db';
import { serviceBaseUrl, canInjectFault, SERVICES } from '../topology.js';

/** Default target service for each fault type (body can override). */
const DEFAULT_TARGET: Record<string, string> = {
  [FaultType.DB_LATENCY]: 'payment-service',
  [FaultType.ERROR_INJECTION]: 'payment-service',
  [FaultType.KILL]: 'payment-service',
  [FaultType.BREAK_REDIS]: 'notification-service',
  [FaultType.CPU_STRESS]: 'order-service',
  [FaultType.MEMORY_LEAK]: 'order-service',
  [FaultType.TRAFFIC_SPIKE]: 'api-gateway',
  [FaultType.KAFKA_LAG]: 'payment-service',
  [FaultType.NETWORK_FAILURE]: 'order-service',
};

export function registerFailureRoutes(app: FastifyInstance): void {
  // Inject a fault. ENGINEER/ADMIN only (a real change to a running service).
  app.post<{ Params: { type: string }; Body: { service?: string; params?: Record<string, unknown> } }>(
    '/api/failures/:type',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      const type = req.params.type.replace(/-/g, '_') as FaultTypeT;
      if (!Object.values(FaultType).includes(type)) {
        return reply.code(400).send({ error: `unknown fault type: ${type}` });
      }
      const service = req.body?.service ?? DEFAULT_TARGET[type] ?? 'payment-service';
      if (!canInjectFault(service)) return reply.code(400).send({ error: `cannot inject into ${service}` });

      const user = (req as unknown as { user: JwtUser }).user;
      try {
        const res = await fetch(`${serviceBaseUrl(service)}/admin/faults`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type, params: req.body?.params ?? {} }),
        });
        const body = await res.json().catch(() => ({}));
        await query(
          `INSERT INTO audit_log (actor, action, target, result, data) VALUES ($1,'inject_fault',$2,$3,$4)`,
          [user.email, service, String(res.status), JSON.stringify({ type, params: req.body?.params ?? {} })],
        );
        return reply.code(res.status).send({ service, type, result: body });
      } catch (err) {
        return reply.code(502).send({ error: `service unreachable: ${(err as Error).message}` });
      }
    },
  );

  // Clear faults on a service (or a specific fault type).
  app.delete<{ Params: { service: string }; Querystring: { type?: string } }>(
    '/api/failures/:service',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      const { service } = req.params;
      if (!canInjectFault(service)) return reply.code(400).send({ error: `unknown service ${service}` });
      const path = req.query.type ? `/admin/faults/${req.query.type.replace(/-/g, '_')}` : '/admin/faults';
      try {
        const res = await fetch(`${serviceBaseUrl(service)}${path}`, { method: 'DELETE' });
        return reply.code(res.status).send(await res.json().catch(() => ({})));
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );

  // Aggregate active faults across all data-plane services.
  app.get('/api/failures', { preHandler: [authenticate] }, async () => {
    const results = await Promise.all(
      SERVICES.filter((s) => canInjectFault(s.id)).map(async (s) => {
        try {
          const res = await fetch(`${serviceBaseUrl(s.id)}/admin/faults`, { signal: AbortSignal.timeout(2000) });
          const body = (await res.json()) as { faults?: unknown[] };
          return { service: s.id, faults: body.faults ?? [] };
        } catch {
          return { service: s.id, faults: [], unreachable: true };
        }
      }),
    );
    return results;
  });
}
