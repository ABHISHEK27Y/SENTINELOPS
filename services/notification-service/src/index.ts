import { startTelemetry, stopTelemetry } from '@sentinelops/service-kit/telemetry';

const PORT = Number(process.env.NOTIFICATION_SERVICE_PORT ?? 8084);

await startTelemetry('notification-service');
const { buildNotificationService } = await import('./app.js');

const svc = buildNotificationService();
await svc.start(PORT);

async function shutdown(signal: string) {
  svc.log.info({ signal }, 'shutting down');
  await svc.stop();
  await stopTelemetry();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
