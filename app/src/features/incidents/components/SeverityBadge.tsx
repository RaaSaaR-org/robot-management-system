/**
 * @file SeverityBadge.tsx
 * @description Incident severity as the kit StatusTag (thin wrapper kept for callers)
 * @feature incidents
 */

import { StatusTag } from '@/shared/components/ui';
import type { IncidentSeverity } from '../types/incidents.types';
import { INCIDENT_SEVERITY_LABELS } from '../types/incidents.types';
import { INCIDENT_SEVERITY_TONE } from '../utils/tones';

export interface SeverityBadgeProps {
  /** Incident severity */
  severity: IncidentSeverity;
  /** Size variant ('lg' renders as 'md') */
  size?: 'sm' | 'md' | 'lg';
  /** Show dot indicator */
  showDot?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Displays incident severity as a StatusTag.
 *
 * @example
 * <SeverityBadge severity="high" />
 */
export function SeverityBadge({ severity, size = 'sm', showDot = false, className }: SeverityBadgeProps) {
  return (
    <StatusTag
      tone={INCIDENT_SEVERITY_TONE[severity]}
      size={size === 'sm' ? 'sm' : 'md'}
      dot={showDot}
      className={className}
    >
      {INCIDENT_SEVERITY_LABELS[severity]}
    </StatusTag>
  );
}
