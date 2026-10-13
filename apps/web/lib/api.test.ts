import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, login } from './api';
import { canApprove, useAuth } from './store';

const storage = new Map<string, string>();
const user = { email: 'engineer@example.test', name: 'Engineer', role: 'ENGINEER' as const };
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAuth.setState({ token: null, user: null, hydrated: false });
});
afterEach(() => vi.unstubAllGlobals());
describe('browser auth storage and API requests', () => {
  it('omits JSON content type on bodyless deletes and preserves multipart boundaries', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    await apiFetch('/api/failures/payment-service?type=db_latency', { method: 'DELETE' });
    expect((fetch.mock.calls[0][1].headers as Headers).has('content-type')).toBe(false);
    await apiFetch('/api/example', { method: 'POST', body: '{}' });
    expect((fetch.mock.calls[1][1].headers as Headers).get('content-type')).toBe(
      'application/json'
    );
    await apiFetch('/api/example', { method: 'POST', body: new FormData() });
    expect((fetch.mock.calls[2][1].headers as Headers).has('content-type')).toBe(false);
  });
  it('persists, hydrates and clears the session with read-only viewer permissions', () => {
    useAuth.getState().setAuth('session-token', user);
    expect(storage.get('so_token')).toBe('session-token');
    useAuth.setState({ token: null, user: null, hydrated: false });
    useAuth.getState().hydrate();
    expect(useAuth.getState()).toMatchObject({ token: 'session-token', user, hydrated: true });
    expect(canApprove(user)).toBe(true);
    expect(canApprove({ ...user, role: 'VIEWER' })).toBe(false);
    expect(canApprove(null)).toBe(false);
    useAuth.getState().logout();
    expect(storage.size).toBe(0);
    expect(useAuth.getState().token).toBeNull();
  });
  it('preserves native headers and uses the active in-memory session when storage is unavailable', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    useAuth.getState().setAuth('memory-token', user);
    expect(
      await apiFetch('/api/services', { headers: new Headers({ 'x-request-id': 'request-a' }) })
    ).toEqual({ ok: true });
    const headers = fetch.mock.calls[0]?.[1].headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer memory-token');
    expect(headers.get('x-request-id')).toBe('request-a');
  });
  it('logs out on 401 and surfaces other HTTP errors without destroying the session', async () => {
    useAuth.getState().setAuth('session-token', user);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'database offline' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetch);
    await expect(apiFetch('/api/services')).rejects.toThrow('database offline');
    expect(useAuth.getState().token).toBe('session-token');
    await expect(apiFetch('/api/services')).rejects.toThrow('unauthorized');
    expect(useAuth.getState().token).toBeNull();
    expect(storage.size).toBe(0);
  });
  it('handles malformed error bodies and communicates login throttling accurately', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('invalid json');
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'too many login attempts' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'session-token', user }) });
    vi.stubGlobal('fetch', fetch);
    await expect(apiFetch('/api/services')).rejects.toThrow('HTTP 502');
    await expect(login(user.email, 'wrong')).rejects.toThrow('too many login attempts');
    expect(await login(user.email, 'test-password')).toEqual({ token: 'session-token', user });
  });
});
