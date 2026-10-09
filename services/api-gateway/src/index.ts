import { startTelemetry, stopTelemetry } from '@sentinelops/service-kit/telemetry';

const PORT = Number(process.env['API_GATEWAY_PORT'] ?? 8080);

await startTelemetry('api-gateway');
const { buildApiGateway } = await import('./app.js');

const svc = buildApiGateway();
await svc.start(PORT);

async function shutdown(signal: string) {
  svc.log.info({ signal }, 'shutting down');
  await svc.stop();
  await stopTelemetry();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
