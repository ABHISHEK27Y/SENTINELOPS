'use client';
import { create } from 'zustand';

interface AuthUser {
  email: string;
  name: string;
  role: 'VIEWER' | 'ENGINEER' | 'ADMIN';
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  hydrated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  hydrate: () => void;
}

export const useAuth = create<AuthState>(set => ({
  token: null,
  user: null,
  hydrated: false,
  setAuth: (token, user) => {
    try {
      localStorage.setItem('so_token', token);
      localStorage.setItem('so_user', JSON.stringify(user));
    } catch {
      /* ignore */
    }
    set({ token, user, hydrated: true });
  },
  logout: () => {
    try {
      localStorage.removeItem('so_token');
      localStorage.removeItem('so_user');
    } catch {
      /* ignore */
    }
    set({ token: null, user: null, hydrated: true });
  },
  hydrate: () => {
    try {
      const token = localStorage.getItem('so_token');
      const userRaw = localStorage.getItem('so_user');
      if (token && userRaw) set({ token, user: JSON.parse(userRaw) as AuthUser });
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },
}));

export function canApprove(user: AuthUser | null): boolean {
  return user?.role === 'ENGINEER' || user?.role === 'ADMIN';
}
