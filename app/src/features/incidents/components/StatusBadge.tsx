/**
 * @file StatusBadge.tsx
 * @description Incident lifecycle status as the kit StatusTag (thin wrapper kept for callers)
 * @feature incidents
 */

import { StatusTag } from '@/shared/components/ui';
import type { IncidentStatus } from '../types/incidents.types';
import { INCIDENT_STATUS_LABELS } from '../types/incidents.types';
import { INCIDENT_STATUS_TONE } from '../utils/tones';

export interface StatusBadgeProps {
  /** Incident status */
  status: IncidentStatus;
  /** Size variant ('lg' renders as 'md') */
  size?: 'sm' | 'md' | 'lg';
  /** Show dot indicator */
  showDot?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Displays incident status as a StatusTag.
 *
 * @example
 * <StatusBadge status="investigating" />
 */
export function StatusBadge({ status, size = 'sm', showDot = true, className }: StatusBadgeProps) {
  return (
    <StatusTag
      tone={INCIDENT_STATUS_TONE[status]}
      size={size === 'sm' ? 'sm' : 'md'}
      dot={showDot}
      className={className}
    >
      {INCIDENT_STATUS_LABELS[status]}
    </StatusTag>
  );
}
