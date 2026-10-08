import http from 'node:http';
import type { Registry } from 'prom-client';

/**
 * Minimal health + metrics HTTP server for control-plane services (which are
 * Kafka consumers, not Fastify apps, but must still be observable and probeable).
 * Exposes GET /health, /health/live, /health/ready, /metrics.
 */
export interface HealthServer {
  close: () => Promise<void>;
}

export function startHealthServer(opts: {
  serviceName: string;
  port: number;
  registry: Registry;
  ready?: () => boolean;
}): Promise<HealthServer> {
  const { serviceName, port, registry, ready } = opts;

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (url === '/metrics') {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
      return;
    }
    if (url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'alive' }));
      return;
    }
    if (url === '/health/ready') {
      const ok = ready ? ready() : true;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ready: ok }));
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: serviceName, health: 'HEALTHY' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      resolve({
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
