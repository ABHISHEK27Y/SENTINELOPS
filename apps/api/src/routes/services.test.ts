import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@sentinelops/db', () => db);
import { healthFor, registerServiceRoutes } from './services.js';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.clearAllMocks();
});
describe('service health freshness', () => {
  it('marks absent telemetry unknown even when no incident exists', () => {
    expect(healthFor('payment', [], false)).toBe('UNKNOWN');
    expect(healthFor('payment', [], true)).toBe('HEALTHY');
  });
  it('classifies only active incidents affecting a fresh service', () => {
    const incidents = [{ affected_services: ['payment'], severity: 'HIGH' }];
    expect(healthFor('payment', incidents, true)).toBe('UNHEALTHY');
    expect(healthFor('orders', incidents, true)).toBe('HEALTHY');
    expect(healthFor('payment', [{ affected_services: ['payment'], severity: 'LOW' }], true)).toBe(
      'DEGRADED'
    );
  });
});
describe('service catalog and evidence API', () => {
  it('requires authentication and returns freshness-based health plus directed dependencies', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(jwt, { secret: 'test-secret-service-routes-at-least-32-characters' });
    registerServiceRoutes(app);
    db.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM incidents')
        ? [{ affected_services: ['payment-service'], severity: 'HIGH' }]
        : sql.includes('SELECT DISTINCT service_id')
          ? [{ service_id: 'payment-service' }]
          : sql.includes('FROM metrics')
            ? [{ metric: 'latency', value: 2500, ts: new Date().toISOString() }]
            : sql.includes('FROM logs')
              ? [{ level: 'ERROR', message: 'pool timeout' }]
              : sql.includes('FROM anomalies')
                ? [{ metric: 'latency', severity: 'HIGH' }]
                : [],
    }));
    expect((await app.inject('/api/services')).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${app.jwt.sign({ role: 'VIEWER' })}` };
    const catalog = (await app.inject({ url: '/api/services', headers })).json();
    expect(catalog.find((service: { id: string }) => service.id === 'payment-service').health).toBe(
      'UNHEALTHY'
    );
    expect(catalog.find((service: { id: string }) => service.id === 'postgres').health).toBe(
      'UNKNOWN'
    );
    const detail = (await app.inject({ url: '/api/services/payment-service', headers })).json();
    expect(detail.metrics[0].value).toBe(2500);
    expect(detail.logs[0].message).toBe('pool timeout');
    expect(detail.dependsOn).toContain('postgres');
    expect(detail.dependedOnBy).toContain('order-service');
    expect((await app.inject({ url: '/api/services/missing', headers })).statusCode).toBe(404);
    const graph = (await app.inject({ url: '/api/dependencies', headers })).json();
    expect(graph.edges).toContainEqual({ source: 'payment-service', target: 'postgres' });
    expect(
      graph.nodes.find((node: { id: string }) => node.id === 'payment-service').activeIncidents
    ).toBe(1);
  });
});
