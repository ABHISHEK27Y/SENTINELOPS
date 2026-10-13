import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ query: vi.fn(), demo: false }));
vi.mock('@sentinelops/db', () => ({ query: deps.query }));
vi.mock('@sentinelops/config', () => ({ getEnv: () => ({ DEMO_MODE: deps.demo }) }));
import { registerAuthRoutes, requireRole, seedUsers } from './auth.js';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.clearAllMocks();
});
async function appHarness() {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'a-unique-test-secret-of-at-least-32-characters' });
  registerAuthRoutes(app);
  app.get('/restricted', { preHandler: [requireRole('ENGINEER', 'ADMIN')] }, async () => ({
    ok: true,
  }));
  return app;
}
describe('authentication boundaries', () => {
  it('does not create known demo accounts outside demo mode', async () => {
    deps.demo = false;
    await seedUsers();
    expect(deps.query).not.toHaveBeenCalled();
  });
  it('rejects missing, forged, expired and insufficient-role tokens', async () => {
    const app = await appHarness();
    expect((await app.inject('/restricted')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/restricted', headers: { authorization: 'Bearer forged' } }))
        .statusCode
    ).toBe(401);
    const expired = app.jwt.sign({ role: 'ADMIN', exp: 1 });
    const viewer = app.jwt.sign({ role: 'VIEWER' });
    const engineer = app.jwt.sign({ role: 'ENGINEER' });
    for (const [token, status] of [
      [expired, 401],
      [viewer, 403],
      [engineer, 200],
    ] as const) {
      expect(
        (await app.inject({ url: '/restricted', headers: { authorization: `Bearer ${token}` } }))
          .statusCode
      ).toBe(status);
    }
  });
  it('validates login input before querying storage and throttles repeated failures', async () => {
    const app = await appHarness();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: {}, password: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(deps.query).not.toHaveBeenCalled();
    let count = 0;
    deps.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('INSERT INTO login_attempts')
        ? [{ attempts: ++count, retry_after: 60 }]
        : [],
    }));
    for (let i = 0; i < 10; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { email: 'missing@example.test', password: 'wrong' },
          })
        ).statusCode
      ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'missing@example.test', password: 'wrong' },
        })
      ).statusCode
    ).toBe(429);
    expect(
      deps.query.mock.calls.filter(call => String(call[0]).includes('FROM users'))
    ).toHaveLength(10);
    expect(
      deps.query.mock.calls.filter(call => String(call[0]).includes('INSERT INTO login_attempts'))
    ).toHaveLength(11);
  });
  it('fails closed without checking credentials when the shared limiter is unavailable', async () => {
    const app = await appHarness();
    deps.query.mockRejectedValue(new Error('database unavailable'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.test', password: 'test' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(deps.query.mock.calls.some(call => String(call[0]).includes('FROM users'))).toBe(false);
  });
});
