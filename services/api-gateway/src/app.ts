import { createService, type ServiceContext } from '@sentinelops/service-kit';

// Local-dev defaults use 127.0.0.1 (not "localhost") because Node's fetch resolves
// "localhost" to IPv6 ::1, while services bind IPv4 0.0.0.0. In Docker/K8s the
// *_SERVICE_URL env is set to the service DNS name and this default is unused.
const USER_URL = process.env.USER_SERVICE_URL ?? 'http://127.0.0.1:8081';
const ORDER_URL = process.env.ORDER_SERVICE_URL ?? 'http://127.0.0.1:8082';

/**
 * api-gateway — the single external entry point. Routes to user/order services,
 * propagates the request id (and, via OTel, the trace context) so a request is
 * traceable end to end.
 */
export function buildApiGateway(): ServiceContext {
  const svc = createService({ serviceName: 'api-gateway' });
  const { app, log } = svc;

  const forward = async (
    url: string,
    init: RequestInit,
    requestId?: string,
  ): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
    });

  app.get<{ Params: { id: string } }>('/users/:id', async (req, reply) => {
    const rid = (req as { requestId?: string }).requestId;
    try {
      const res = await forward(`${USER_URL}/users/${req.params.id}`, {
        method: 'GET',
      }, rid);
      return reply.code(res.status).send(await res.json());
    } catch (err) {
      log.error({ err: (err as Error).message }, 'user-service unreachable');
      return reply.code(503).send({ error: 'user-service unreachable' });
    }
  });

  app.post<{ Body: unknown }>('/orders', async (req, reply) => {
    const rid = (req as { requestId?: string }).requestId;
    try {
      const res = await forward(`${ORDER_URL}/orders`, {
        method: 'POST',
        body: JSON.stringify(req.body ?? {}),
      }, rid);
      return reply.code(res.status).send(await res.json());
    } catch (err) {
      log.error({ err: (err as Error).message }, 'order-service unreachable');
      return reply.code(503).send({ error: 'order-service unreachable' });
    }
  });

  return svc;
}
