import { startTelemetry, stopTelemetry } from '@sentinelops/service-kit/telemetry';

const PORT = Number(process.env.ORDER_SERVICE_PORT ?? 8082);

await startTelemetry('order-service');
const { buildOrderService } = await import('./app.js');

const svc = buildOrderService();
await svc.start(PORT);

async function shutdown(signal: string) {
  svc.log.info({ signal }, 'shutting down');
  await svc.stop();
  await stopTelemetry();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
