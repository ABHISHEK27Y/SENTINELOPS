import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ query: vi.fn(), hash: vi.fn().mockResolvedValue('test-hash') }));
vi.mock('bcryptjs', () => ({ default: { hash: deps.hash } }));
vi.mock('@sentinelops/db', () => ({
  query: deps.query,
  transaction: async (work: () => Promise<unknown>) => work(),
}));
import { provisionUser } from './provision-user.js';
beforeEach(() => {
  vi.clearAllMocks();
});
describe('operator user provisioning', () => {
  it('rejects unsafe input before hashing or storage', async () => {
    await expect(provisionUser('admin@example.test', 'Admin', 'ADMIN', 'short')).rejects.toThrow(
      '12 characters'
    );
    await expect(provisionUser('invalid', 'Admin', 'ADMIN', 'strong-password-123')).rejects.toThrow(
      'email'
    );
    await expect(
      provisionUser('admin@example.test', 'Admin', 'ROOT' as never, 'strong-password-123')
    ).rejects.toThrow('role');
    expect(deps.query).not.toHaveBeenCalled();
  });
  it('creates a hashed user and audit record in the transaction', async () => {
    deps.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-a' }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await provisionUser('ADMIN@example.test', 'Admin', 'ADMIN', 'strong-password-123')).toBe(
      'user-a'
    );
    expect(deps.query.mock.calls[0]?.[1]).toEqual([
      'admin@example.test',
      'Admin',
      'ADMIN',
      'test-hash',
    ]);
    expect(deps.query.mock.calls[1]?.[0]).toContain('audit_log');
  });
  it('never overwrites an existing operator account', async () => {
    deps.query.mockResolvedValue({ rows: [] });
    await expect(
      provisionUser('admin@example.test', 'Admin', 'ADMIN', 'strong-password-123')
    ).rejects.toThrow('already exists');
    expect(deps.query).toHaveBeenCalledOnce();
    expect(deps.query.mock.calls[0]?.[0]).toContain('DO NOTHING');
  });
});
