/**
 * @file AlertSeverityBadge.tsx
 * @description Alert severity as the kit StatusTag (thin wrapper kept for callers)
 * @feature alerts
 */

import { StatusTag, type StatusToneName } from '@/shared/components/ui';
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

/** Severity → tone. `info` is not in the kit's status map, so it is explicit here. */
export const ALERT_SEVERITY_TONE: Record<AlertSeverity, StatusToneName> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'info',
};

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
      tone={ALERT_SEVERITY_TONE[severity]}
      size={size === 'sm' ? 'sm' : 'md'}
      dot={showDot}
      pulse={severity === 'critical'}
      className={className}
    >
      {ALERT_SEVERITY_LABELS[severity]}
    </StatusTag>
  );
}
