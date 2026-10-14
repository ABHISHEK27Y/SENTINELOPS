import { pruneTelemetryBatch, type RetentionTable } from '@sentinelops/db';

/** Single flight per process; SKIP LOCKED also permits multiple ingestor replicas. */
export function startRetention(options: {
  metricsHours: number;
  logsHours: number;
  intervalMs: number;
  onDeleted: (table: RetentionTable, count: number) => void;
  onError: (error: unknown) => void;
}): () => Promise<void> {
  let pruning: Promise<void> | null = null;
  let stopped = false;
  const prune = async () => {
    // Each query commits independently; shutdown stops between batches.
    for (const [table, hours] of [
      ['metrics', options.metricsHours],
      ['logs', options.logsHours],
    ] as const) {
      let count: number;
      do {
        if (stopped) return;
        count = await pruneTelemetryBatch(table, hours);
        options.onDeleted(table, count);
      } while (count === 5000);
    }
  };
  const timer = setInterval(() => {
    if (stopped || pruning) return;
    pruning = prune()
      .catch(options.onError)
      .finally(() => {
        pruning = null;
      });
  }, options.intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pruning;
  };
}
