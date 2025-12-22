/**
 * @file TaskCard.tsx
 * @description Card component displaying task summary information
 * @feature tasks
 * @dependencies @/shared/components/ui, @/features/tasks/types
 */

import { Card, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskPriorityBadge } from './TaskPriorityBadge';
import {
  type Task,
  isTaskPauseable,
  isTaskResumeable,
  isTaskCancellable,
  formatTaskDuration,
} from '../types/tasks.types';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskCardProps {
  /** Task data */
  task: Task;
  /** Click handler */
  onClick?: () => void;
  /** Whether this card is selected */
  selected?: boolean;
  /** Compact mode for list views */
  compact?: boolean;
  /** Show action buttons */
  showActions?: boolean;
  /** Pause handler */
  onPause?: () => void;
  /** Resume handler */
  onResume?: () => void;
  /** Cancel handler */
  onCancel?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// PROGRESS BAR COMPONENT
// ============================================================================

function ProgressBar({ progress, className }: { progress: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full rounded-full glass-subtle overflow-hidden', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500 bg-gradient-to-r',
          progress === 100
            ? 'from-green-400 to-turquoise-400'
            : 'from-cobalt-400 to-cobalt-500'
        )}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// ============================================================================
// TASK ICON COMPONENT
// ============================================================================

function TaskIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 text-cobalt-400', className)}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Card component for displaying task summary information.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <TaskCard task={task} onClick={() => selectTask(task.id)} />
 *
 * // With actions
 * <TaskCard
 *   task={task}
 *   showActions
 *   onPause={handlePause}
 *   onCancel={handleCancel}
 * />
 * ```
 */
export function TaskCard({
  task,
  onClick,
  selected = false,
  compact = false,
  showActions = false,
  onPause,
  onResume,
  onCancel,
  className,
}: TaskCardProps) {
  const isFailed = task.status === 'failed';
  const isPaused = task.status === 'paused';

  return (
    <Card
      interactive={!!onClick}
      className={cn(
        // Glass selection state with softer ring
        selected && 'ring-2 ring-cobalt-400/50 border-cobalt-400/30',
        // Status-based border colors
        isFailed && !selected && 'border-red-400/30',
        isPaused && !selected && 'border-yellow-400/30',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-pressed={onClick ? selected : undefined}
    >
      {/* Header: Icon + Name + Badges */}
      <div className="flex items-start gap-4">
        {/* Task icon in glass container */}
        <div className="glass-subtle p-2.5 rounded-lg shrink-0">
          <TaskIcon />
        </div>

        {/* Name and robot */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="card-title truncate">{task.name}</h3>
            <div className="flex items-center gap-1.5 shrink-0">
              <TaskPriorityBadge priority={task.priority} size="sm" />
              <TaskStatusBadge status={task.status} size="sm" showPulse />
            </div>
          </div>
          <p className="card-meta mt-0.5">{task.robotName}</p>
        </div>
      </div>

      {/* Full mode: Progress + Details */}
      {!compact && (
        <>
          {/* Progress section */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="card-label">Progress</span>
              <span className="text-sm font-medium text-theme-primary">{task.progress}%</span>
            </div>
            <ProgressBar progress={task.progress} />
          </div>

          {/* Footer metrics */}
          <div className="mt-4 flex items-center justify-between">
            <span className="card-meta">
              {formatTaskDuration(task.startedAt, task.completedAt)}
            </span>
            {task.steps.length > 0 && (
              <span className="card-meta">
                Step {task.steps.filter((s) => s.status === 'completed').length}/{task.steps.length}
              </span>
            )}
          </div>

          {/* Error message */}
          {task.error && (
            <div className="mt-3 text-sm text-red-400 glass-subtle bg-red-500/10 border-red-400/20 rounded-lg px-3 py-2">
              {task.error}
            </div>
          )}

          {/* Action buttons */}
          {showActions && (
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-glass-subtle">
              {isTaskPauseable(task) && onPause && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPause();
                  }}
                >
                  Pause
                </Button>
              )}
              {isTaskResumeable(task) && onResume && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResume();
                  }}
                >
                  Resume
                </Button>
              )}
              {isTaskCancellable(task) && onCancel && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* Compact mode: inline metrics */}
      {compact && (
        <div className="flex items-center gap-4 ml-auto shrink-0">
          <span className="card-meta">{task.progress}%</span>
          <span className="card-meta">
            {formatTaskDuration(task.startedAt, task.completedAt)}
          </span>
        </div>
      )}
    </Card>
  );
}
