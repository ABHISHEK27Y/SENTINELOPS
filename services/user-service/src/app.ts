import { createService, type ServiceContext } from '@sentinelops/service-kit';

/**
 * user-service — user records + auth lookups. A straightforward Postgres reader;
 * its DB latency contributes to the dependency graph but it is not the primary
 * failure target.
 */
export function buildUserService(): ServiceContext {
  const svc = createService({ serviceName: 'user-service', dbBaselineMs: 12 });
  const { app, simulateDbQuery } = svc;

  app.get<{ Params: { id: string } }>('/users/:id', async req => {
    const latency = await simulateDbQuery();
    return {
      id: req.params.id,
      name: `user-${req.params.id.slice(0, 6)}`,
      email: `user-${req.params.id.slice(0, 6)}@example.com`,
      dbLatencyMs: Math.round(latency),
    };
  });

  app.post<{ Body: { name?: string; email?: string } }>('/users', async (req, reply) => {
    await simulateDbQuery(20);
    return reply.code(201).send({
      id: crypto.randomUUID(),
      name: req.body?.name ?? 'anonymous',
      email: req.body?.email ?? 'anonymous@example.com',
    });
  });

  return svc;
}
