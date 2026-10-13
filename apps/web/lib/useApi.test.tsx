// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({
  fetch: vi.fn(),
  subscribe: vi.fn(),
  stop: vi.fn(),
  token: 'token',
}));
vi.mock('./api', () => ({ apiFetch: network.fetch, WS_URL: 'ws://test/events' }));
vi.mock('./live-events', () => ({ subscribeLiveEvents: network.subscribe }));
vi.mock('./store', () => ({
  useAuth: (select: (state: { token: string }) => unknown) => select({ token: network.token }),
}));
import { useApi } from './useApi';

beforeEach(() => {
  vi.clearAllMocks();
  network.token = 'token';
  network.subscribe.mockReturnValue(network.stop);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('live dashboard polling', () => {
  it('retains stale data on failure and clears the error after successful reload', async () => {
    network.fetch
      .mockResolvedValueOnce({ status: 'healthy' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'recovered' });
    const { result } = renderHook(() => useApi<{ status: string }>('/api/services', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ status: 'healthy' });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toBe('offline');
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toEqual({ status: 'recovered' });
    expect(result.current.error).toBeNull();
    expect(result.current.updatedAt).not.toBeNull();
  });

  it('cancels the previous path and ignores its delayed response', async () => {
    let resolveOld!: (value: object) => void;
    network.fetch
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce({ id: 'new' });
    const { result, rerender, unmount } = renderHook(
      ({ path }) => useApi<{ id: string }>(path, 1000),
      { initialProps: { path: '/old' } }
    );
    const oldSignal = network.fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    rerender({ path: '/new' });
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ id: 'new' }));
    await act(async () => {
      resolveOld({ id: 'old' });
    });
    expect(result.current.data).toEqual({ id: 'new' });
    unmount();
    expect(network.stop).toHaveBeenCalledTimes(2);
  });

  it('prevents overlapping polling and event refresh, then aborts on unmount', async () => {
    vi.useFakeTimers();
    let finish!: (value: object) => void;
    network.fetch.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result, unmount } = renderHook(() => useApi('/live', 1000));
    const signal = network.fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await result.current.reload();
      network.subscribe.mock.calls[0]?.[2]();
    });
    expect(network.fetch).toHaveBeenCalledOnce();
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ ignored: true });
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(network.fetch).toHaveBeenCalledOnce();
    expect(network.stop).toHaveBeenCalledOnce();
  });

  it('reports initial request failure without creating an authenticated socket', async () => {
    network.token = '';
    network.fetch.mockRejectedValue(new Error('not authenticated'));
    const { result } = renderHook(() => useApi('/private', 1000));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not authenticated');
    expect(result.current.stale).toBe(false);
    expect(network.subscribe).not.toHaveBeenCalled();
  });
});
