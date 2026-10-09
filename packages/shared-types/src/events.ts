import { z } from 'zod';

/**
 * The common envelope wrapping every Kafka message. Payload shape is
 * discriminated by `type` at the consumer boundary via the schemas below.
 */
export const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string(),
  timestamp: z.string().datetime(),
  service: z.string(),
  /** Trace correlation when the event originates from a request path. */
  traceId: z.string().optional(),
  /** Optional grouping key set by the correlation engine. */
  correlationId: z.string().optional(),
  /** Schema version for forward-compatible consumers. */
  version: z.number().int().default(1),
  payload: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, 'payload'> & {
  payload: T;
};

export const MetricSampleSchema = z.object({
  metric: z.string(),
  value: z.number(),
  unit: z.string().optional(),
  labels: z.record(z.string()).default({}),
  ts: z.string().datetime(),
});
export type MetricSample = z.infer<typeof MetricSampleSchema>;

export const LogRecordSchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']),
  message: z.string(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  error: z.string().optional(),
  fields: z.record(z.unknown()).default({}),
  ts: z.string().datetime(),
});
export type LogRecord = z.infer<typeof LogRecordSchema>;

export const AnomalySchema = z.object({
  anomalyId: z.string().uuid(),
  service: z.string(),
  metric: z.string(),
  value: z.number(),
  baseline: z.number(),
  deviation: z.number(),
  /** 0..1 confidence that this point is anomalous. */
  anomalyScore: z.number().min(0).max(1),
  method: z.enum(['zscore', 'ewma', 'isolation_forest', 'threshold']),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;

/** Helper to build a well-formed envelope. */
export function makeEnvelope<T>(input: {
  type: string;
  service: string;
  payload: T;
  traceId?: string;
  correlationId?: string;
  eventId?: string;
  timestamp?: string;
}): EventEnvelope<T> {
  const envelope: EventEnvelope<T> = {
    eventId: input.eventId ?? crypto.randomUUID(),
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    service: input.service,
    version: 1,
    payload: input.payload,
  };
  if (input.traceId !== undefined) envelope.traceId = input.traceId;
  if (input.correlationId !== undefined) envelope.correlationId = input.correlationId;
  return envelope;
}
