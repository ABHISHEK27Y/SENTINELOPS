import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@sentinelops/db', () => db);
import { consumeLoginAttempt, pruneLoginAttempts } from './login-limiter.js';

beforeEach(() => vi.clearAllMocks());
describe('shared login buckets', () => {
  it('uses the same private key across replicas and a different key for other clients', async () => {
    db.query.mockResolvedValue({ rows: [{ attempts: 1, retry_after: 60 }] });
    await consumeLoginAttempt('192.0.2.1');
    await consumeLoginAttempt('192.0.2.1');
    await consumeLoginAttempt('192.0.2.2');
    expect(db.query.mock.calls[0]?.[1]).toEqual(db.query.mock.calls[1]?.[1]);
    expect(db.query.mock.calls[0]?.[1]).not.toEqual(db.query.mock.calls[2]?.[1]);
    expect(db.query.mock.calls[0]?.[1][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(db.query.mock.calls[0]?.[0]).toContain('ON CONFLICT(key) DO UPDATE');
    expect(db.query.mock.calls[0]?.[0]).toContain('clock_timestamp()');
  });
  it('blocks exhausted buckets and communicates their remaining window', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ attempts: 10, retry_after: 22 }] })
      .mockResolvedValueOnce({ rows: [{ attempts: 11, retry_after: 21 }] });
    expect(await consumeLoginAttempt('client')).toEqual({ allowed: true, retryAfter: 22 });
    expect(await consumeLoginAttempt('client')).toEqual({ allowed: false, retryAfter: 21 });
  });
  it('rejects unavailable storage and bounds expiration cleanup', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(consumeLoginAttempt('client')).rejects.toThrow('bucket');
    await pruneLoginAttempts();
    expect(db.query.mock.calls.at(-1)?.[0]).toContain('LIMIT 1000 FOR UPDATE SKIP LOCKED');
  });
});
