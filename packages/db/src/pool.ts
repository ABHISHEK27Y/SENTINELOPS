import { AsyncLocalStorage } from 'node:async_hooks';

import pg from 'pg';

import { getEnv } from '@sentinelops/config';

const { Pool } = pg;

let pool: pg.Pool | null = null;
const transactionContext = new AsyncLocalStorage<pg.PoolClient>();

/** Nested operations share one transaction; retries roll back all DB effects. */
export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  if (transactionContext.getStore()) return work();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await transactionContext.run(client, work);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

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
  return (transactionContext.getStore() ?? getPool()).query<T>(text, params as never);
}
