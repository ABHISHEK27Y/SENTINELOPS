import { afterEach, describe, expect, it, vi } from 'vitest';

import { FaultType } from '@sentinelops/shared-types';

import { FaultController } from './faults.js';

afterEach(() => vi.useRealTimers());
describe('fault expiry and scope', () => {
  it('expires resource stressors without requiring another request', () => {
    vi.useFakeTimers();
    const faults = new FaultController();
    faults.enable(FaultType.MEMORY_LEAK, { ttlMs: 100 });
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(100);
    expect(faults.list()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears only the requested fault and replaces its expiry timer', () => {
    vi.useFakeTimers();
    const faults = new FaultController();
    faults.enable(FaultType.DB_LATENCY, { ttlMs: 100, targetMs: 1000 });
    faults.enable(FaultType.BREAK_REDIS);
    faults.enable(FaultType.DB_LATENCY, { ttlMs: 200, targetMs: 2000 });
    vi.advanceTimersByTime(100);
    expect(faults.dbLatencyMs()).toBe(2000);
    faults.disable(FaultType.DB_LATENCY);
    expect(faults.dbLatencyMs()).toBe(0);
    expect(faults.redisBroken()).toBe(true);
    faults.clear();
    expect(vi.getTimerCount()).toBe(0);
  });
});
