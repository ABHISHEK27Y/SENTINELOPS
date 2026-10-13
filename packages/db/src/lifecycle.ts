import {
  INCIDENT_TRANSITIONS,
  type IncidentStatus,
  makeEnvelope,
  Topics,
  EventType,
} from '@sentinelops/shared-types';

import { query, transaction } from './pool.js';
import { enqueueEvent } from './reliability.js';

/** One atomic implementation for every incident status writer. */
export async function transitionIncident(
  id: string,
  to: IncidentStatus,
  message: string,
  expected?: IncidentStatus
): Promise<boolean> {
  return transaction(async () => {
    const { rows } = await query<{ status: IncidentStatus }>(
      'SELECT status FROM incidents WHERE id=$1 FOR UPDATE',
      [id]
    );
    const from = rows[0]?.status;
    if (!from || (expected && from !== expected) || !INCIDENT_TRANSITIONS[from]?.includes(to))
      return false;
    await query(
      "UPDATE incidents SET status=$2,updated_at=now(),resolved_at=CASE WHEN $2='RESOLVED' THEN now() ELSE resolved_at END WHERE id=$1",
      [id, to]
    );
    await query(
      "INSERT INTO incident_events(incident_id,kind,message,data) VALUES ($1,'status',$2,$3)",
      [id, message, JSON.stringify({ from, to })]
    );
    await enqueueEvent(
      Topics.incident,
      makeEnvelope({
        type: to === 'RESOLVED' ? EventType.INCIDENT_RESOLVED : EventType.INCIDENT_UPDATED,
        service: 'incident-lifecycle',
        payload: { incidentId: id, from, status: to },
      }),
      id
    );
    return true;
  });
}
