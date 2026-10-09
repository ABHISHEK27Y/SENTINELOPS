import pg from 'pg';

import { getEnv } from '@sentinelops/config';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Lazily-created shared connection pool from the validated DATABASE_URL. */
export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Small helper for one-off queries. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as never);
}
