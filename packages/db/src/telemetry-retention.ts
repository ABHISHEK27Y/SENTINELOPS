import { query } from './pool.js';

export type RetentionTable = 'metrics' | 'logs';

/** One independently committed batch per call; never prune event deduplication or evidence. */
export async function pruneTelemetryBatch(
  table: RetentionTable,
  hours: number,
  batchSize = 5000
): Promise<number> {
  if (table !== 'metrics' && table !== 'logs') throw new Error('invalid retention table');
  if (!Number.isInteger(hours) || hours < 1 || hours > 87600)
    throw new Error('retention hours must be 1..87600');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000)
    throw new Error('retention batch size must be 1..5000');
  const result = await query(
    `DELETE FROM ${table} WHERE id IN (
       SELECT id FROM ${table} WHERE ts < now() - ($1::int * interval '1 hour')
       ORDER BY ts, id LIMIT $2 FOR UPDATE SKIP LOCKED
     )`,
    [hours, batchSize]
  );
  return result.rowCount ?? 0;
}
