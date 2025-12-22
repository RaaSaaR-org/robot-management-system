/**
 * @file AlertSeverityBadge.tsx
 * @description Badge component displaying alert severity level
 * @feature alerts
 * @dependencies @/shared/components/ui/Badge, @/features/alerts/types
 */

import { Badge } from '@/shared/components/ui/Badge';
import type { BadgeProps } from '@/shared/components/ui/Badge';
import type { AlertSeverity } from '../types/alerts.types';
import { ALERT_SEVERITY_LABELS } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertSeverityBadgeProps {
  /** Alert severity level */
  severity: AlertSeverity;
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

const SEVERITY_TO_VARIANT: Record<AlertSeverity, BadgeProps['variant']> = {
  critical: 'error',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a badge indicating alert severity level.
 *
 * @example
 * ```tsx
 * <AlertSeverityBadge severity="critical" showDot />
 * <AlertSeverityBadge severity="warning" size="sm" />
 * ```
 */
export function AlertSeverityBadge({
  severity,
  size = 'sm',
  showDot = true,
  className,
}: AlertSeverityBadgeProps) {
  const variant = SEVERITY_TO_VARIANT[severity];
  const label = ALERT_SEVERITY_LABELS[severity];
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
