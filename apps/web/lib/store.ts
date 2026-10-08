'use client';
import { create } from 'zustand';

export interface AuthUser {
  email: string;
  name: string;
  role: 'VIEWER' | 'ENGINEER' | 'ADMIN';
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  hydrate: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: null,
  user: null,
  setAuth: (token, user) => {
    try {
      localStorage.setItem('so_token', token);
      localStorage.setItem('so_user', JSON.stringify(user));
    } catch {
      /* ignore */
    }
    set({ token, user });
  },
  logout: () => {
    try {
      localStorage.removeItem('so_token');
      localStorage.removeItem('so_user');
    } catch {
      /* ignore */
    }
    set({ token: null, user: null });
  },
  hydrate: () => {
    try {
      const token = localStorage.getItem('so_token');
      const userRaw = localStorage.getItem('so_user');
      if (token && userRaw) set({ token, user: JSON.parse(userRaw) as AuthUser });
    } catch {
      /* ignore */
    }
  },
}));

export function canApprove(user: AuthUser | null): boolean {
  return user?.role === 'ENGINEER' || user?.role === 'ADMIN';
}
