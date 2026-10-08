/**
 * Cross-cutting enumerations shared by every SentinelOps service.
 * Kept as `const` objects + literal unions so they are usable at runtime
 * (Kafka keys, DB values) and at the type level.
 */

export const Severity = {
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

/** Ordered so numeric comparison reflects escalation. */
export const SEVERITY_ORDER: Severity[] = [
  Severity.INFO,
  Severity.LOW,
  Severity.MEDIUM,
  Severity.HIGH,
  Severity.CRITICAL,
];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export const IncidentStatus = {
  DETECTED: 'DETECTED',
  INVESTIGATING: 'INVESTIGATING',
  IDENTIFIED: 'IDENTIFIED',
  MITIGATION_REQUIRED: 'MITIGATION_REQUIRED',
  REMEDIATING: 'REMEDIATING',
  VERIFYING: 'VERIFYING',
  RESOLVED: 'RESOLVED',
  POSTMORTEM: 'POSTMORTEM',
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

/** Allowed lifecycle transitions. Enforced by the incident-engine. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  DETECTED: ['INVESTIGATING'],
  INVESTIGATING: ['IDENTIFIED', 'MITIGATION_REQUIRED'],
  IDENTIFIED: ['MITIGATION_REQUIRED', 'REMEDIATING'],
  MITIGATION_REQUIRED: ['REMEDIATING'],
  REMEDIATING: ['VERIFYING'],
  VERIFYING: ['RESOLVED', 'MITIGATION_REQUIRED'],
  RESOLVED: ['POSTMORTEM'],
  POSTMORTEM: [],
};

export const EventType = {
  TELEMETRY_SAMPLE: 'TELEMETRY_SAMPLE',
  METRIC_SAMPLE: 'METRIC_SAMPLE',
  LOG_RECORD: 'LOG_RECORD',
  LATENCY_ANOMALY: 'LATENCY_ANOMALY',
  ERROR_RATE_ANOMALY: 'ERROR_RATE_ANOMALY',
  RESOURCE_ANOMALY: 'RESOURCE_ANOMALY',
  SATURATION_ANOMALY: 'SATURATION_ANOMALY',
  INCIDENT_DETECTED: 'INCIDENT_DETECTED',
  INCIDENT_UPDATED: 'INCIDENT_UPDATED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  REMEDIATION_PROPOSED: 'REMEDIATION_PROPOSED',
  REMEDIATION_APPROVED: 'REMEDIATION_APPROVED',
  REMEDIATION_EXECUTED: 'REMEDIATION_EXECUTED',
  RECOVERY_VERIFIED: 'RECOVERY_VERIFIED',
  RECOVERY_FAILED: 'RECOVERY_FAILED',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const ServiceHealth = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNHEALTHY: 'UNHEALTHY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ServiceHealth = (typeof ServiceHealth)[keyof typeof ServiceHealth];

export const Role = {
  VIEWER: 'VIEWER',
  ENGINEER: 'ENGINEER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Kafka topics — single source of truth. */
export const Topics = {
  telemetry: 'telemetry.events',
  metrics: 'metrics.events',
  logs: 'log.events',
  anomaly: 'anomaly.events',
  incident: 'incident.events',
  remediation: 'remediation.events',
  recovery: 'recovery.events',
  deadletter: 'deadletter.events',
} as const;
export type TopicName = (typeof Topics)[keyof typeof Topics];

/** Known metric names collected across the fleet. */
export const MetricName = {
  REQUEST_LATENCY_MS: 'request_latency_ms',
  REQUEST_RATE: 'request_rate',
  ERROR_RATE: 'error_rate',
  CPU_USAGE: 'cpu_usage',
  MEMORY_USAGE: 'memory_usage',
  DB_CONNECTIONS: 'db_connections',
  DB_POOL_UTILIZATION: 'db_pool_utilization',
  DB_QUERY_LATENCY_MS: 'db_query_latency_ms',
  REDIS_LATENCY_MS: 'redis_latency_ms',
  KAFKA_CONSUMER_LAG: 'kafka_consumer_lag',
  QUEUE_DEPTH: 'queue_depth',
} as const;
export type MetricName = (typeof MetricName)[keyof typeof MetricName];

export const RemediationActionType = {
  RESTART_SERVICE: 'restart_service',
  SCALE_SERVICE: 'scale_service',
  CLEAR_CACHE: 'clear_cache',
  ROLLBACK_DEPLOYMENT: 'rollback_deployment',
  INCREASE_CONNECTION_POOL: 'increase_connection_pool',
} as const;
export type RemediationActionType =
  (typeof RemediationActionType)[keyof typeof RemediationActionType];

export const RemediationRisk = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type RemediationRisk = (typeof RemediationRisk)[keyof typeof RemediationRisk];

export const RemediationStatus = {
  PROPOSED: 'PROPOSED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXECUTING: 'EXECUTING',
  EXECUTED: 'EXECUTED',
  FAILED: 'FAILED',
} as const;
export type RemediationStatus =
  (typeof RemediationStatus)[keyof typeof RemediationStatus];

/** Fault types the demo services can inject on themselves. */
export const FaultType = {
  KILL: 'kill',
  DB_LATENCY: 'db_latency',
  BREAK_REDIS: 'break_redis',
  TRAFFIC_SPIKE: 'traffic_spike',
  CPU_STRESS: 'cpu_stress',
  MEMORY_LEAK: 'memory_leak',
  KAFKA_LAG: 'kafka_lag',
  NETWORK_FAILURE: 'network_failure',
  ERROR_INJECTION: 'error_injection',
} as const;
export type FaultType = (typeof FaultType)[keyof typeof FaultType];
