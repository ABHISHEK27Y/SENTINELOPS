import { describe, expect, it } from 'vitest';
import { MockProvider } from './provider.js';
import { buildInvestigation, type InvestigationContext } from './investigator.js';
import { buildPostmortem } from './postmortem.js';

const ctx: InvestigationContext = {
  incidentId: 'INC-1042',
  severity: 'HIGH',
  affectedServices: ['postgres', 'payment-service', 'order-service'],
  startedAt: '2026-09-22T10:31:00.000Z',
  anomalies: [
    { service: 'postgres', metric: 'db_query_latency_ms', value: 2500, baseline: 100, anomalyScore: 0.92, at: '2026-09-22T10:31:05.000Z' },
    { service: 'payment-service', metric: 'request_latency_ms', value: 2800, baseline: 180, anomalyScore: 0.88, at: '2026-09-22T10:31:09.000Z' },
    { service: 'payment-service', metric: 'error_rate', value: 0.17, baseline: 0.003, anomalyScore: 0.8, at: '2026-09-22T10:31:12.000Z' },
  ],
  rootCause: { title: 'postgres is the probable root cause', confidence: 0.9, evidence: ['2 affected services depend on postgres'] },
  runbooks: [{ title: 'Database Troubleshooting', snippet: 'increase pool size' }],
  recommendedActions: [
    { type: 'increase_connection_pool', targetService: 'payment-service', risk: 'LOW', rationale: 'relieve pool pressure' },
  ],
};

describe('buildInvestigation', () => {
  it('produces a grounded, evidence-referencing investigation', async () => {
    const inv = await buildInvestigation(ctx, new MockProvider());
    expect(inv.summary).toContain('INC-1042');
    expect(inv.probableRootCause).toContain('postgres');
    expect(inv.confidence).toBeCloseTo(0.9);
    // Evidence references the earliest anomaly first (temporal order).
    expect(inv.evidence[0]).toContain('db_query_latency_ms on postgres');
    expect(inv.recommendedActions[0]!.action).toContain('increase_connection_pool');
    expect(inv.runbookReferences).toContain('Database Troubleshooting');
    expect(inv.alternativeHypotheses.length).toBeGreaterThan(0);
  });

  it('never fabricates services not in the context', async () => {
    const inv = await buildInvestigation(ctx, new MockProvider());
    for (const s of inv.affectedServices) {
      expect(ctx.affectedServices).toContain(s);
    }
  });
});

describe('buildPostmortem', () => {
  it('renders a structured markdown postmortem', async () => {
    const inv = await buildInvestigation(ctx, new MockProvider());
    const md = buildPostmortem({
      incidentId: 'INC-1042',
      title: 'Payment degradation',
      severity: 'HIGH',
      startedAt: ctx.startedAt,
      resolvedAt: '2026-09-22T10:38:00.000Z',
      affectedServices: ctx.affectedServices,
      investigation: inv,
      remediation: [{ action: 'increase_connection_pool on payment-service', approvedBy: 'engineer@x', result: 'ok' }],
      timeline: [{ at: ctx.startedAt, message: 'incident detected' }],
    });
    expect(md).toContain('# Postmortem: Payment degradation');
    expect(md).toContain('**Duration:** 7 minutes');
    expect(md).toContain('## Root cause');
    expect(md).toContain('## Preventive actions');
  });
});
