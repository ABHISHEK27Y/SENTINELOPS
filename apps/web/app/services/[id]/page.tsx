'use client';
import { use } from 'react';
import { Shell } from '@/components/Shell';
import { Card, HealthBadge, SeverityBadge } from '@/components/StatusBadge';
import { useApi } from '@/lib/useApi';

interface Detail {
  id: string;
  displayName: string;
  tier: string;
  health: string;
  dependsOn: string[];
  dependedOnBy: string[];
  metrics: { metric: string; value: number; ts: string }[];
  logs: { level: string; message: string; ts: string }[];
  anomalies: {
    metric: string;
    value: number;
    baseline: number;
    anomaly_score: number;
    severity: string;
    created_at: string;
  }[];
}

export default function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useApi<Detail>(`/api/services/${id}`);
  if (error)
    return (
      <Shell>
        <div className="text-critical">{error}</div>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <div className="text-muted">Loading…</div>
      </Shell>
    );

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold">{data.displayName}</h1>
        <HealthBadge health={data.health} />
        <span className="text-muted text-sm">{data.tier}</span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card title="Latest metrics">
          {data.metrics.length === 0 ? (
            <div className="text-muted text-sm">No samples yet.</div>
          ) : (
            <table className="w-full">
              <tbody>
                {data.metrics.map(m => (
                  <tr key={m.metric}>
                    <td className="text-muted">{m.metric}</td>
                    <td className="text-right">{m.value.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Dependencies">
          <div className="text-xs text-muted mb-1">Depends on</div>
          <div className="mb-2">{data.dependsOn.join(', ') || '—'}</div>
          <div className="text-xs text-muted mb-1">Depended on by</div>
          <div>{data.dependedOnBy.join(', ') || '—'}</div>
        </Card>
        <Card title="Recent anomalies">
          {data.anomalies.length === 0 ? (
            <div className="text-muted text-sm">None.</div>
          ) : (
            <div className="space-y-1">
              {data.anomalies.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{a.metric}</span>
                  <span>
                    <SeverityBadge severity={a.severity} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent logs">
        <div className="font-mono text-xs space-y-1 max-h-80 overflow-auto">
          {data.logs.length === 0 ? (
            <div className="text-muted">No logs.</div>
          ) : (
            data.logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.level === 'ERROR'
                    ? 'text-critical'
                    : l.level === 'WARN'
                      ? 'text-warning'
                      : 'text-muted'
                }
              >
                <span className="opacity-60">{new Date(l.ts).toLocaleTimeString()}</span> [{l.level}
                ] {l.message}
              </div>
            ))
          )}
        </div>
      </Card>
    </Shell>
  );
}
