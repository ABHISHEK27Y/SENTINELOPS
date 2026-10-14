import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('./pool.js', () => ({ query }));
import { pruneTelemetryBatch, type RetentionTable } from './telemetry-retention.js';

beforeEach(() => vi.clearAllMocks());
describe('raw telemetry retention batches', () => {
  it.each(['metrics', 'logs'] as const)(
    'bounds and locks each %s batch while preserving newer rows',
    async table => {
      query.mockResolvedValueOnce({ rowCount: 5000 });
      expect(await pruneTelemetryBatch(table, 48)).toBe(5000);
      expect(query).toHaveBeenCalledOnce();
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(`DELETE FROM ${table} WHERE id IN`),
        [48, 5000]
      );
      const sql = query.mock.calls[0]![0];
      expect(sql).toContain("ts < now() - ($1::int * interval '1 hour')");
      expect(sql).toContain('ORDER BY ts, id LIMIT $2 FOR UPDATE SKIP LOCKED');
      expect(sql).not.toMatch(/event_inbox|event_outbox|audit_log|incidents/);
      query.mockResolvedValueOnce({ rowCount: null });
      expect(await pruneTelemetryBatch(table, 72, 1)).toBe(0);
    }
  );
  it('rejects unbounded sizes, invalid horizons and non-telemetry tables', async () => {
    for (const size of [0, -1, 5001, 1.5, NaN])
      await expect(pruneTelemetryBatch('metrics', 48, size)).rejects.toThrow('batch');
    for (const hours of [0, -1, 1.5, Infinity, 87601])
      await expect(pruneTelemetryBatch('logs', hours)).rejects.toThrow('hours');
    await expect(pruneTelemetryBatch('audit_log' as RetentionTable, 48)).rejects.toThrow('table');
    expect(query).not.toHaveBeenCalled();
  });
});
