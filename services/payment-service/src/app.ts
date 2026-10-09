import { createService, type ServiceContext } from '@sentinelops/service-kit';

/**
 * payment-service — charges an order. Heavy Postgres + Redis user and the
 * primary failure target in the demo (db_latency, pool exhaustion, errors).
 */
export function buildPaymentService(): ServiceContext {
  const svc = createService({
    serviceName: 'payment-service',
    dbBaselineMs: 30,
    redisBaselineMs: 3,
  });
  const { app, faults, simulateDbQuery, simulateRedisOp } = svc;

  app.post<{ Body: { orderId?: string; amount?: number } }>('/charge', async (req, reply) => {
    const orderId = req.body?.orderId ?? crypto.randomUUID();
    const amount = req.body?.amount ?? 0;

    // Idempotency check against Redis (best-effort — tolerate redis faults).
    try {
      await simulateRedisOp();
    } catch {
      // Redis down: degrade, don't hard-fail the charge path.
    }

    // Persist the charge (the hot DB path that saturates under db_latency).
    const dbLatency = await simulateDbQuery();

    // Injected/killed errors surface as real 500s that Prometheus counts.
    if (Math.random() < faults.errorProbability()) {
      return reply.code(500).send({
        error: 'payment processing failed',
        reason: faults.isKilled() ? 'service_killed' : 'downstream_error',
      });
    }

    return reply.send({
      status: 'charged',
      paymentId: crypto.randomUUID(),
      orderId,
      amount,
      dbLatencyMs: Math.round(dbLatency),
    });
  });

  return svc;
}
