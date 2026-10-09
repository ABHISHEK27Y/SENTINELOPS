'use client';

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
export const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:4000/ws';

function token(): string | null {
  try {
    return localStorage.getItem('so_token');
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const t = token();
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) {
    try {
      localStorage.removeItem('so_token');
    } catch {
      /* ignore */
    }
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
  if (!res.ok) throw new Error('invalid credentials');
  return res.json() as Promise<{
    token: string;
    user: { email: string; name: string; role: 'VIEWER' | 'ENGINEER' | 'ADMIN' };
  }>;
}
