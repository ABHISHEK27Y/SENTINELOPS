import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ DEMO_MODE: true, INTERNAL_API_TOKEN: 'test-internal-token' }));
vi.mock('@sentinelops/config', () => ({ getEnv: () => env }));
import { FaultType } from '@sentinelops/shared-types';

import { FaultApiExecutor } from './executor.js';
import type { ProposedAction } from './recommend.js';

const action: ProposedAction = {
  type: 'clear_injected_fault',
  targetService: 'payment-service',
  risk: 'LOW',
  rationale: 'clear approved fault',
  requiresApproval: true,
  params: { faultType: FaultType.DB_LATENCY },
};
beforeEach(() => {
  env.DEMO_MODE = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('scoped demo executor', () => {
  it('sends only the selected fault with internal authentication and a timeout', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    const result = await new FaultApiExecutor(() => 'http://payment:3001').execute(action);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`http://payment:3001/admin/faults/${FaultType.DB_LATENCY}`, {
      method: 'DELETE',
      headers: { 'x-internal-token': env.INTERNAL_API_TOKEN },
      signal: expect.any(AbortSignal),
    });
  });
  it('does not contact services for production or unsupported infrastructure actions', async () => {
    const base = vi.fn(() => 'http://payment:3001');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const executor = new FaultApiExecutor(base);
    env.DEMO_MODE = false;
    expect((await executor.execute(action)).ok).toBe(false);
    env.DEMO_MODE = true;
    expect((await executor.execute({ ...action, type: 'restart_service' })).ok).toBe(false);
    expect(base).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects missing and arbitrary fault paths before making a request', async () => {
    const base = vi.fn(() => 'http://payment:3001');
    const executor = new FaultApiExecutor(base);
    for (const params of [{}, { faultType: '../all' }]) {
      expect((await executor.execute({ ...action, params })).ok).toBe(false);
    }
    expect(base).not.toHaveBeenCalled();
  });
  it('records HTTP and transport failures without claiming successful execution', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(new Error('timed out'));
    vi.stubGlobal('fetch', fetch);
    const executor = new FaultApiExecutor(() => 'http://payment:3001');
    expect(await executor.execute(action)).toEqual({
      ok: false,
      detail: 'HTTP 503 clearing faults',
    });
    expect(await executor.execute(action)).toEqual({ ok: false, detail: 'timed out' });
  });
  it('records unknown target lookup failures rather than escaping the worker', async () => {
    const executor = new FaultApiExecutor(() => {
      throw new Error('unknown service');
    });
    expect(await executor.execute(action)).toEqual({ ok: false, detail: 'unknown service' });
  });
});
