import type { ReactNode } from 'react';

const HEALTH: Record<string, { cls: string; icon: string }> = {
  HEALTHY: { cls: 'border-healthy text-healthy', icon: '●' },
  DEGRADED: { cls: 'border-warning text-warning', icon: '◐' },
  UNHEALTHY: { cls: 'border-critical text-critical', icon: '▲' },
  UNKNOWN: { cls: 'border-muted text-muted', icon: '○' },
};

const SEVERITY: Record<string, string> = {
  INFO: 'border-muted text-muted',
  LOW: 'border-info text-info',
  MEDIUM: 'border-warning text-warning',
  HIGH: 'border-critical text-critical',
  CRITICAL: 'border-critical text-critical bg-critical/10',
};

const STATUS: Record<string, string> = {
  DETECTED: 'border-critical text-critical',
  INVESTIGATING: 'border-warning text-warning',
  IDENTIFIED: 'border-warning text-warning',
  MITIGATION_REQUIRED: 'border-warning text-warning',
  REMEDIATING: 'border-info text-info',
  VERIFYING: 'border-info text-info',
  RESOLVED: 'border-healthy text-healthy',
  POSTMORTEM: 'border-muted text-muted',
};

export function HealthBadge({ health }: { health: string }) {
  const h = HEALTH[health] ?? HEALTH.UNKNOWN!;
  return (
    <span className={`badge ${h.cls}`}>
      <span aria-hidden>{h.icon}</span> {health}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${SEVERITY[severity] ?? SEVERITY.INFO}`}>{severity}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS[status] ?? 'border-muted text-muted'}`}>{status}</span>;
}

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="card">
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
