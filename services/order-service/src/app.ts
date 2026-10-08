import { createService, type ServiceContext } from '@sentinelops/service-kit';

// 127.0.0.1 (not "localhost") for local dev — Node fetch prefers IPv6 ::1 while
// services bind IPv4. In containers the *_SERVICE_URL env overrides this.
const PAYMENT_URL =
  process.env.PAYMENT_SERVICE_URL ?? 'http://127.0.0.1:8083';
const NOTIFICATION_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:8084';

/**
 * order-service — orchestrates order creation. Calls payment-service over HTTP
 * (a real cross-service hop that produces a distributed trace) and records its
 * own DB work.
 */
export function buildOrderService(): ServiceContext {
  const svc = createService({
    serviceName: 'order-service',
    dbBaselineMs: 15,
  });
  const { app, simulateDbQuery, log } = svc;

  app.post<{ Body: { userId?: string; items?: unknown[] } }>(
    '/orders',
    async (req, reply) => {
      const userId = req.body?.userId ?? crypto.randomUUID();
      const orderId = crypto.randomUUID();

      // Create the order row.
      await simulateDbQuery();

      // Charge via payment-service. Propagate the request id for correlation;
      // OTel auto-instrumentation propagates the trace context on this fetch.
      const requestId = (req as { requestId?: string }).requestId;
      let payment: unknown;
      try {
        const res = await fetch(`${PAYMENT_URL}/charge`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(requestId ? { 'x-request-id': requestId } : {}),
          },
          body: JSON.stringify({ orderId, amount: 42 }),
        });
        if (!res.ok) {
          log.warn({ orderId, status: res.status }, 'payment failed');
          return reply
            .code(502)
            .send({ error: 'payment declined', orderId, status: res.status });
        }
        payment = await res.json();
      } catch (err) {
        log.error({ orderId, err: (err as Error).message }, 'payment call errored');
        return reply.code(503).send({ error: 'payment unreachable', orderId });
      }

      // Fire a notification (best-effort; a notification outage must not fail the
      // order, but it does degrade this service's success signal).
      try {
        await fetch(`${NOTIFICATION_URL}/notify`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(requestId ? { 'x-request-id': requestId } : {}),
          },
          body: JSON.stringify({
            to: userId,
            channel: 'email',
            message: `Order ${orderId} confirmed`,
          }),
        });
      } catch (err) {
        log.warn(
          { orderId, err: (err as Error).message },
          'notification dispatch failed (non-fatal)',
        );
      }

      return reply.send({ status: 'created', orderId, userId, payment });
    },
  );

  return svc;
}
