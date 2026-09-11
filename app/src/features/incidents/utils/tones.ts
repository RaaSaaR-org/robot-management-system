/**
 * @file tones.ts
 * @description Tone maps for incident severity, incident status and
 *              notification status (the kit's statusTone() does not know this
 *              vocabulary, so these would all fall back to neutral), plus the
 *              incident lifecycle transitions.
 * @feature incidents
 */

import type { StatusToneName } from '@/shared/components/ui';
import type {
  IncidentSeverity,
  IncidentStatus,
  NotificationStatus,
} from '../types/incidents.types';

export const INCIDENT_SEVERITY_TONE: Record<IncidentSeverity, StatusToneName> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

export const INCIDENT_STATUS_TONE: Record<IncidentStatus, StatusToneName> = {
  detected: 'warning',
  investigating: 'info',
  contained: 'info',
  resolved: 'success',
  closed: 'neutral',
};

export const NOTIFICATION_STATUS_TONE: Record<NotificationStatus, StatusToneName> = {
  pending: 'warning',
  draft: 'warning',
  sent: 'success',
  acknowledged: 'success',
  overdue: 'danger',
};

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
