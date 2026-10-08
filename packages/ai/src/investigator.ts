import type { LlmProvider } from './provider.js';

export interface InvestigationContext {
  incidentId: string;
  severity: string;
  affectedServices: string[];
  startedAt: string;
  anomalies: Array<{
    service: string;
    metric: string;
    value: number;
    baseline: number;
    anomalyScore: number;
    at: string;
  }>;
  rootCause?: { title: string; confidence: number; evidence: string[] };
  runbooks: Array<{ title: string; snippet: string }>;
  recommendedActions: Array<{ type: string; targetService: string; risk: string; rationale: string }>;
  deployments?: Array<{ service: string; deployedAt: string }>;
}

export interface Investigation {
  summary: string;
  whatHappened: string;
  whenStarted: string;
  affectedServices: string[];
  whatChanged: string;
  probableRootCause: string;
  confidence: number;
  evidence: string[];
  alternativeHypotheses: string[];
  recommendedActions: Array<{ action: string; risk: string; reason: string }>;
  runbookReferences: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/**
 * Builds a grounded incident investigation. The structured findings are assembled
 * deterministically from telemetry so every claim references collected evidence
 * (see ADR-0004); the LLM is used only to phrase the human-readable summary.
 */
export async function buildInvestigation(
  ctx: InvestigationContext,
  provider: LlmProvider,
): Promise<Investigation> {
  const sorted = [...ctx.anomalies].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = sorted[0];

  const evidence = sorted.map(
    (a) =>
      `${a.metric} on ${a.service} rose to ${fmt(a.value)} vs baseline ${fmt(a.baseline)} ` +
      `(anomaly score ${a.anomalyScore.toFixed(2)}) at ${a.at}`,
  );
  if (ctx.rootCause) evidence.push(...ctx.rootCause.evidence);

  const whatChanged =
    ctx.deployments && ctx.deployments.length > 0
      ? `Deployment(s) shortly before the incident: ${ctx.deployments
          .map((d) => `${d.service} @ ${d.deployedAt}`)
          .join(', ')}.`
      : 'No deployment was recorded in the window before the incident.';

  const probableRootCause = ctx.rootCause
    ? `${ctx.rootCause.title} (confidence ${(ctx.rootCause.confidence * 100).toFixed(0)}%).`
    : 'Root cause not yet identified with confidence.';

  const alternativeHypotheses = buildAlternatives(ctx);

  const groundedSummary =
    `Incident ${ctx.incidentId} (${ctx.severity}) affected ${ctx.affectedServices.join(', ')}. ` +
    (first
      ? `It began with a ${first.metric} anomaly on ${first.service} at ${first.at}, `
      : '') +
    `and ${probableRootCause} ${whatChanged}`;

  // The LLM phrases the summary; the mock echoes the grounded text verbatim.
  const summary = await provider.complete([
    {
      role: 'system',
      content:
        'You are an SRE incident investigator. Explain the incident concisely and ' +
        'only from the provided evidence. Never invent telemetry.',
    },
    {
      role: 'user',
      content:
        `Write a 2-3 sentence incident summary from this context.\n` +
        `<summary>${groundedSummary}</summary>\n` +
        `Evidence:\n- ${evidence.join('\n- ')}`,
    },
  ]);

  return {
    summary,
    whatHappened: first
      ? `A ${first.metric} anomaly on ${first.service} propagated across ${ctx.affectedServices.length} service(s).`
      : `Anomalies were detected across ${ctx.affectedServices.length} service(s).`,
    whenStarted: ctx.startedAt,
    affectedServices: ctx.affectedServices,
    whatChanged,
    probableRootCause,
    confidence: ctx.rootCause?.confidence ?? 0,
    evidence,
    alternativeHypotheses,
    recommendedActions: ctx.recommendedActions.map((a) => ({
      action: `${a.type} on ${a.targetService}`,
      risk: a.risk,
      reason: a.rationale,
    })),
    runbookReferences: ctx.runbooks.map((r) => r.title),
  };
}

function buildAlternatives(ctx: InvestigationContext): string[] {
  const alts: string[] = [];
  const metrics = new Set(ctx.anomalies.map((a) => a.metric));
  if ([...metrics].some((m) => /pool|db_/.test(m))) {
    alts.push('A slow-query regression rather than pure traffic-driven pool exhaustion.');
    alts.push('A connection leak introduced by a recent change.');
  }
  if ([...metrics].some((m) => /cpu|memory/.test(m))) {
    alts.push('Resource saturation from a traffic spike rather than a code regression.');
  }
  if (alts.length === 0) alts.push('An upstream dependency degradation not yet instrumented.');
  return alts;
}
