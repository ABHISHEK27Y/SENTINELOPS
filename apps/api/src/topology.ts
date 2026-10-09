import type { DirectedEdge } from '@sentinelops/root-cause';

export interface ServiceInfo {
  id: string;
  displayName: string;
  tier: 'edge' | 'application' | 'data' | 'control';
  port: number;
}

export const SERVICES: ServiceInfo[] = [
  { id: 'api-gateway', displayName: 'API Gateway', tier: 'edge', port: 8080 },
  { id: 'user-service', displayName: 'User Service', tier: 'application', port: 8081 },
  { id: 'order-service', displayName: 'Order Service', tier: 'application', port: 8082 },
  { id: 'payment-service', displayName: 'Payment Service', tier: 'application', port: 8083 },
  {
    id: 'notification-service',
    displayName: 'Notification Service',
    tier: 'application',
    port: 8084,
  },
  { id: 'postgres', displayName: 'PostgreSQL', tier: 'data', port: 5432 },
  { id: 'redis', displayName: 'Redis', tier: 'data', port: 6379 },
];

export const DEPENDENCIES: DirectedEdge[] = [
  { from: 'api-gateway', to: 'user-service' },
  { from: 'api-gateway', to: 'order-service' },
  { from: 'order-service', to: 'payment-service' },
  { from: 'order-service', to: 'notification-service' },
  { from: 'payment-service', to: 'postgres' },
  { from: 'user-service', to: 'postgres' },
  { from: 'notification-service', to: 'redis' },
  { from: 'payment-service', to: 'redis' },
];

const PORT = new Map(SERVICES.map(s => [s.id, s.port]));

/** Base URL for a monitored service. Container DNS in prod, localhost in dev. */
export function serviceBaseUrl(service: string): string {
  const port = PORT.get(service);
  if (!port) return '';
  const host = process.env.NODE_ENV === 'production' ? service : '127.0.0.1';
  return `http://${host}:${port}`;
}

/** Services that expose the fault-injection admin API (data-plane HTTP services). */
export function canInjectFault(service: string): boolean {
  return [
    'api-gateway',
    'user-service',
    'order-service',
    'payment-service',
    'notification-service',
  ].includes(service);
}
