import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ query: vi.fn(), demo: true }));
vi.mock('@sentinelops/db', () => ({ query: deps.query }));
vi.mock('@sentinelops/config', () => ({
  getEnv: () => ({ DEMO_MODE: deps.demo, INTERNAL_API_TOKEN: 'test-internal-token' }),
}));
import { registerFailureRoutes } from './failures.js';

const apps: ReturnType<typeof Fastify>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  deps.demo = true;
  deps.query.mockResolvedValue({ rows: [] });
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.unstubAllGlobals();
});
async function harness(role = 'ENGINEER') {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long' });
  registerFailureRoutes(app);
  return {
    app,
    headers: { authorization: `Bearer ${app.jwt.sign({ role, email: 'operator@example.test' })}` },
  };
}
describe('platform failure administration', () => {
  it('rejects unauthenticated and viewer mutations without contacting services', async () => {
    const { app, headers } = await harness('VIEWER');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await app.inject('/api/failures')).statusCode).toBe(401);
    for (const method of ['POST', 'DELETE'] as const)
      expect(
        (
          await app.inject({
            method,
            url: '/api/failures/db-latency',
            headers,
            ...(method === 'POST' ? { payload: {} } : {}),
          })
        ).statusCode
      ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(deps.query).not.toHaveBeenCalled();
  });
  it('validates fault enums, targets and bounded parameters', async () => {
    const { app, headers } = await harness();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const [url, payload] of [
      ['/api/failures/unknown', {}],
      ['/api/failures/db-latency', { service: 'postgres' }],
      ['/api/failures/db-latency', { params: { targetMs: 10000 } }],
    ] as const)
      expect((await app.inject({ method: 'POST', url, payload, headers })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/failures/payment-service?type=unknown',
          headers,
        })
      ).statusCode
    ).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/failures/unknown', headers })).statusCode
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('authenticates a scoped injection and records the actual outcome', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({ faults: ['db_latency'] }) });
    vi.stubGlobal('fetch', fetch);
    const { app, headers } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/failures/db-latency',
      headers,
      payload: { params: { targetMs: 2500, ttlMs: 10000 } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().service).toBe('payment-service');
    const request = fetch.mock.calls[0]!;
    expect(request[0]).toContain('/admin/faults');
    expect(request[1].headers['x-internal-token']).toBe('test-internal-token');
    expect(request[1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request[1].body).type).toBe('db_latency');
    expect(deps.query.mock.calls[0]?.[1].slice(0, 3)).toEqual([
      'operator@example.test',
      'payment-service',
      '200',
    ]);
  });
  it('clears one fault or all faults and audits both requests', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ cleared: true }) });
    vi.stubGlobal('fetch', fetch);
    const { app, headers } = await harness();
    for (const suffix of ['?type=db-latency', ''])
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/failures/payment-service${suffix}`,
            headers,
          })
        ).statusCode
      ).toBe(200);
    expect(fetch.mock.calls[0]?.[0]).toContain('/admin/faults/db_latency');
    expect(fetch.mock.calls[1]?.[0]).toMatch(/\/admin\/faults$/);
    expect(deps.query).toHaveBeenCalledTimes(2);
  });
  it('marks failed service queries unreachable instead of showing a clean state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const { app, headers } = await harness('VIEWER');
    const response = await app.inject({ url: '/api/failures', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().every((service: { unreachable: boolean }) => service.unreachable)).toBe(
      true
    );
  });
  it('returns service transport failures and disables administration outside demo mode', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const { app, headers } = await harness();
    expect(
      (await app.inject({ method: 'POST', url: '/api/failures/db-latency', headers, payload: {} }))
        .statusCode
    ).toBe(502);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/failures/payment-service', headers }))
        .statusCode
    ).toBe(502);
    deps.demo = false;
    fetch.mockClear();
    expect(
      (await app.inject({ method: 'POST', url: '/api/failures/db-latency', headers, payload: {} }))
        .statusCode
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/failures/payment-service', headers }))
        .statusCode
    ).toBe(404);
    expect((await app.inject({ url: '/api/failures', headers })).json()).toMatchObject({
      enabled: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
