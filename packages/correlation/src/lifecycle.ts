import {
  IncidentStatus,
  INCIDENT_TRANSITIONS,
  type IncidentStatus as IncidentStatusT,
} from '@sentinelops/shared-types';

/** Guard for the incident lifecycle state machine (see ARCHITECTURE §7). */
export function canTransition(
  from: IncidentStatusT,
  to: IncidentStatusT,
): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** Throws if the transition is illegal; returns the new status otherwise. */
export function transition(
  from: IncidentStatusT,
  to: IncidentStatusT,
): IncidentStatusT {
  if (!canTransition(from, to)) {
    throw new Error(`illegal incident transition: ${from} → ${to}`);
  }
  return to;
}

export function isTerminal(status: IncidentStatusT): boolean {
  return INCIDENT_TRANSITIONS[status].length === 0;
}

export { IncidentStatus };
