import { describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn().mockResolvedValue({ rowCount: 3 }));
vi.mock('./pool.js', () => ({
  query,
  transaction: async (work: () => Promise<unknown>) => work(),
}));
import { pruneTelemetry } from './retention.js';
describe('bounded operator retention', () => {
  it('keeps deduplication longer than default broker retention and rejects unbounded work', async () => {
    await expect(pruneTelemetry(7)).rejects.toThrow('eight days');
    await expect(pruneTelemetry(30, 10001)).rejects.toThrow('batch size');
    expect(query).not.toHaveBeenCalled();
  });
  it('preserves pending events, incidents and audit evidence', async () => {
    const result = await pruneTelemetry();
    expect(result).toEqual({ metrics: 3, logs: 3, event_inbox: 3, event_outbox: 3 });
    const sql = query.mock.calls.map(call => String(call[0])).join('\n');
    expect(sql).toContain('published_at IS NOT NULL');
    expect(sql).toContain('LIMIT $2 FOR UPDATE SKIP LOCKED');
    expect(sql).not.toContain('DELETE FROM incidents');
    expect(sql).not.toContain('DELETE FROM audit_log');
  });
});
