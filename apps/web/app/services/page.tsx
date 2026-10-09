'use client';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Card, HealthBadge } from '@/components/StatusBadge';
import { useApi } from '@/lib/useApi';

interface Service {
  id: string;
  displayName: string;
  tier: string;
  health: string;
  activeIncidents: number;
}

export default function ServicesPage() {
  const { data, error } = useApi<Service[]>('/api/services');
  const services = data ?? [];
  return (
    <Shell>
      <h1 className="text-xl font-semibold mb-4">Services</h1>
      <Card>
        <table className="w-full">
          <thead>
            <tr>
              <th>Service</th>
              <th>Tier</th>
              <th>Health</th>
              <th>Active incidents</th>
            </tr>
          </thead>
          <tbody>
            {services.map(s => (
              <tr key={s.id} className="hover:bg-panel2">
                <td>
                  <Link className="text-accent" href={`/services/${s.id}`}>
                    {s.displayName}
                  </Link>
                </td>
                <td className="text-muted">{s.tier}</td>
                <td>
                  <HealthBadge health={s.health} />
                </td>
                <td>{s.activeIncidents}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {services.length === 0 && (
          <div className="text-muted text-sm py-4">{error ?? 'Loading…'}</div>
        )}
      </Card>
    </Shell>
  );
}
