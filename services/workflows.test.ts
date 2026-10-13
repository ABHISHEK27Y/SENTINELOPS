import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceContext } from '@sentinelops/service-kit';
import { FaultType } from '@sentinelops/shared-types';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() }));
vi.mock('@sentinelops/logger', () => ({ createLogger: () => log }));
vi.mock('@sentinelops/config', () => ({
  getEnv: () => ({
    DEMO_MODE: true,
    INTERNAL_API_TOKEN: 'test-internal-token-with-more-than-32-characters',
  }),
}));
import { buildApiGateway } from './api-gateway/src/app.js';
import { buildNotificationService } from './notification-service/src/app.js';
import { buildOrderService } from './order-service/src/app.js';
import { buildPaymentService } from './payment-service/src/app.js';
import { buildUserService } from './user-service/src/app.js';

const services: ServiceContext[] = [];
function create(build: () => ServiceContext) {
  const svc = build();
  services.push(svc);
  return svc;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('KAFKA_TELEMETRY', 'off');
  log.child.mockReturnValue(log);
});
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('demo business workflows', () => {
  it('forwards gateway requests, IDs and downstream statuses with bounded fetches', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ status: 201, json: async () => ({ downstream: true }) });
    vi.stubGlobal('fetch', fetch);
    const { app } = create(buildApiGateway);
    for (const request of [
      { method: 'GET' as const, url: '/users/user-a' },
      { method: 'POST' as const, url: '/orders', payload: { userId: 'user-a' } },
    ]) {
      const response = await app.inject({ ...request, headers: { 'x-request-id': 'request-a' } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ downstream: true });
    }
    expect(fetch.mock.calls.every(call => call[1].headers['x-request-id'] === 'request-a')).toBe(
      true
    );
    expect(fetch.mock.calls.every(call => call[1].signal instanceof AbortSignal)).toBe(true);
    fetch.mockRejectedValue(new Error('downstream unavailable'));
    expect((await app.inject('/users/user-a')).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/orders', payload: {} })).statusCode).toBe(
      503
    );
  });
  it('returns generated demo users after instrumented DB work', async () => {
    const { app } = create(buildUserService);
    expect((await app.inject('/users/abcdefghi')).json()).toMatchObject({
      id: 'abcdefghi',
      name: 'user-abcdef',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Demo User', email: 'demo@example.test' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Demo User', email: 'demo@example.test' });
  });
  it('continues simulated charges through cache failures', async () => {
    const svc = create(buildPaymentService);
    svc.faults.enable(FaultType.BREAK_REDIS);
    const response = await svc.app.inject({
      method: 'POST',
      url: '/charge',
      payload: { orderId: 'order-a', amount: 42 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'charged', orderId: 'order-a', amount: 42 });
    expect(response.json().dbLatencyMs).toBeGreaterThan(0);
  });
  it('creates orders when notification delivery fails but requires successful payment', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'charged' }) })
      .mockRejectedValueOnce(new Error('notification offline'));
    vi.stubGlobal('fetch', fetch);
    const { app } = create(buildOrderService);
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'x-request-id': 'request-a' },
      payload: { userId: 'user-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'created',
      userId: 'user-a',
      payment: { status: 'charged' },
    });
    expect(log.warn).toHaveBeenCalled();
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect((await app.inject({ method: 'POST', url: '/orders', payload: {} })).statusCode).toBe(
      502
    );
    fetch.mockRejectedValueOnce(new Error('payment offline'));
    expect((await app.inject({ method: 'POST', url: '/orders', payload: {} })).statusCode).toBe(
      503
    );
  });
  it('queues notifications, drains their gauge and surfaces simulated Redis failures', async () => {
    const svc = create(buildNotificationService);
    expect(
      (await svc.app.inject({ method: 'POST', url: '/notify', payload: { channel: 'email' } }))
        .statusCode
    ).toBe(202);
    await vi.waitFor(async () =>
      expect((await svc.metrics.queueDepth.get()).values[0]?.value).toBe(0)
    );
    svc.faults.enable(FaultType.BREAK_REDIS);
    expect((await svc.app.inject({ method: 'POST', url: '/notify', payload: {} })).statusCode).toBe(
      503
    );
  });
});
