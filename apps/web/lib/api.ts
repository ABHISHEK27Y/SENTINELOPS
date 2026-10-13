'use client';
import { useAuth } from './store';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
export const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:4000/ws';

function token(): string | null {
  try {
    return localStorage.getItem('so_token') ?? useAuth.getState().token;
  } catch {
    return useAuth.getState().token;
  }
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const t = token();
  const headers = new Headers(opts.headers);
  if (typeof opts.body === 'string' && opts.body.length > 0 && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  if (t && !headers.has('authorization')) headers.set('authorization', `Bearer ${t}`);
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers,
  });
  if (res.status === 401) {
    useAuth.getState().logout();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        (res.status === 401 ? 'invalid credentials' : `Sign-in unavailable (HTTP ${res.status})`)
    );
  }
  return res.json() as Promise<{
    token: string;
    user: { email: string; name: string; role: 'VIEWER' | 'ENGINEER' | 'ADMIN' };
  }>;
}
