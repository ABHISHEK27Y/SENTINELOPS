import { startTelemetry, stopTelemetry } from '@sentinelops/service-kit/telemetry';

const PORT = Number(process.env['USER_SERVICE_PORT'] ?? 8081);

await startTelemetry('user-service');
const { buildUserService } = await import('./app.js');

const svc = buildUserService();
await svc.start(PORT);

async function shutdown(signal: string) {
  svc.log.info({ signal }, 'shutting down');
  await svc.stop();
  await stopTelemetry();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
