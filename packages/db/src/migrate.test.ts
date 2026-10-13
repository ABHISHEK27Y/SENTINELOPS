import { beforeEach, describe, expect, it, vi } from 'vitest';

import { status, up } from './migrate.js';

const pool = vi.hoisted(() => ({ query: vi.fn(), client: { query: vi.fn(), release: vi.fn() } }));
vi.mock('./pool.js', () => ({
  getPool: () => ({ query: pool.query, connect: async () => pool.client }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  pool.client.query.mockResolvedValue({ rows: [] });
});
describe('migration safety', () => {
  it('preflights historical duplicate approval decisions before adding the constraint', async () => {
    pool.client.query.mockImplementation(async (sql: string, args?: string[]) => ({
      rows:
        sql.startsWith('SELECT checksum') && args?.[0] !== '0003_reliable_processing.sql'
          ? [{ checksum: null }]
          : sql.includes('HAVING count(*)>1')
            ? [{ action_id: 'duplicate-action' }]
            : [],
    }));
    await expect(up()).rejects.toThrow('duplicate remediation approvals');
    expect(
      pool.client.query.mock.calls.some(call =>
        String(call[0]).includes('CREATE TABLE event_inbox')
      )
    ).toBe(false);
    expect(pool.client.query.mock.calls.map(call => String(call[0]))).toContain('ROLLBACK');
    expect(pool.client.release).toHaveBeenCalledOnce();
  });
  it('reports pending migrations without creating schema on a fresh database', async () => {
    pool.query.mockResolvedValue({ rows: [{ table_name: null }] });
    const result = await status();
    expect(result.applied).toEqual([]);
    expect(result.pending).toContain('0001_init.sql');
    expect(result.pending).toContain('0007_vector_index.sql');
    expect(pool.query).toHaveBeenCalledOnce();
  });
  it('refuses changed applied migrations and releases its session lock', async () => {
    pool.client.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT checksum') ? [{ checksum: 'wrong-checksum' }] : [],
    }));
    await expect(up()).rejects.toThrow('applied migration changed');
    const sql = pool.client.query.mock.calls.map(call => String(call[0]));
    expect(sql[0]).toContain('pg_advisory_lock');
    expect(sql.at(-1)).toContain('pg_advisory_unlock');
    expect(sql).not.toContain('BEGIN');
    expect(pool.client.release).toHaveBeenCalledOnce();
  });
  it('rolls back an unsuccessful migration instead of recording it applied', async () => {
    pool.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CREATE EXTENSION')) throw new Error('extension unavailable');
      return { rows: [] };
    });
    await expect(up()).rejects.toThrow('extension unavailable');
    const sql = pool.client.query.mock.calls.map(call => String(call[0]));
    expect(sql).toContain('BEGIN');
    expect(sql).toContain('ROLLBACK');
    expect(sql.some(statement => statement.startsWith('INSERT INTO schema_migrations'))).toBe(
      false
    );
    expect(pool.client.release).toHaveBeenCalledOnce();
  });
});
