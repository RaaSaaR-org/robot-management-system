/**
 * @file SeverityBadge.tsx
 * @description Badge component displaying incident severity level
 * @feature incidents
 * @dependencies @/shared/components/ui/Badge, @/features/incidents/types
 */

import { Badge } from '@/shared/components/ui/Badge';
import type { BadgeProps } from '@/shared/components/ui/Badge';
import type { IncidentSeverity } from '../types/incidents.types';
import { INCIDENT_SEVERITY_LABELS } from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface SeverityBadgeProps {
  /** Incident severity level */
  severity: IncidentSeverity;
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

const SEVERITY_TO_VARIANT: Record<IncidentSeverity, BadgeProps['variant']> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a badge indicating incident severity level.
 *
 * @example
 * ```tsx
 * <SeverityBadge severity="critical" showDot />
 * <SeverityBadge severity="medium" size="sm" />
 * ```
 */
export function SeverityBadge({
  severity,
  size = 'sm',
  showDot = true,
  className,
}: SeverityBadgeProps) {
  const variant = SEVERITY_TO_VARIANT[severity];
  const label = INCIDENT_SEVERITY_LABELS[severity];
  const shouldPulse = severity === 'critical';

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
