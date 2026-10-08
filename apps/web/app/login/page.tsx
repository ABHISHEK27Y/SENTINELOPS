'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { useAuth } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState('engineer@sentinelops.dev');
  const [password, setPassword] = useState('engineer123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token, user } = await login(email, password);
      setAuth(token, user);
      router.replace('/dashboard');
    } catch {
      setError('Invalid credentials');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center">
      <form onSubmit={submit} className="card w-[360px] space-y-4">
        <div>
          <div className="text-text text-lg font-semibold">SentinelOps</div>
          <div className="text-xs text-muted uppercase tracking-widest">SRE Console — Sign in</div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="w-full mt-1 bg-panel2 border border-border rounded px-3 py-2 text-sm"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input type="password" className="w-full mt-1 bg-panel2 border border-border rounded px-3 py-2 text-sm"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="text-critical text-sm">{error}</div>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="text-[11px] text-muted leading-relaxed">
          Dev accounts: admin/engineer/viewer @sentinelops.dev · pw &lt;role&gt;123
        </div>
      </form>
    </div>
  );
}
