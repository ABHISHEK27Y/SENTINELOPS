/**
 * Prometheus metrics registry shared by every data-plane service. This is the
 * always-available metrics path (independent of the OTel collector), scraped at
 * GET /metrics.
 */
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
} from 'prom-client';

export interface ServiceMetrics {
  registry: Registry;
  httpDuration: Histogram<'method' | 'route' | 'status'>;
  httpTotal: Counter<'method' | 'route' | 'status'>;
  httpErrors: Counter<'method' | 'route'>;
  /** Simulated/observed infrastructure gauges the fault controller drives. */
  dbPoolUtilization: Gauge<string>;
  dbQueryLatency: Histogram<string>;
  redisLatency: Histogram<string>;
  queueDepth: Gauge<string>;
  cpuUsage: Gauge<string>;
  memoryUsage: Gauge<string>;
}

export function createMetrics(serviceName: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: registry, prefix: '' });

  const httpDuration = new Histogram({
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [5, 10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000],
    registers: [registry],
  });

  const httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  const httpErrors = new Counter({
    name: 'http_request_errors_total',
    help: 'Total HTTP requests that resulted in a 5xx',
    labelNames: ['method', 'route'] as const,
    registers: [registry],
  });

  const dbPoolUtilization = new Gauge({
    name: 'db_pool_utilization',
    help: 'Fraction of the DB connection pool in use (0..1)',
    registers: [registry],
  });

  const dbQueryLatency = new Histogram({
    name: 'db_query_latency_ms',
    help: 'Database query latency in milliseconds',
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [registry],
  });

  const redisLatency = new Histogram({
    name: 'redis_latency_ms',
    help: 'Redis operation latency in milliseconds',
    buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250],
    registers: [registry],
  });

  const queueDepth = new Gauge({
    name: 'queue_depth',
    help: 'Pending items in the service work queue',
    registers: [registry],
  });

  const cpuUsage = new Gauge({
    name: 'cpu_usage',
    help: 'Approximate CPU utilization (0..1)',
    registers: [registry],
  });

  const memoryUsage = new Gauge({
    name: 'memory_usage',
    help: 'Resident memory usage in bytes',
    registers: [registry],
  });

  return {
    registry,
    httpDuration,
    httpTotal,
    httpErrors,
    dbPoolUtilization,
    dbQueryLatency,
    redisLatency,
    queueDepth,
    cpuUsage,
    memoryUsage,
  };
}
