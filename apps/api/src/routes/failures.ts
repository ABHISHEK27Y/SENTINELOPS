import type { FastifyInstance } from 'fastify';

import { getEnv } from '@sentinelops/config';
import { query } from '@sentinelops/db';
import { FaultType, Role, type FaultType as FaultTypeT } from '@sentinelops/shared-types';

import { requireRole, authenticate, type JwtUser } from '../auth.js';
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
  const adminHeaders = { 'x-internal-token': getEnv().INTERNAL_API_TOKEN };
  // Inject a fault. ENGINEER/ADMIN only (a real change to a running service).
  app.post<{
    Params: { type: string };
    Body: { service?: string; params?: Record<string, unknown> };
  }>(
    '/api/failures/:type',
    {
      preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            service: {
              type: 'string',
              enum: SERVICES.filter(s => canInjectFault(s.id)).map(s => s.id),
            },
            params: {
              type: 'object',
              additionalProperties: false,
              properties: {
                targetMs: { type: 'number', minimum: 0, maximum: 5000 },
                probability: { type: 'number', minimum: 0, maximum: 1 },
                ttlMs: { type: 'number', minimum: 100, maximum: 900000 },
                factor: { type: 'number', minimum: 1, maximum: 10 },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!getEnv().DEMO_MODE)
        return reply.code(404).send({ error: 'demo administration disabled' });
      const type = req.params.type.replace(/-/g, '_') as FaultTypeT;
      if (!Object.values(FaultType).includes(type)) {
        return reply.code(400).send({ error: `unknown fault type: ${type}` });
      }
      const service = req.body?.service ?? DEFAULT_TARGET[type] ?? 'payment-service';
      if (!canInjectFault(service))
        return reply.code(400).send({ error: `cannot inject into ${service}` });

      const user = (req as unknown as { user: JwtUser }).user;
      try {
        const res = await fetch(`${serviceBaseUrl(service)}/admin/faults`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...adminHeaders },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ type, params: req.body?.params ?? {} }),
        });
        const body = await res.json().catch(() => ({}));
        await query(
          `INSERT INTO audit_log (actor, action, target, result, data) VALUES ($1,'inject_fault',$2,$3,$4)`,
          [
            user.email,
            service,
            String(res.status),
            JSON.stringify({ type, params: req.body?.params ?? {} }),
          ]
        );
        return reply.code(res.status).send({ service, type, result: body });
      } catch (err) {
        return reply.code(502).send({ error: `service unreachable: ${(err as Error).message}` });
      }
    }
  );

  // Clear faults on a service (or a specific fault type).
  app.delete<{ Params: { service: string }; Querystring: { type?: string } }>(
    '/api/failures/:service',
    { preHandler: [requireRole(Role.ENGINEER, Role.ADMIN)] },
    async (req, reply) => {
      if (!getEnv().DEMO_MODE)
        return reply.code(404).send({ error: 'demo administration disabled' });
      const { service } = req.params;
      if (!canInjectFault(service))
        return reply.code(400).send({ error: `unknown service ${service}` });
      const faultType = req.query.type?.replace(/-/g, '_');
      if (faultType && !(Object.values(FaultType) as string[]).includes(faultType))
        return reply.code(400).send({ error: 'unknown fault type' });
      const path = faultType ? `/admin/faults/${faultType}` : '/admin/faults';
      try {
        const res = await fetch(`${serviceBaseUrl(service)}${path}`, {
          method: 'DELETE',
          headers: adminHeaders,
          signal: AbortSignal.timeout(5000),
        });
        const user = (req as unknown as { user: JwtUser }).user;
        await query(
          "INSERT INTO audit_log(actor,action,target,result,data) VALUES ($1,'clear_fault',$2,$3,$4)",
          [
            user.email,
            service,
            String(res.status),
            JSON.stringify({ type: req.query.type ?? 'all' }),
          ]
        );
        return reply.code(res.status).send(await res.json().catch(() => ({})));
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }
  );

  // Aggregate active faults across all data-plane services.
  app.get('/api/failures', { preHandler: [authenticate] }, async () => {
    if (!getEnv().DEMO_MODE) return { enabled: false, services: [] };
    const results = await Promise.all(
      SERVICES.filter(s => canInjectFault(s.id)).map(async s => {
        try {
          const res = await fetch(`${serviceBaseUrl(s.id)}/admin/faults`, {
            headers: adminHeaders,
            signal: AbortSignal.timeout(2000),
          });
          if (!res.ok) throw new Error(`fault administration HTTP ${res.status}`);
          const body = (await res.json()) as { faults?: unknown[] };
          return { service: s.id, faults: body.faults ?? [] };
        } catch {
          return { service: s.id, faults: [], unreachable: true };
        }
      })
    );
    return results;
  });
}
