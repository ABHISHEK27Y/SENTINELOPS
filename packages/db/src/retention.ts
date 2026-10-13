import { query, transaction } from './pool.js';

/** Explicit operator maintenance; bounded batches, never delete pending events
 * or incident/audit/action evidence. Inbox retention exceeds default Kafka 7d. */
export async function pruneTelemetry(days = 30, batchSize = 5000): Promise<Record<string, number>> {
  if (!Number.isInteger(days) || days < 8)
    throw new Error('retention must be at least eight days and exceed broker retention');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000)
    throw new Error('batch size must be 1..10000');
  return transaction(async () => {
    const counts: Record<string, number> = {};
    for (const [table, time, condition] of [
      ['metrics', 'ts', ''],
      ['logs', 'ts', ''],
      ['event_inbox', 'processed_at', ''],
      ['event_outbox', 'published_at', 'AND published_at IS NOT NULL'],
    ]) {
      const result = await query(
        `DELETE FROM ${table} WHERE ctid IN (
        SELECT ctid FROM ${table} WHERE ${time}<now()-($1::int * interval '1 day') ${condition}
        ORDER BY ${time} LIMIT $2 FOR UPDATE SKIP LOCKED)`,
        [days, batchSize]
      );
      counts[table!] = result.rowCount ?? 0;
    }
    return counts;
  });
}
