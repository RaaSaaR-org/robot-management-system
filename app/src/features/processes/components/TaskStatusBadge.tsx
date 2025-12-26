/**
 * @file TaskStatusBadge.tsx
 * @description Badge component displaying task execution status
 * @feature processes
 * @dependencies @/shared/components/ui, @/features/processes/types
 */

import { Badge, type BadgeProps } from '@/shared/components/ui';
import { type ProcessStatus as TaskStatus, PROCESS_STATUS_LABELS as TASK_STATUS_LABELS, PROCESS_STATUS_COLORS as TASK_STATUS_COLORS } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskStatusBadgeProps {
  /** Task status */
  status: TaskStatus;
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
 * Displays a task's execution status as a colored badge.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <TaskStatusBadge status="in_progress" />
 *
 * // With label
 * <TaskStatusBadge status="completed" showLabel />
 *
 * // With pulse for active states
 * <TaskStatusBadge status="in_progress" showLabel showPulse />
 * ```
 */
export function TaskStatusBadge({
  status,
  size = 'sm',
  showLabel = true,
  showPulse = false,
  className,
}: TaskStatusBadgeProps) {
  const variant = TASK_STATUS_COLORS[status];
  const label = TASK_STATUS_LABELS[status];

  // Show pulse for active status
  const shouldPulse = showPulse && status === 'in_progress';

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
