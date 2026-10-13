import http from 'node:http';

import type { Registry } from 'prom-client';

/**
 * Minimal health + metrics HTTP server for control-plane services (which are
 * Kafka consumers, not Fastify apps, but must still be observable and probeable).
 * Exposes GET /health, /health/live, /health/ready, /metrics.
 */
export interface HealthServer {
  port: number;
  close: () => Promise<void>;
}

export function startHealthServer(opts: {
  serviceName: string;
  port: number;
  registry: Registry;
  ready?: () => boolean | Promise<boolean>;
}): Promise<HealthServer> {
  const { serviceName, port, registry, ready } = opts;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(404);
        res.end();
        return;
      }
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
        let ok = false;
        try {
          ok = ready ? await ready() : true;
        } catch {
          /* dependency unavailable */
        }
        res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ready: ok }));
        return;
      }
      if (url === '/health') {
        let ok = false;
        try {
          ok = ready ? await ready() : true;
        } catch {
          /* dependency unavailable */
        }
        res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ service: serviceName, health: ok ? 'HEALTHY' : 'UNKNOWN' }));
        return;
      }
      res.writeHead(404);
      res.end();
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'health metrics unavailable' }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('health server did not bind a TCP port'));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>(r => server.close(() => r())),
      });
    });
  });
}
