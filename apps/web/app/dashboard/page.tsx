'use client';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Card, HealthBadge, SeverityBadge, StatusBadge } from '@/components/StatusBadge';
import { useApi } from '@/lib/useApi';

interface Service {
  id: string;
  displayName: string;
  tier: string;
  health: string;
  activeIncidents: number;
}
interface Incident {
  id: string;
  title: string;
  status: string;
  severity: string;
  affected_services: string[];
  detected_at: string;
}

export default function DashboardPage() {
  const services = useApi<Service[]>('/api/services');
  const incidents = useApi<Incident[]>('/api/incidents');

  const svc = services.data ?? [];
  const inc = incidents.data ?? [];
  const active = inc.filter(i => !['RESOLVED', 'POSTMORTEM'].includes(i.status));
  const healthy = svc.filter(s => s.health === 'HEALTHY').length;
  const degraded = svc.filter(s => s.health === 'DEGRADED').length;
  const unhealthy = svc.filter(s => s.health === 'UNHEALTHY').length;

  return (
    <Shell>
      <h1 className="text-xl font-semibold mb-1">System Overview</h1>
      <p className="text-muted text-sm mb-6">Live health across the monitored fleet.</p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="label">Services healthy</div>
          <div className="stat text-healthy">
            {healthy}/{svc.length}
          </div>
        </Card>
        <Card>
          <div className="label">Degraded</div>
          <div className="stat text-warning">{degraded}</div>
        </Card>
        <Card>
          <div className="label">Unhealthy</div>
          <div className="stat text-critical">{unhealthy}</div>
        </Card>
        <Card>
          <div className="label">Active incidents</div>
          <div className="stat">{active.length}</div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card
            title="Active incidents"
            right={
              <Link href="/incidents" className="text-accent text-xs">
                View all →
              </Link>
            }
          >
            {active.length === 0 ? (
              <div className="text-muted text-sm py-6 text-center">
                No active incidents. System nominal.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Title</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map(i => (
                    <tr key={i.id} className="hover:bg-panel2">
                      <td>
                        <Link className="text-accent" href={`/incidents/${i.id}`}>
                          {i.id}
                        </Link>
                      </td>
                      <td>
                        <SeverityBadge severity={i.severity} />
                      </td>
                      <td>
                        <StatusBadge status={i.status} />
                      </td>
                      <td className="text-muted">{i.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <Card title="Services">
          <div className="space-y-2">
            {svc.map(s => (
              <Link
                key={s.id}
                href={`/services/${s.id}`}
                className="flex items-center justify-between text-sm hover:bg-panel2 px-2 py-1 rounded"
              >
                <span className="text-text">{s.displayName}</span>
                <HealthBadge health={s.health} />
              </Link>
            ))}
            {svc.length === 0 && (
              <div className="text-muted text-sm">{services.error ?? 'Loading…'}</div>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
