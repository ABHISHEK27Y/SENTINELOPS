import { Registry } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHealthServer, type HealthServer } from './health-server.js';

const servers: HealthServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});
describe('control-plane health endpoints', () => {
  it('distinguishes liveness from missing dependencies and exports metrics', async () => {
    let ready = true;
    const registry = new Registry();
    const server = await startHealthServer({
      serviceName: 'test-engine',
      port: 0,
      registry,
      ready: async () => ready,
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ health: 'HEALTHY' });
    ready = false;
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ health: 'UNKNOWN' });
    expect((await fetch(`${base}/metrics`)).headers.get('content-type')).toContain('text/plain');
    expect((await fetch(`${base}/missing`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });
  it('returns 503 for readiness and registry exceptions and rejects occupied ports', async () => {
    const registry = new Registry();
    vi.spyOn(registry, 'metrics').mockRejectedValue(new Error('registry failed'));
    const server = await startHealthServer({
      serviceName: 'test-engine',
      port: 0,
      registry,
      ready: async () => {
        throw new Error('database offline');
      },
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    for (const route of ['/health', '/health/ready', '/metrics'])
      expect((await fetch(`${base}${route}`)).status).toBe(503);
    await expect(
      startHealthServer({ serviceName: 'other', port: server.port, registry })
    ).rejects.toThrow();
  });
});
