import { DependencyGraph, Correlator } from '@sentinelops/correlation';
import { query, withPipelineState, enqueueEvent } from '@sentinelops/db';
import { rankRootCauses } from '@sentinelops/root-cause';
import {
  Topics,
  EventType,
  IncidentStatus,
  makeEnvelope,
  type Anomaly,
  type Severity,
} from '@sentinelops/shared-types';

import { severityForGroup } from './severity.js';
import { SERVICE_DEPENDENCIES } from './topology.js';

interface IncidentObserver {
  anomaly?: () => void;
  open?: (count: number) => void;
  created?: (id: string, severity: Severity, services: string[], trigger: string) => void;
}
const graph = new DependencyGraph(SERVICE_DEPENDENCIES);

async function persistAnomaly(a: Anomaly, incidentId: string | null): Promise<void> {
  await query(
    `INSERT INTO anomalies
       (id, service_id, metric, value, baseline, deviation, anomaly_score,
        method, severity, incident_id, window_start, window_end, instance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [
      a.anomalyId,
      a.service,
      a.metric,
      a.value,
      a.baseline,
      a.deviation,
      a.anomalyScore,
      a.method,
      a.severity,
      incidentId,
      a.windowStart,
      a.windowEnd,
      a.instance ?? 'default',
    ]
  );
}

async function appendTimeline(
  incidentId: string,
  kind: string,
  message: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await query(
    `INSERT INTO incident_events (incident_id, kind, message, data)
     VALUES ($1,$2,$3,$4)`,
    [incidentId, kind, message, JSON.stringify(data)]
  );
}

export async function handleAnomaly(
  anomaly: Anomaly,
  observer: IncidentObserver = {},
  nowMs = Date.now()
): Promise<void> {
  await withPipelineState('correlation', async state => {
    const correlator = new Correlator(graph, { windowMs: 60_000, maxHops: 2 });
    correlator.restore(state);
    const eventMs = Date.parse(anomaly.windowEnd);
    if (eventMs > nowMs + 30_000)
      throw new Error('anomaly timestamp exceeds future clock allowance');
    if (eventMs < nowMs - 300_000 || correlator.isLate(eventMs)) {
      await persistAnomaly(anomaly, null);
      await query(
        "INSERT INTO audit_log(actor,action,target,result,data) VALUES ('incident-engine','archive_late_anomaly',$1,'ARCHIVED',$2)",
        [
          anomaly.anomalyId,
          JSON.stringify({ service: anomaly.service, windowEnd: anomaly.windowEnd }),
        ]
      );
      return { state: correlator.snapshot(), result: undefined };
    }
    const terminal = await query<{ correlation_id: string }>(
      "SELECT correlation_id FROM incidents WHERE status IN ('RESOLVED','POSTMORTEM') AND updated_at > now() - interval '1 day'"
    );
    for (const row of terminal.rows) correlator.close(row.correlation_id);
    await persistGroup(anomaly, correlator, observer);
    return { state: correlator.snapshot(), result: undefined };
  });
}

async function persistGroup(
  anomaly: Anomaly,
  correlator: Correlator,
  observer: IncidentObserver
): Promise<void> {
  observer.anomaly?.();
  const result = correlator.ingest(anomaly);
  const existing = (
    await query<{ status: string }>(
      'SELECT status FROM incidents WHERE correlation_id=$1 FOR UPDATE',
      [result.correlationId]
    )
  ).rows[0];
  if (existing && ['RESOLVED', 'POSTMORTEM'].includes(existing.status)) {
    // Re-check under the incident lock: a verifier may have resolved the group
    // after the initial terminal scan. Never append a new fault to that incident.
    correlator.close(result.correlationId);
    return persistGroup(anomaly, correlator, observer);
  }
  observer.open?.(correlator.openGroups().length);
  const group = correlator.get(result.correlationId);
  if (!group) return;

  const { severity, score } = severityForGroup(group);
  const services = [...group.services];
  const triggerService = group.anomalies[0]?.service ?? anomaly.service;
  const title = `Degradation on ${triggerService} (${services.length} service${
    services.length > 1 ? 's' : ''
  } affected)`;

  // Rank probable root causes from the correlated anomalies + dependency graph.
  const hypotheses = rankRootCauses({
    anomalies: group.anomalies,
    services,
    edges: SERVICE_DEPENDENCIES,
    incidentStartMs: group.firstSeen,
  });
  const topCause = hypotheses[0] ?? null;
  const confidence = topCause ? topCause.confidence : score;
  const rootCauseJson = topCause ? JSON.stringify(topCause) : null;

  if (result.isNew) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO incidents
         (id, title, status, severity, affected_services, correlation_id,
          root_cause, confidence, started_at, detected_at)
       VALUES ('INC-'||nextval('incident_seq'), $1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (correlation_id) DO NOTHING
       RETURNING id`,
      [
        title,
        IncidentStatus.DETECTED,
        severity,
        services,
        result.correlationId,
        rootCauseJson,
        confidence,
        new Date(group.firstSeen).toISOString(),
      ]
    );
    if (rows.length > 0) {
      const incidentId = rows[0]!.id;
      await persistAnomaly(anomaly, incidentId);
      await appendTimeline(incidentId, 'DETECTED', title, {
        severity,
        score,
        trigger: anomaly.metric,
      });
      if (topCause) {
        await appendTimeline(incidentId, 'root_cause', topCause.title, {
          confidence: topCause.confidence,
          evidence: topCause.evidence.length,
        });
      }
      observer.created?.(incidentId, severity, services, anomaly.metric);
      await enqueueEvent(
        Topics.incident,
        makeEnvelope({
          type: EventType.INCIDENT_DETECTED,
          service: 'incident-engine',
          correlationId: result.correlationId,
          payload: {
            incidentId,
            title,
            severity,
            affectedServices: services,
            confidence,
            rootCause: topCause?.title ?? null,
          },
        }),
        incidentId
      );
      return;
    }
    // Lost the insert race — fall through to update.
  }

  // Existing incident: update severity/services and append to the timeline.
  const { rows } = await query<{ id: string; status: string }>(
    `UPDATE incidents
        SET title = $1, severity = $2, affected_services = $3, root_cause = $4,
            confidence = $5, updated_at = now()
      WHERE correlation_id = $6
      RETURNING id, status`,
    [title, severity, services, rootCauseJson, confidence, result.correlationId]
  );
  if (rows.length === 0) return;
  const incidentId = rows[0]!.id;
  await persistAnomaly(anomaly, incidentId);
  await appendTimeline(
    incidentId,
    'anomaly_correlated',
    `${anomaly.metric} anomaly on ${anomaly.service}`,
    { score: anomaly.anomalyScore, severity }
  );
  await enqueueEvent(
    Topics.incident,
    makeEnvelope({
      type: EventType.INCIDENT_UPDATED,
      service: 'incident-engine',
      correlationId: result.correlationId,
      payload: {
        incidentId,
        title,
        severity,
        affectedServices: services,
        anomalyCount: result.anomalyCount,
      },
    }),
    incidentId
  );
}
