'use client';
import { use, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, SeverityBadge, StatusBadge } from '@/components/StatusBadge';
import { useApi } from '@/lib/useApi';
import { apiFetch } from '@/lib/api';
import { useAuth, canApprove } from '@/lib/store';

interface Investigation {
  summary: string;
  probableRootCause: string;
  whatChanged: string;
  confidence: number;
  evidence: string[];
  alternativeHypotheses: string[];
  recommendedActions: { action: string; risk: string; reason: string }[];
  runbookReferences: string[];
}
interface Remediation {
  id: string;
  type: string;
  target_service: string;
  risk: string;
  status: string;
  rationale: string;
  requires_approval: boolean;
}
interface IncidentDetail {
  id: string;
  title: string;
  status: string;
  severity: string;
  affected_services: string[];
  confidence: number | null;
  started_at: string;
  root_cause: { title?: string } | null;
  timeline: { at: string; kind: string; message: string; data: unknown }[];
  anomalies: {
    service_id: string;
    metric: string;
    value: number;
    baseline: number;
    anomaly_score: number;
    severity: string;
  }[];
  remediation: Remediation[];
  postmortem: { content_md: string } | null;
}

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, reload } = useApi<IncidentDetail>(`/api/incidents/${id}`, 4000);
  const user = useAuth(s => s.user);
  const [busy, setBusy] = useState('');

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (!data)
    return (
      <Shell>
        <div className="text-muted">Loading…</div>
      </Shell>
    );

  const investigation = [...data.timeline].reverse().find(t => t.kind === 'ai_investigation')
    ?.data as Investigation | undefined;
  const engineer = canApprove(user);

  return (
    <Shell>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-semibold">{data.id}</h1>
        <SeverityBadge severity={data.severity} />
        <StatusBadge status={data.status} />
      </div>
      <p className="text-muted text-sm mb-4">
        {data.title} · affected: {data.affected_services.join(', ')}
      </p>

      <div className="flex gap-2 mb-6">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            act('investigate', () =>
              apiFetch(`/api/incidents/${id}/investigate`, { method: 'POST', body: '{}' })
            )
          }
        >
          {busy === 'investigate' ? 'Investigating…' : 'Run AI investigation'}
        </button>
        {engineer && (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              act('remediate', () =>
                apiFetch(`/api/incidents/${id}/remediate`, { method: 'POST', body: '{}' })
              )
            }
          >
            Propose remediation
          </button>
        )}
        {data.status === 'RESOLVED' && (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              act('pm', () =>
                apiFetch(`/api/incidents/${id}/postmortem`, { method: 'POST', body: '{}' })
              )
            }
          >
            Generate postmortem
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card title="Timeline">
            <div className="space-y-2">
              {data.timeline.map((t, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  <span className="text-muted whitespace-nowrap opacity-70">
                    {new Date(t.at).toLocaleTimeString()}
                  </span>
                  <span className="text-text">{t.message}</span>
                </div>
              ))}
            </div>
          </Card>

          {investigation && (
            <Card title="AI investigation">
              <p className="text-sm mb-3">{investigation.summary}</p>
              <div className="label mb-1">Probable root cause</div>
              <p className="text-sm text-warning mb-3">{investigation.probableRootCause}</p>
              <div className="label mb-1">Evidence</div>
              <ul className="text-xs text-muted list-disc pl-4 mb-3 space-y-0.5">
                {investigation.evidence.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <div className="label mb-1">Alternative hypotheses</div>
              <ul className="text-xs text-muted list-disc pl-4">
                {investigation.alternativeHypotheses.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Card>
          )}

          {data.postmortem && (
            <Card title="Postmortem">
              <pre className="text-xs whitespace-pre-wrap text-muted">
                {data.postmortem.content_md}
              </pre>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Root cause">
            <div className="text-sm">{data.root_cause?.title ?? 'Pending investigation.'}</div>
            {data.confidence != null && (
              <div className="text-xs text-muted mt-1">
                Confidence {Math.round(data.confidence * 100)}%
              </div>
            )}
          </Card>

          <Card title="Anomalies (evidence)">
            <div className="space-y-1">
              {data.anomalies.map((a, i) => (
                <div key={i} className="text-xs flex justify-between">
                  <span className="text-muted">
                    {a.service_id}·{a.metric}
                  </span>
                  <span>
                    {Math.round(a.value)} vs {Math.round(a.baseline)}
                  </span>
                </div>
              ))}
              {data.anomalies.length === 0 && (
                <div className="text-muted text-xs">None recorded.</div>
              )}
            </div>
          </Card>

          <Card title="Remediation">
            {data.remediation.length === 0 ? (
              <div className="text-muted text-xs">No actions proposed yet.</div>
            ) : (
              <div className="space-y-3">
                {data.remediation.map(r => (
                  <div key={r.id} className="border border-border rounded p-2">
                    <div className="text-sm text-text">
                      {r.type} <span className="text-muted">on {r.target_service}</span>
                    </div>
                    <div className="text-xs text-muted mb-1">
                      Risk {r.risk} · {r.status}
                    </div>
                    <div className="text-xs text-muted mb-2">{r.rationale}</div>
                    {r.status === 'PROPOSED' && engineer && (
                      <div className="flex gap-2">
                        <button
                          className="btn btn-primary"
                          disabled={!!busy}
                          onClick={() =>
                            act(`ap-${r.id}`, () =>
                              apiFetch(`/api/remediation/${r.id}/approve`, {
                                method: 'POST',
                                body: '{}',
                              })
                            )
                          }
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={!!busy}
                          onClick={() =>
                            act(`rj-${r.id}`, () =>
                              apiFetch(`/api/remediation/${r.id}/reject`, {
                                method: 'POST',
                                body: '{}',
                              })
                            )
                          }
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {r.status === 'PROPOSED' && !engineer && (
                      <div className="text-xs text-muted">Requires ENGINEER/ADMIN approval.</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
