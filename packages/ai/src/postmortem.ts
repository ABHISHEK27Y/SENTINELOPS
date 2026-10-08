import type { Investigation } from './investigator.js';

export interface PostmortemContext {
  incidentId: string;
  title: string;
  severity: string;
  startedAt: string;
  resolvedAt?: string;
  affectedServices: string[];
  investigation: Investigation;
  remediation: Array<{ action: string; approvedBy?: string; result?: string }>;
  timeline: Array<{ at: string; message: string }>;
}

function durationStr(startIso: string, endIso?: string): string {
  if (!endIso) return 'ongoing';
  const ms = Date.parse(endIso) - Date.parse(startIso);
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

/**
 * Drafts a markdown postmortem from the resolved incident's real data. Structured
 * and evidence-based — the LLM (if configured) would polish prose, but the facts
 * come from the incident record.
 */
export function buildPostmortem(ctx: PostmortemContext): string {
  const inv = ctx.investigation;
  const lines: string[] = [];
  lines.push(`# Postmortem: ${ctx.title}`);
  lines.push('');
  lines.push(`- **Incident:** ${ctx.incidentId}`);
  lines.push(`- **Severity:** ${ctx.severity}`);
  lines.push(`- **Duration:** ${durationStr(ctx.startedAt, ctx.resolvedAt)}`);
  lines.push(`- **Affected services:** ${ctx.affectedServices.join(', ')}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(inv.summary);
  lines.push('');
  lines.push('## Impact');
  lines.push(
    `${ctx.affectedServices.length} service(s) degraded starting ${ctx.startedAt}.`,
  );
  lines.push('');
  lines.push('## Timeline');
  for (const t of ctx.timeline) lines.push(`- \`${t.at}\` ${t.message}`);
  lines.push('');
  lines.push('## Root cause');
  lines.push(inv.probableRootCause);
  lines.push('');
  lines.push('## Contributing factors');
  lines.push(inv.whatChanged);
  for (const alt of inv.alternativeHypotheses) lines.push(`- Considered: ${alt}`);
  lines.push('');
  lines.push('## Detection');
  lines.push(
    `Detected automatically by SentinelOps from anomaly correlation. Evidence:`,
  );
  for (const e of inv.evidence.slice(0, 6)) lines.push(`- ${e}`);
  lines.push('');
  lines.push('## Remediation');
  if (ctx.remediation.length === 0) lines.push('- (none recorded)');
  for (const r of ctx.remediation) {
    lines.push(
      `- ${r.action}${r.approvedBy ? ` (approved by ${r.approvedBy})` : ''}` +
        `${r.result ? ` — ${r.result}` : ''}`,
    );
  }
  lines.push('');
  lines.push('## Preventive actions');
  lines.push('- Add/adjust alerting thresholds for the leading indicator metric.');
  lines.push('- Review capacity (pool size / autoscaling) for the affected path.');
  lines.push('- Add a regression test for the failure mode.');
  lines.push('');
  lines.push('## Lessons learned');
  lines.push(inv.whatHappened);
  return lines.join('\n');
}
