'use client';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Card, SeverityBadge, StatusBadge } from '@/components/StatusBadge';
import { useApi } from '@/lib/useApi';

interface Incident {
  id: string; title: string; status: string; severity: string;
  affected_services: string[]; confidence: number | null; detected_at: string;
}

export default function IncidentsPage() {
  const { data, error } = useApi<Incident[]>('/api/incidents');
  const incidents = data ?? [];
  return (
    <Shell>
      <h1 className="text-xl font-semibold mb-4">Incidents</h1>
      <Card>
        <table className="w-full">
          <thead><tr><th>ID</th><th>Severity</th><th>Status</th><th>Title</th><th>Services</th><th>Confidence</th><th>Detected</th></tr></thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={i.id} className="hover:bg-panel2">
                <td><Link className="text-accent" href={`/incidents/${i.id}`}>{i.id}</Link></td>
                <td><SeverityBadge severity={i.severity} /></td>
                <td><StatusBadge status={i.status} /></td>
                <td className="text-muted">{i.title}</td>
                <td className="text-xs text-muted">{i.affected_services.join(', ')}</td>
                <td>{i.confidence != null ? `${Math.round(i.confidence * 100)}%` : '—'}</td>
                <td className="text-xs text-muted">{new Date(i.detected_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {incidents.length === 0 && <div className="text-muted text-sm py-6 text-center">{error ?? 'No incidents yet — inject a failure to generate one.'}</div>}
      </Card>
    </Shell>
  );
}
