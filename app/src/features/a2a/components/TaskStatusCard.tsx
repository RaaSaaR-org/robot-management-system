/**
 * @file TaskStatusCard.tsx
 * @description Task status display card
 * @feature a2a
 */

import { memo } from 'react';
import { UI_DATE_LOCALE, cn } from '@/shared/utils';
import { Card } from '@/shared/components/ui/Card';
import type { A2ATask } from '../types';
import {
  A2A_TASK_STATE_LABELS,
  A2A_TASK_STATE_COLORS,
  getMessageText,
  getEffectiveTaskState,
  isErrorText,
  formatErrorText,
} from '../types';

interface TaskStatusCardProps {
  task: A2ATask;
  className?: string;
  onClick?: () => void;
}

/**
 * Get status indicator styles - using brand colors
 */
function getStatusStyles(state: string): { bg: string; text: string; dot: string } {
  const color = A2A_TASK_STATE_COLORS[state as keyof typeof A2A_TASK_STATE_COLORS] || 'default';

  const styles = {
    default: {
      bg: 'glass-subtle',
      text: 'text-theme-secondary',
      dot: 'bg-gray-400',
    },
    info: {
      bg: 'bg-primary-50/50 dark:bg-primary-900/20',
      text: 'text-primary-600 dark:text-primary-400',
      dot: 'bg-primary-500',
    },
    warning: {
      bg: 'bg-amber-50/50 dark:bg-amber-900/20',
      text: 'text-amber-600 dark:text-amber-400',
      dot: 'bg-amber-500',
    },
    success: {
      bg: 'bg-green-50/50 dark:bg-green-900/20',
      text: 'text-green-600 dark:text-green-400',
      dot: 'bg-accent-500',
    },
    error: {
      bg: 'bg-red-50/50 dark:bg-red-900/20',
      text: 'text-red-600 dark:text-red-400',
      dot: 'bg-red-500',
    },
  };

  return styles[color];
}

/**
 * Task status card component
 */
export const TaskStatusCard = memo(function TaskStatusCard({
  task,
  className,
  onClick,
}: TaskStatusCardProps) {
  // Effective state: "completed" rows carrying an error-shaped result render as failed
  const effectiveState = getEffectiveTaskState(task);
  const statusStyles = getStatusStyles(effectiveState);
  const statusLabel = A2A_TASK_STATE_LABELS[effectiveState] || effectiveState;
  const isActive = ['submitted', 'working'].includes(effectiveState);
  const messageText = task.status.message ? getMessageText(task.status.message) : '';
  const isErrorResult = effectiveState === 'failed' && isErrorText(messageText);

  return (
    <Card
      variant="glass"
      interactive={!!onClick}
      noPadding
      className={cn(
        'p-4 transition-all duration-300',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
              statusStyles.bg,
              statusStyles.text
            )}
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                statusStyles.dot,
                isActive && 'animate-pulse'
              )}
            />
            {statusLabel}
          </span>
        </div>

        {/* Task ID */}
        <span className="text-xs text-theme-muted font-mono glass-subtle px-2 py-0.5 rounded">
          {task.id.slice(0, 8)}
        </span>
      </div>

      {/* Status message preview — error results render as a styled error, not raw JSON */}
      {task.status.message && (
        isErrorResult ? (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-50/50 dark:bg-red-900/20 border border-red-200/60 dark:border-red-800/50">
            <p className="text-sm text-red-600 dark:text-red-400 line-clamp-3 break-words">
              <span className="font-medium">Error: </span>
              {formatErrorText(messageText)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-theme-secondary line-clamp-2 mb-3">
            {messageText}
          </p>
        )
      )}

      {/* Artifacts count */}
      {task.artifacts && task.artifacts.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-theme-tertiary">
          <span className="uppercase tracking-wider">Artifacts</span>
          <span className="font-medium glass-subtle px-2 py-0.5 rounded-full">{task.artifacts.length}</span>
        </div>
      )}

      {/* Timestamps */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-glass-subtle text-xs text-theme-muted">
        {task.createdAt && (
          <span>Created: {new Date(task.createdAt).toLocaleTimeString(UI_DATE_LOCALE)}</span>
        )}
        {task.status.timestamp && (
          <span>Updated: {new Date(task.status.timestamp).toLocaleTimeString(UI_DATE_LOCALE)}</span>
        )}
      </div>
    </Card>
  );
});

/**
 * Compact task status badge
 */
export const TaskStatusBadge = memo(function TaskStatusBadge({
  state,
  className,
}: {
  state: string;
  className?: string;
}) {
  const statusStyles = getStatusStyles(state);
  const statusLabel = A2A_TASK_STATE_LABELS[state as keyof typeof A2A_TASK_STATE_LABELS] || state;
  const isActive = ['submitted', 'working'].includes(state);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
        statusStyles.bg,
        statusStyles.text,
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          statusStyles.dot,
          isActive && 'animate-pulse'
        )}
      />
      {statusLabel}
    </span>
  );
});
