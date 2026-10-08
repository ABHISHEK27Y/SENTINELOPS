import { startTelemetry, stopTelemetry } from '@sentinelops/service-kit/telemetry';

const PORT = Number(process.env.PAYMENT_SERVICE_PORT ?? 8083);

// Start OTel BEFORE importing the app so http/fastify get auto-instrumented.
await startTelemetry('payment-service');
const { buildPaymentService } = await import('./app.js');

const svc = buildPaymentService();
await svc.start(PORT);

async function shutdown(signal: string) {
  svc.log.info({ signal }, 'shutting down');
  await svc.stop();
  await stopTelemetry();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
