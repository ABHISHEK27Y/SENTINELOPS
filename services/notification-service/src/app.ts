import { createService, type ServiceContext } from '@sentinelops/service-kit';

/**
 * notification-service — accepts notifications onto a Redis-backed queue and
 * drains them with a background worker. It owns the `queue_depth` gauge: the
 * queue grows when Redis is broken or under a traffic spike, which is the
 * saturation signal for this service.
 */
export function buildNotificationService(): ServiceContext {
  const svc = createService({
    serviceName: 'notification-service',
    redisBaselineMs: 4,
  });
  const { app, metrics, simulateRedisOp, log } = svc;

  // In-memory stand-in for the Redis list depth (real Redis wiring: Phase 4).
  let pending = 0;

  app.post<{ Body: { to?: string; channel?: string; message?: string } }>(
    '/notify',
    async (req, reply) => {
      try {
        await simulateRedisOp(); // enqueue onto Redis
      } catch (err) {
        // Redis broken → cannot enqueue; surface as a real failure.
        log.error({ err: (err as Error).message }, 'enqueue failed');
        return reply.code(503).send({ error: 'notification queue unavailable' });
      }
      pending += 1;
      metrics.queueDepth.set(pending);
      return reply.code(202).send({
        status: 'queued',
        channel: req.body?.channel ?? 'email',
        pending,
      });
    }
  );

  // Background worker drains the queue (~20 notifications/sec when Redis is up).
  let draining: Promise<void> | null = null;
  const worker = setInterval(() => {
    if (pending === 0 || draining) return;
    draining = (async () => {
      try {
        await simulateRedisOp(); // dequeue
        pending = Math.max(0, pending - 1);
        metrics.queueDepth.set(pending);
      } catch {
        // Redis broken: leave queued notifications pending.
      }
    })().finally(() => {
      draining = null;
    });
  }, 50);
  worker.unref();
  app.addHook('onClose', async () => {
    clearInterval(worker);
    await draining;
  });

  return svc;
}
