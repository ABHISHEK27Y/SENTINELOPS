import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  DEMO_MODE: true,
  INTERNAL_API_TOKEN: 'test-internal-token-with-at-least-32-characters',
}));
vi.mock('@sentinelops/config', () => ({ getEnv: () => env }));
import { createService, type ServiceContext } from './server.js';
const services: ServiceContext[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop()));
  env.DEMO_MODE = true;
});
function harness() {
  const service = createService({ serviceName: 'test-service' });
  services.push(service);
  service.app.get('/work', async () => ({ ok: true }));
  return service;
}
describe('fault administration and business requests', () => {
  it('rejects unauthenticated direct administration and invalid parameters', async () => {
    const { app } = harness();
    expect((await app.inject('/admin/faults')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/admin/faults', headers: { 'x-internal-token': 'wrong' } }))
        .statusCode
    ).toBe(401);
    const invalid = await app.inject({
      method: 'POST',
      url: '/admin/faults',
      headers: { 'x-internal-token': env.INTERNAL_API_TOKEN },
      payload: { type: 'db_latency', params: { targetMs: 99999 } },
    });
    expect(invalid.statusCode).toBe(400);
  });
  it('disables administration outside explicit demo mode', async () => {
    env.DEMO_MODE = false;
    const { app } = harness();
    expect(
      (
        await app.inject({
          url: '/admin/faults',
          headers: { 'x-internal-token': env.INTERNAL_API_TOKEN },
        })
      ).statusCode
    ).toBe(404);
  });
  it('fails business requests while killed but keeps liveness and authorized clearing usable', async () => {
    const { app } = harness();
    const headers = { 'x-internal-token': env.INTERNAL_API_TOKEN };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/faults',
          headers,
          payload: { type: 'kill' },
        })
      ).statusCode
    ).toBe(200);
    expect((await app.inject('/work')).statusCode).toBe(503);
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/health/ready')).statusCode).toBe(503);
    await app.inject({ method: 'DELETE', url: '/admin/faults/kill', headers });
    expect((await app.inject('/work')).statusCode).toBe(200);
  });
});
