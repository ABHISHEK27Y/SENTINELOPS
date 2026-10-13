import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeLiveEvents } from './live-events';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(
    readonly url: string,
    readonly protocols: string[]
  ) {
    FakeSocket.instances.push(this);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('live event reconnection', () => {
  it('refreshes on open and events and cancels retries on unmount', () => {
    const refresh = vi.fn();
    const stop = subscribeLiveEvents('token', 'ws://localhost/ws', refresh);
    const first = FakeSocket.instances[0]!;
    expect(first.protocols).toEqual(['sentinelops', 'token']);
    first.onopen?.();
    first.onmessage?.();
    expect(refresh).toHaveBeenCalledTimes(2);
    first.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]!.onclose?.({ code: 1006 });
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]!.close).toHaveBeenCalledOnce();
  });
  it('backs off repeated failures and resets the delay after reconnecting', () => {
    const stop = subscribeLiveEvents('token', 'ws://localhost/ws', vi.fn());
    FakeSocket.instances[0]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    FakeSocket.instances[1]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    FakeSocket.instances[2]!.onopen?.();
    FakeSocket.instances[2]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(4);
    stop();
  });
  it('does not reconnect with an expired or rejected token', () => {
    const stop = subscribeLiveEvents('expired', 'ws://localhost/ws', vi.fn());
    FakeSocket.instances[0]!.onclose?.({ code: 1008 });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    stop();
  });
  it('recovers constructor failures without throwing into the page', () => {
    vi.stubGlobal(
      'WebSocket',
      vi.fn().mockImplementation(() => {
        throw new Error('offline');
      })
    );
    const stop = subscribeLiveEvents('token', 'ws://localhost/ws', vi.fn());
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(1);
    stop();
  });
});
