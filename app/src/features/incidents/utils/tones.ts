/**
 * @file tones.ts
 * @description The incident lifecycle transitions. Severity, incident status
 *              and notification status colours come from the kit's
 *              statusTone(), which knows this vocabulary.
 * @feature incidents
 */

import type { IncidentStatus } from '../types/incidents.types';

export interface IncidentTransition {
  to: IncidentStatus;
  /** Button / confirm verb, sentence case. */
  verb: string;
}

/** The main next step (primary button) per status. */
export const PRIMARY_TRANSITION: Partial<Record<IncidentStatus, IncidentTransition>> = {
  detected: { to: 'investigating', verb: 'Start investigating' },
  investigating: { to: 'resolved', verb: 'Mark resolved' },
  contained: { to: 'resolved', verb: 'Mark resolved' },
  resolved: { to: 'closed', verb: 'Close incident' },
};

/** Alternative steps (the "More actions" menu) per status. */
export const OTHER_TRANSITIONS: Partial<Record<IncidentStatus, IncidentTransition[]>> = {
  investigating: [{ to: 'contained', verb: 'Mark contained' }],
  resolved: [{ to: 'investigating', verb: 'Reopen' }],
};
