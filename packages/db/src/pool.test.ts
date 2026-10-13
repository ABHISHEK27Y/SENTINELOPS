import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  client: { query: vi.fn(), release: vi.fn() },
  poolQuery: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  default: {
    Pool: function () {
      return { connect: async () => fake.client, query: fake.poolQuery, end: fake.end };
    },
  },
}));
vi.mock('@sentinelops/config', () => ({ getEnv: () => ({ DATABASE_URL: 'postgres://test' }) }));
import { closePool, query, transaction } from './pool.js';

beforeEach(async () => {
  await closePool();
  vi.clearAllMocks();
  fake.client.query.mockResolvedValue({ rows: [] });
});
describe('database transaction isolation', () => {
  it('routes nested effects through one client and commits once', async () => {
    await transaction(async () => {
      await query('first');
      await transaction(async () => {
        await query('second');
      });
    });
    expect(fake.client.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN',
      'first',
      'second',
      'COMMIT',
    ]);
    expect(fake.client.release).toHaveBeenCalledOnce();
    expect(fake.poolQuery).not.toHaveBeenCalled();
    await query('outside');
    expect(fake.poolQuery).toHaveBeenCalledWith('outside', undefined);
  });
  it('rolls back and releases the client when any effect fails', async () => {
    await expect(
      transaction(async () => {
        await query('partial');
        throw new Error('failure');
      })
    ).rejects.toThrow('failure');
    expect(fake.client.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN',
      'partial',
      'ROLLBACK',
    ]);
    expect(fake.client.release).toHaveBeenCalledOnce();
  });
});
