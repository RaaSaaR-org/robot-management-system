/**
 * @file TaskStatusBadge.tsx
 * @description An automation's status as the kit's StatusTag (thin wrapper kept
 *              for callers outside the feature, e.g. the robot's tasks tab)
 * @feature processes
 */

import { StatusTag } from '@/shared/components/ui';
import { PROCESS_STATUS_LABELS, type ProcessStatus as TaskStatus } from '../types';

export interface TaskStatusBadgeProps {
  /** Task status */
  status: TaskStatus;
  /** Tag size */
  size?: 'sm' | 'md' | 'lg';
  /** Show the label (false renders the dot only) */
  showLabel?: boolean;
  /** Pulse the dot while the automation runs */
  showPulse?: boolean;
  className?: string;
}

export function TaskStatusBadge({ status, size = 'sm', showLabel = true, showPulse = false, className }: TaskStatusBadgeProps) {
  const running = status === 'in_progress';
  return (
    <StatusTag
      status={status}
      size={size === 'sm' ? 'sm' : 'md'}
      dot
      pulse={showPulse && running}
      className={className}
    >
      {showLabel ? PROCESS_STATUS_LABELS[status] : <span className="sr-only">{PROCESS_STATUS_LABELS[status]}</span>}
    </StatusTag>
  );
}
