import type { FastifyInstance } from 'fastify';

import { authenticate } from './auth.js';

/** Browser tokens are carried in upgrade headers, never URL query parameters. */
export function registerEventSocket(
  app: FastifyInstance,
  allowedOrigins: string | string[] | boolean
) {
  const sockets = new Set<{
    send(data: string): void;
    close(code?: number, reason?: string): void;
    bufferedAmount: number;
    readyState: number;
  }>();
  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: [
        async (req, reply) => {
          const origin = req.headers.origin;
          const allowed = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
          if (origin && allowedOrigins !== true && !allowed.includes(origin))
            return reply.code(403).send({ error: 'origin forbidden' });
          const protocols = req.headers['sec-websocket-protocol']?.split(',').map(p => p.trim());
          if (!req.headers.authorization && protocols?.[0] === 'sentinelops' && protocols[1])
            req.headers.authorization = `Bearer ${protocols[1]}`;
          await authenticate(req, reply);
        },
      ],
    },
    (socket, req) => {
      sockets.add(socket);
      const expiry = (req.user as { exp?: number }).exp;
      const timer = expiry
        ? setTimeout(
            () => socket.close(1008, 'session expired'),
            Math.max(0, expiry * 1000 - Date.now())
          )
        : null;
      timer?.unref();
      socket.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString() }));
      socket.on('close', () => {
        if (timer) clearTimeout(timer);
        sockets.delete(socket);
      });
    }
  );
  return (message: string) => {
    for (const socket of sockets) {
      if (socket.readyState !== 1) continue;
      if (socket.bufferedAmount > 1024 * 1024) {
        socket.close(1013, 'client too slow');
        continue;
      }
      try {
        socket.send(message);
      } catch {
        socket.close();
      }
    }
  };
}
