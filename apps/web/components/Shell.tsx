'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/store';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: '▤' },
  { href: '/services', label: 'Services', icon: '▦' },
  { href: '/incidents', label: 'Incidents', icon: '⚠' },
  { href: '/architecture', label: 'Architecture', icon: '⬡' },
  { href: '/failures', label: 'Failure Console', icon: '☢' },
  { href: '/runbooks', label: 'Runbooks', icon: '📘' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { token, user, hydrate, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    // After hydration, redirect to login if unauthenticated.
    const id = setTimeout(() => {
      if (!useAuth.getState().token) router.replace('/login');
    }, 50);
    return () => clearTimeout(id);
  }, [router]);

  if (!token) {
    return <div className="min-h-screen grid place-items-center text-muted">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-border bg-panel flex flex-col">
        <div className="px-4 py-4 border-b border-border">
          <div className="text-text font-semibold tracking-tight">SentinelOps</div>
          <div className="text-[10px] text-muted uppercase tracking-widest">SRE Console</div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map(n => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2 px-4 py-2 text-sm ${
                  active
                    ? 'bg-panel2 text-text border-l-2 border-accent'
                    : 'text-muted hover:text-text'
                }`}
              >
                <span aria-hidden className="w-4 text-center">
                  {n.icon}
                </span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-border text-xs">
          <div className="text-text">{user?.name}</div>
          <div className="text-muted">{user?.role}</div>
          <button
            className="btn mt-2 w-full"
            onClick={() => {
              logout();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6 overflow-auto">{children}</main>
    </div>
  );
}
