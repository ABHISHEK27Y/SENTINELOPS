'use client';
import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card } from '@/components/StatusBadge';
import { useApi } from '@/lib/useApi';
import { apiFetch } from '@/lib/api';
import { useAuth, canApprove } from '@/lib/store';

const FAULTS = [
  {
    label: 'Increase DB Latency',
    type: 'db_latency',
    service: 'payment-service',
    params: { targetMs: 2500 },
    desc: 'payment-service DB queries 30ms → 2.5s',
  },
  {
    label: 'Inject 500 Errors',
    type: 'error_injection',
    service: 'payment-service',
    params: { probability: 0.8 },
    desc: '80% of charges return HTTP 500',
  },
  {
    label: 'Kill Payment Service',
    type: 'kill',
    service: 'payment-service',
    params: {},
    desc: 'payment-service reports UNHEALTHY',
  },
  {
    label: 'Break Redis',
    type: 'break_redis',
    service: 'notification-service',
    params: {},
    desc: 'notification queue backs up',
  },
  {
    label: 'CPU Stress',
    type: 'cpu_stress',
    service: 'order-service',
    params: {},
    desc: 'order-service CPU saturation',
  },
  {
    label: 'Memory Leak',
    type: 'memory_leak',
    service: 'order-service',
    params: {},
    desc: 'order-service RSS grows ~2MB/s',
  },
  {
    label: 'Kafka Consumer Lag',
    type: 'kafka_lag',
    service: 'payment-service',
    params: { targetMs: 1500 },
    desc: 'queue depth rises',
  },
];

interface FaultState {
  service: string;
  faults: { type: string; params: unknown }[];
  unreachable?: boolean;
}

export default function FailuresPage() {
  const { data, reload } = useApi<FaultState[]>('/api/failures', 3000);
  const user = useAuth(s => s.user);
  const engineer = canApprove(user);
  const [busy, setBusy] = useState('');

  async function inject(f: (typeof FAULTS)[number]) {
    setBusy(f.type);
    try {
      await apiFetch(`/api/failures/${f.type.replace(/_/g, '-')}`, {
        method: 'POST',
        body: JSON.stringify({ service: f.service, params: f.params }),
      });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function clearAll(service: string) {
    setBusy(`clear-${service}`);
    try {
      await apiFetch(`/api/failures/${service}`, { method: 'DELETE' });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const active = (data ?? []).filter(s => s.faults.length > 0);

  return (
    <Shell>
      <h1 className="text-xl font-semibold mb-1">Failure Injection Console</h1>
      <p className="text-muted text-sm mb-4">
        Inject real faults to exercise the detection → correlation → remediation loop.
        {!engineer && <span className="text-warning"> Requires ENGINEER/ADMIN.</span>}
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {FAULTS.map(f => (
          <Card key={f.type}>
            <div className="text-text text-sm font-medium">{f.label}</div>
            <div className="text-xs text-muted mb-3">{f.desc}</div>
            <button
              className="btn btn-danger w-full"
              disabled={!engineer || !!busy}
              onClick={() => inject(f)}
            >
              {busy === f.type ? 'Injecting…' : 'Inject'}
            </button>
          </Card>
        ))}
      </div>

      <Card title="Active faults">
        {active.length === 0 ? (
          <div className="text-muted text-sm">No active faults. System is running clean.</div>
        ) : (
          <div className="space-y-2">
            {active.map(s => (
              <div
                key={s.service}
                className="flex items-center justify-between border border-border rounded px-3 py-2"
              >
                <div>
                  <span className="text-text text-sm">{s.service}</span>
                  <span className="text-xs text-muted ml-2">
                    {s.faults.map(x => x.type).join(', ')}
                  </span>
                </div>
                {engineer && (
                  <button className="btn" disabled={!!busy} onClick={() => clearAll(s.service)}>
                    Clear
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
