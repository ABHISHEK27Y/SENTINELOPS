'use client';
import { Shell } from '@/components/Shell';
import { Card } from '@/components/StatusBadge';

const RUNBOOKS = [
  { title: 'Database Troubleshooting', category: 'database', summary: 'Connection pool exhaustion, slow queries, pool increase, rollback, restart.' },
  { title: 'Redis Failures', category: 'cache', summary: 'Connection refused, memory eviction, queue backpressure, cache restart.' },
  { title: 'Payment Service', category: 'service', summary: 'Health signals, failure modes, safe remediation actions, recovery verification.' },
];

export default function RunbooksPage() {
  return (
    <Shell>
      <h1 className="text-xl font-semibold mb-1">Operational Runbooks</h1>
      <p className="text-muted text-sm mb-4">
        These documents are chunked, embedded, and indexed for retrieval — the AI investigator
        cites them when explaining an incident (RAG).
      </p>
      <div className="grid grid-cols-2 gap-4">
        {RUNBOOKS.map((r) => (
          <Card key={r.title} title={r.title}>
            <div className="text-xs uppercase tracking-wide text-muted mb-2">{r.category}</div>
            <p className="text-sm text-muted">{r.summary}</p>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
