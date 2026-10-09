import type { Edge } from '@sentinelops/correlation';

/**
 * The demo service dependency topology. In production this is loaded from the
 * `service_dependencies` table (discovered from traces); seeded here so the
 * correlator works out of the box.
 */
export const SERVICE_DEPENDENCIES: Edge[] = [
  { from: 'api-gateway', to: 'user-service' },
  { from: 'api-gateway', to: 'order-service' },
  { from: 'order-service', to: 'payment-service' },
  { from: 'order-service', to: 'notification-service' },
  { from: 'payment-service', to: 'postgres' },
  { from: 'user-service', to: 'postgres' },
  { from: 'notification-service', to: 'redis' },
  { from: 'payment-service', to: 'redis' },
];
