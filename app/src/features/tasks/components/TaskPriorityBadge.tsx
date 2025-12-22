/**
 * @file TaskPriorityBadge.tsx
 * @description Badge component displaying task priority level
 * @feature tasks
 * @dependencies @/shared/components/ui, @/features/tasks/types
 */

import { Badge, type BadgeProps } from '@/shared/components/ui';
import { type TaskPriority, TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '../types/tasks.types';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskPriorityBadgeProps {
  /** Task priority */
  priority: TaskPriority;
  /** Badge size */
  size?: BadgeProps['size'];
  /** Show priority label text */
  showLabel?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a task's priority level as a colored badge.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <TaskPriorityBadge priority="high" />
 *
 * // Without label (dot only)
 * <TaskPriorityBadge priority="critical" showLabel={false} />
 * ```
 */
export function TaskPriorityBadge({
  priority,
  size = 'sm',
  showLabel = true,
  className,
}: TaskPriorityBadgeProps) {
  const variant = TASK_PRIORITY_COLORS[priority];
  const label = TASK_PRIORITY_LABELS[priority];

  return (
    <Badge
      variant={variant}
      size={size}
      dot={!showLabel}
      className={className}
    >
      {showLabel ? label : null}
    </Badge>
  );
}
