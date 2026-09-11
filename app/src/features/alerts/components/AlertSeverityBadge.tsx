/**
 * @file AlertSeverityBadge.tsx
 * @description Alert severity as the kit StatusTag (thin wrapper kept for callers)
 * @feature alerts
 */

import { StatusTag, statusTone } from '@/shared/components/ui';
import type { AlertSeverity } from '../types/alerts.types';
import { ALERT_SEVERITY_LABELS } from '../types/alerts.types';

export interface AlertSeverityBadgeProps {
  /** Alert severity level */
  severity: AlertSeverity;
  /** Size variant ('lg' renders as 'md') */
  size?: 'sm' | 'md' | 'lg';
  /** Show dot indicator */
  showDot?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * Displays alert severity as a StatusTag.
 *
 * @example
 * <AlertSeverityBadge severity="critical" />
 */
export function AlertSeverityBadge({
  severity,
  size = 'sm',
  showDot = true,
  className,
}: AlertSeverityBadgeProps) {
  return (
    <StatusTag
      tone={statusTone(severity)}
      size={size === 'sm' ? 'sm' : 'md'}
      dot={showDot}
      pulse={severity === 'critical'}
      className={className}
    >
      {ALERT_SEVERITY_LABELS[severity]}
    </StatusTag>
  );
}
