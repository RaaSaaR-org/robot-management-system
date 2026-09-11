/**
 * @file TaskPriorityBadge.tsx
 * @description An automation's priority as the kit's StatusTag
 * @feature processes
 */

import { StatusTag } from '@/shared/components/ui';
import { PROCESS_PRIORITY_LABELS, type ProcessPriority as TaskPriority } from '../types';
import { priorityTone } from './processActs';

export interface TaskPriorityBadgeProps {
  priority: TaskPriority;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function TaskPriorityBadge({ priority, size = 'sm', className }: TaskPriorityBadgeProps) {
  return (
    <StatusTag tone={priorityTone(priority)} size={size === 'sm' ? 'sm' : 'md'} className={className}>
      {PROCESS_PRIORITY_LABELS[priority] ?? priority}
    </StatusTag>
  );
}
