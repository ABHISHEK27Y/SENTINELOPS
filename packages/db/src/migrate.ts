import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLogger } from '@sentinelops/logger';
import { getPool } from './pool.js';

const log = createLogger({ service: 'db-migrate' });

/** Resolve the migrations directory (env override, else repo-relative). */
export function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  // packages/db/src → repo root is three levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../infrastructure/db/migrations');
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

async function ensureTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function listMigrationFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`migrations dir not found: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 0001_, 0002_, … lexicographic == chronological
}

export async function status(): Promise<MigrationStatus> {
  await ensureTable();
  const files = listMigrationFiles(migrationsDir());
  const { rows } = await getPool().query<{ id: string }>(
    'SELECT id FROM schema_migrations',
  );
  const applied = new Set(rows.map((r) => r.id));
  return {
    applied: files.filter((f) => applied.has(f)),
    pending: files.filter((f) => !applied.has(f)),
  };
}

/** Apply all pending migrations, each in its own transaction. */
export async function up(): Promise<{ applied: string[] }> {
  const dir = migrationsDir();
  await ensureTable();
  const { pending } = await status();

  if (pending.length === 0) {
    log.info('no pending migrations');
    return { applied: [] };
  }

  const pool = getPool();
  const done: string[] = [];
  for (const file of pending) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log.info({ migration: file }, 'applied migration');
      done.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      log.error(
        { migration: file, err: (err as Error).message },
        'migration failed — rolled back',
      );
      throw err;
    } finally {
      client.release();
    }
  }
  return { applied: done };
}
