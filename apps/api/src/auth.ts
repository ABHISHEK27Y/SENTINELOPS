import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getEnv } from '@sentinelops/config';
import { query } from '@sentinelops/db';
import { Role, type Role as RoleT } from '@sentinelops/shared-types';

import { consumeLoginAttempt, pruneLoginAttempts } from './login-limiter.js';

export interface JwtUser {
  sub: string;
  email: string;
  role: RoleT;
  name: string;
}

/** Default dev users, seeded on first boot if the users table is empty. */
const SEED_USERS = [
  { email: 'admin@sentinelops.dev', name: 'Admin', role: Role.ADMIN, password: 'admin123' },
  {
    email: 'engineer@sentinelops.dev',
    name: 'Engineer',
    role: Role.ENGINEER,
    password: 'engineer123',
  },
  { email: 'viewer@sentinelops.dev', name: 'Viewer', role: Role.VIEWER, password: 'viewer123' },
];

export async function seedUsers(): Promise<void> {
  if (!getEnv().DEMO_MODE) return;
  const { rows } = await query<{ count: string }>('SELECT count(*)::text FROM users');
  if (Number(rows[0]?.count ?? '0') > 0) return;
  for (const u of SEED_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
      [u.email, u.name, hash, u.role]
    );
  }
}

/** POST /api/auth/login → { token }. */
export function registerAuthRoutes(app: FastifyInstance): void {
  let pruning: Promise<void> | null = null;
  const cleanup = setInterval(() => {
    if (pruning) return;
    pruning = pruneLoginAttempts()
      .catch(err => app.log.error({ err }, 'login bucket cleanup failed'))
      .finally(() => {
        pruning = null;
      });
  }, 60_000);
  cleanup.unref();
  app.addHook('onClose', async () => {
    clearInterval(cleanup);
    await pruning;
  });
  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
      preHandler: async (req, reply) => {
        let bucket;
        try {
          bucket = await consumeLoginAttempt(req.ip);
        } catch {
          return reply
            .header('Retry-After', '5')
            .code(503)
            .send({ error: 'login temporarily unavailable' });
        }
        if (!bucket.allowed)
          return reply
            .header('Retry-After', String(bucket.retryAfter))
            .code(429)
            .send({ error: 'too many login attempts' });
      },
    },
    async (req, reply) => {
      const { email, password } = req.body ?? {};
      if (!email || !password)
        return reply.code(400).send({ error: 'email and password required' });
      const { rows } = await query<{
        id: string;
        email: string;
        name: string;
        role: RoleT;
        password_hash: string;
      }>('SELECT id, email, name, role, password_hash FROM users WHERE email = $1', [email]);
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return reply.code(401).send({ error: 'invalid credentials' });
      }
      const token = await reply.jwtSign({
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      } satisfies JwtUser);
      return { token, user: { email: user.email, name: user.name, role: user.role } };
    }
  );

  app.get('/api/auth/me', { preHandler: [authenticate] }, async req => {
    return { user: (req as unknown as { user: JwtUser }).user };
  });
}

/** preHandler: require a valid JWT. */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}

/** preHandler factory: require the user to have one of the given roles. */
export function requireRole(...roles: RoleT[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const user = (req as unknown as { user: JwtUser }).user;
    if (!roles.includes(user.role)) {
      await reply.code(403).send({ error: `requires role: ${roles.join(' or ')}` });
    }
  };
}
