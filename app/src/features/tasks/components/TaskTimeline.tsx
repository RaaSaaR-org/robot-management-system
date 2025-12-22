/**
 * @file TaskTimeline.tsx
 * @description Timeline component for displaying task step progress
 * @feature tasks
 * @dependencies @/shared/components/ui, @/features/tasks/types
 */

import { cn } from '@/shared/utils/cn';
import { type TaskStep, type TaskStepStatus, TASK_STEP_STATUS_LABELS } from '../types/tasks.types';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskTimelineProps {
  /** Task steps to display */
  steps: TaskStep[];
  /** Current active step index */
  currentStepIndex?: number;
  /** Compact mode */
  compact?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STATUS ICONS
// ============================================================================

function StatusIcon({ status }: { status: TaskStepStatus }) {
  switch (status) {
    case 'completed':
      return (
        <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'in_progress':
      return (
        <div className="h-5 w-5 rounded-full border-2 border-cobalt-500 flex items-center justify-center">
          <div className="h-2.5 w-2.5 rounded-full bg-cobalt-500 animate-pulse" />
        </div>
      );
    case 'failed':
      return (
        <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'skipped':
      return (
        <svg className="h-5 w-5 text-theme-tertiary" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'pending':
    default:
      return (
        <div className="h-5 w-5 rounded-full border-2 border-theme-tertiary" />
      );
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a vertical timeline of task steps with status indicators.
 *
 * @example
 * ```tsx
 * <TaskTimeline
 *   steps={task.steps}
 *   currentStepIndex={task.currentStepIndex}
 * />
 * ```
 */
export function TaskTimeline({
  steps,
  currentStepIndex,
  compact = false,
  className,
}: TaskTimelineProps) {
  if (steps.length === 0) {
    return (
      <div className={cn('text-sm text-theme-tertiary text-center py-4', className)}>
        No steps defined for this task
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <ol className="relative">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isCurrent = index === currentStepIndex;

          return (
            <li key={step.id} className={cn('relative', !isLast && 'pb-4')}>
              {/* Connecting line */}
              {!isLast && (
                <div
                  className={cn(
                    'absolute left-[9px] top-6 w-0.5 h-full',
                    step.status === 'completed' || step.status === 'skipped'
                      ? 'bg-green-500'
                      : 'bg-theme-elevated'
                  )}
                />
              )}

              <div className="flex items-start gap-3">
                {/* Status icon */}
                <div className="relative z-10 shrink-0">
                  <StatusIcon status={step.status} />
                </div>

                {/* Content */}
                <div className={cn('flex-1 min-w-0', compact && 'py-0')}>
                  <div className="flex items-center justify-between gap-2">
                    <h4
                      className={cn(
                        'text-sm font-medium truncate',
                        isCurrent ? 'text-cobalt-500' : 'text-theme-primary',
                        step.status === 'skipped' && 'text-theme-tertiary line-through'
                      )}
                    >
                      {step.name}
                    </h4>
                    <span
                      className={cn(
                        'text-xs shrink-0',
                        step.status === 'in_progress' && 'text-cobalt-500',
                        step.status === 'completed' && 'text-green-500',
                        step.status === 'failed' && 'text-red-500',
                        step.status === 'skipped' && 'text-theme-tertiary',
                        step.status === 'pending' && 'text-theme-tertiary'
                      )}
                    >
                      {TASK_STEP_STATUS_LABELS[step.status]}
                    </span>
                  </div>

                  {!compact && step.description && (
                    <p className="text-xs text-theme-secondary mt-0.5">
                      {step.description}
                    </p>
                  )}

                  {/* Time info */}
                  {!compact && (step.startedAt || step.completedAt) && (
                    <div className="flex items-center gap-2 mt-1 text-xs text-theme-tertiary">
                      {step.startedAt && (
                        <span>
                          Started: {new Date(step.startedAt).toLocaleTimeString()}
                        </span>
                      )}
                      {step.completedAt && (
                        <span>
                          Completed: {new Date(step.completedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Error message */}
                  {step.error && (
                    <p className="text-xs text-red-500 mt-1 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
                      {step.error}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ============================================================================
// COMPACT VARIANT
// ============================================================================

/**
 * Compact horizontal progress indicator for task steps.
 */
export function TaskStepProgress({
  steps,
  className,
}: {
  steps: TaskStep[];
  className?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {steps.map((step) => (
        <div
          key={step.id}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            step.status === 'completed' && 'bg-green-500',
            step.status === 'in_progress' && 'bg-cobalt-500 animate-pulse',
            step.status === 'failed' && 'bg-red-500',
            step.status === 'skipped' && 'bg-theme-tertiary',
            step.status === 'pending' && 'bg-theme-elevated'
          )}
          title={`${step.name}: ${TASK_STEP_STATUS_LABELS[step.status]}`}
        />
      ))}
    </div>
  );
}
