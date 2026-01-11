/**
 * @file StatusBadge.tsx
 * @description Badge component displaying incident status
 * @feature incidents
 * @dependencies @/shared/components/ui/Badge, @/features/incidents/types
 */

import { Badge } from '@/shared/components/ui/Badge';
import type { BadgeProps } from '@/shared/components/ui/Badge';
import type { IncidentStatus } from '../types/incidents.types';
import { INCIDENT_STATUS_LABELS } from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface StatusBadgeProps {
  /** Incident status */
  status: IncidentStatus;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show dot indicator */
  showDot?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// MAPPINGS
// ============================================================================

const STATUS_TO_VARIANT: Record<IncidentStatus, BadgeProps['variant']> = {
  detected: 'error',
  investigating: 'warning',
  contained: 'info',
  resolved: 'success',
  closed: 'default',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a badge indicating incident status.
 *
 * @example
 * ```tsx
 * <StatusBadge status="investigating" />
 * <StatusBadge status="resolved" size="lg" />
 * ```
 */
export function StatusBadge({
  status,
  size = 'sm',
  showDot = true,
  className,
}: StatusBadgeProps) {
  const variant = STATUS_TO_VARIANT[status];
  const label = INCIDENT_STATUS_LABELS[status];
  const shouldPulse = status === 'detected' || status === 'investigating';

  return (
    <Badge
      variant={variant}
      size={size}
      dot={showDot}
      dotPulse={shouldPulse}
      className={className}
    >
      {label}
    </Badge>
  );
}
