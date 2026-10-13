import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerEventSocket } from './event-socket.js';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});
async function harness() {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'test-unique-websocket-secret-at-least-32-characters' });
  await app.register(websocket);
  const broadcast = registerEventSocket(app, ['http://localhost:3000']);
  await app.ready();
  return { app, broadcast };
}
describe('event socket upgrades', () => {
  it('rejects missing authentication, query tokens and forbidden origins', async () => {
    const { app } = await harness();
    const token = app.jwt.sign({ sub: 'viewer', role: 'VIEWER' }, { expiresIn: '1h' });
    await expect(app.injectWS('/ws')).rejects.toThrow();
    await expect(app.injectWS(`/ws?token=${token}`)).rejects.toThrow();
    await expect(
      app.injectWS('/ws', {
        headers: { origin: 'https://untrusted.example', authorization: `Bearer ${token}` },
      })
    ).rejects.toThrow();
  });
  it('accepts an authenticated browser protocol and broadcasts events', async () => {
    const { app, broadcast } = await harness();
    const token = app.jwt.sign({ sub: 'viewer', role: 'VIEWER' }, { expiresIn: '1h' });
    const socket = await app.injectWS('/ws', {
      headers: {
        origin: 'http://localhost:3000',
        'sec-websocket-protocol': `sentinelops, ${token}`,
      },
    });
    const event = new Promise<string>(resolve =>
      socket.once('message', (data: unknown) => resolve(String(data)))
    );
    broadcast('{"type":"INCIDENT_UPDATED"}');
    expect(await event).toContain('INCIDENT_UPDATED');
    socket.close();
  });
});
