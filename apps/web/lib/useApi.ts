'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch, WS_URL } from './api';
import { subscribeLiveEvents } from './live-events';
import { useAuth } from './store';

/** Cancels old requests, avoids overlapping polls, and refreshes on live events. */
export function useApi<T>(path: string, refreshMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const token = useAuth(s => s.token);
  const load = useCallback(async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    try {
      const d = await apiFetch<T>(path, { signal: request.signal });
      if (!request.signal.aborted) {
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      }
    } catch (e) {
      if (!request.signal.aborted) setError((e as Error).message);
    } finally {
      if (!request.signal.aborted) setLoading(false);
      if (controller.current === request) controller.current = null;
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    setUpdatedAt(null);
    void load();
    const interval = refreshMs > 0 ? setInterval(() => void load(), refreshMs) : null;
    const stopEvents =
      token && refreshMs > 0 ? subscribeLiveEvents(token, WS_URL, () => void load()) : null;
    return () => {
      if (interval) clearInterval(interval);
      stopEvents?.();
      controller.current?.abort();
      controller.current = null;
    };
  }, [load, refreshMs, token]);
  return { data, error, loading, updatedAt, stale: Boolean(error && data), reload: load };
}
