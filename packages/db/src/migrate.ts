import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from './pool.js';

export function migrationsDir(): string {
  if (process.env['MIGRATIONS_DIR']) return process.env['MIGRATIONS_DIR'];
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../infrastructure/db/migrations'
  );
}
export interface MigrationStatus {
  applied: string[];
  pending: string[];
}
function files(): string[] {
  const dir = migrationsDir();
  if (!existsSync(dir)) throw new Error(`migrations dir not found: ${dir}`);
  return readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
}
export async function status(): Promise<MigrationStatus> {
  const exists = await getPool().query<{ table_name: string | null }>(
    "SELECT to_regclass('public.schema_migrations') AS table_name"
  );
  if (!exists.rows[0]?.table_name) return { applied: [], pending: files() };
  const { rows } = await getPool().query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map(r => r.id));
  return {
    applied: files().filter(f => applied.has(f)),
    pending: files().filter(f => !applied.has(f)),
  };
}
/** Session lock spans every migration transaction and prevents startup races. */
export async function up(): Promise<{ applied: string[] }> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(7349202)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), checksum TEXT)'
    );
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
    for (const file of files()) {
      const sql = readFileSync(path.join(migrationsDir(), file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string | null }>(
        'SELECT checksum FROM schema_migrations WHERE id=$1',
        [file]
      );
      if (existing.rows.length) {
        const prior = existing.rows[0]!.checksum;
        if (prior && prior !== checksum) throw new Error(`applied migration changed: ${file}`);
        if (!prior)
          await client.query('UPDATE schema_migrations SET checksum=$2 WHERE id=$1', [
            file,
            checksum,
          ]);
        continue;
      }
      await client.query('BEGIN');
      try {
        if (file === '0003_reliable_processing.sql') {
          const duplicates = await client.query<{ action_id: string }>(
            'SELECT action_id FROM remediation_approvals GROUP BY action_id HAVING count(*)>1 LIMIT 1'
          );
          if (duplicates.rows.length)
            throw new Error(
              'migration blocked: duplicate remediation approvals exist; reconcile historical decisions before adding the unique constraint'
            );
        }
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(id,checksum) VALUES ($1,$2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return { applied };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(7349202)');
    } finally {
      client.release();
    }
  }
}
