/**
 * @file RobotStatusBadge.tsx
 * @description Badge component displaying robot operational status
 * @feature robots
 * @dependencies @/shared/components/ui, @/features/robots/types
 */

import { Badge, type BadgeProps } from '@/shared/components/ui';
import { type RobotStatus, ROBOT_STATUS_LABELS, ROBOT_STATUS_COLORS } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotStatusBadgeProps {
  /** Robot status */
  status: RobotStatus;
  /** Badge size */
  size?: BadgeProps['size'];
  /** Show status label text */
  showLabel?: boolean;
  /** Show pulsing dot for active states */
  showPulse?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a robot's operational status as a colored badge.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <RobotStatusBadge status="online" />
 *
 * // With label
 * <RobotStatusBadge status="busy" showLabel />
 *
 * // With pulse for active states
 * <RobotStatusBadge status="online" showLabel showPulse />
 * ```
 */
export function RobotStatusBadge({
  status,
  size = 'sm',
  showLabel = true,
  showPulse = false,
  className,
}: RobotStatusBadgeProps) {
  const variant = ROBOT_STATUS_COLORS[status];
  const label = ROBOT_STATUS_LABELS[status];

  // Show pulse for active/online status
  const shouldPulse = showPulse && (status === 'online' || status === 'busy');

  return (
    <Badge
      variant={variant}
      size={size}
      dot={!showLabel}
      dotPulse={shouldPulse}
      className={className}
    >
      {showLabel ? label : null}
    </Badge>
  );
}
