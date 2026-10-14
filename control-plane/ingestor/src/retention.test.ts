import { afterEach, describe, expect, it, vi } from 'vitest';

const prune = vi.hoisted(() => vi.fn());
vi.mock('@sentinelops/db', () => ({ pruneTelemetryBatch: prune }));
import { startRetention } from './retention.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  prune.mockReset();
});
function setup() {
  vi.useFakeTimers();
  const onDeleted = vi.fn();
  const onError = vi.fn();
  const interval = vi.spyOn(globalThis, 'setInterval');
  const stop = startRetention({
    metricsHours: 48,
    logsHours: 72,
    intervalMs: 600000,
    onDeleted,
    onError,
  });
  expect(interval.mock.results[0]!.value.hasRef()).toBe(false);
  return { stop, onDeleted, onError };
}
describe('ingestor retention lifecycle', () => {
  it('drains independent bounded batches and reports per-table counts', async () => {
    prune.mockResolvedValueOnce(5000).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const { stop, onDeleted } = setup();
    await vi.advanceTimersByTimeAsync(600000);
    expect(prune.mock.calls).toEqual([
      ['metrics', 48],
      ['metrics', 48],
      ['logs', 72],
    ]);
    expect(onDeleted.mock.calls).toEqual([
      ['metrics', 5000],
      ['metrics', 3],
      ['logs', 2],
    ]);
    await stop();
    await vi.advanceTimersByTimeAsync(1200000);
    expect(prune).toHaveBeenCalledTimes(3);
  });
  it('never overlaps ticks and waits for the active batch before shutdown', async () => {
    let resolve!: (n: number) => void;
    prune.mockReturnValue(
      new Promise<number>(r => {
        resolve = r;
      })
    );
    const { stop, onDeleted } = setup();
    await vi.advanceTimersByTimeAsync(1800000);
    expect(prune).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolve(5000);
    await stopping;
    expect(onDeleted).toHaveBeenCalledWith('metrics', 5000);
    expect(prune).toHaveBeenCalledOnce();
  });
  it('reports a failed batch and retries on the next interval', async () => {
    const error = new Error('database unavailable');
    prune.mockRejectedValueOnce(error).mockResolvedValue(0);
    const { stop, onError } = setup();
    await vi.advanceTimersByTimeAsync(600000);
    expect(onError).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(600000);
    expect(prune).toHaveBeenCalledTimes(3);
    await stop();
  });
});
