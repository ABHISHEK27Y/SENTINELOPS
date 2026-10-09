import { z } from 'zod';

/** Persistent domain models (mirror the Postgres schema). */

export const ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  health: z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']),
  tier: z.enum(['edge', 'application', 'data', 'control']).default('application'),
  createdAt: z.string().datetime().optional(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const ServiceDependencySchema = z.object({
  fromService: z.string(),
  toService: z.string(),
  /** Rolling call volume used to weight the dependency edge. */
  callRate: z.number().default(0),
  errorRate: z.number().default(0),
  p95LatencyMs: z.number().default(0),
});
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>;

export const EvidenceSchema = z.object({
  kind: z.enum(['metric', 'log', 'trace', 'deployment', 'dependency', 'anomaly']),
  summary: z.string(),
  /** Structured backing data so the UI can render + the AI can cite it. */
  data: z.record(z.unknown()).default({}),
  weight: z.number().min(0).max(1).default(0.5),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RootCauseHypothesisSchema = z.object({
  title: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema),
});
export type RootCauseHypothesis = z.infer<typeof RootCauseHypothesisSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum([
    'DETECTED',
    'INVESTIGATING',
    'IDENTIFIED',
    'MITIGATION_REQUIRED',
    'REMEDIATING',
    'VERIFYING',
    'RESOLVED',
    'POSTMORTEM',
  ]),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  affectedServices: z.array(z.string()),
  startedAt: z.string().datetime(),
  detectedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional(),
  rootCause: RootCauseHypothesisSchema.nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  correlationId: z.string(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentEventSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  at: z.string().datetime(),
  kind: z.string(),
  message: z.string(),
  data: z.record(z.unknown()).default({}),
});
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;

export const RemediationActionSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  type: z.enum([
    'restart_service',
    'scale_service',
    'clear_cache',
    'rollback_deployment',
    'increase_connection_pool',
  ]),
  targetService: z.string(),
  params: z.record(z.unknown()).default({}),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED']),
  rationale: z.string(),
  requiresApproval: z.boolean(),
  proposedAt: z.string().datetime(),
});
export type RemediationAction = z.infer<typeof RemediationActionSchema>;
