/**
 * @file TaskDetailPanel.tsx
 * @description Comprehensive panel displaying task details, steps, and controls
 * @feature tasks
 * @dependencies @/shared/components/ui, @/features/tasks/hooks
 */

import { Card, Button, Spinner } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskPriorityBadge } from './TaskPriorityBadge';
import { TaskTimeline } from './TaskTimeline';
import { useTask } from '../hooks/useTasks';
import {
  formatTaskDuration,
  isTaskPauseable,
  isTaskResumeable,
  isTaskCancellable,
  isTaskRetryable,
} from '../types/tasks.types';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskDetailPanelProps {
  /** Task ID to display */
  taskId: string;
  /** Callback when back button is clicked */
  onBack?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function StatCard({
  label,
  value,
  icon,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  variant?: 'default' | 'warning' | 'error';
}) {
  return (
    <div
      className={cn(
        'p-4 rounded-brand border',
        variant === 'error' && 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20',
        variant === 'warning' &&
          'border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20',
        variant === 'default' && 'border-theme bg-theme-card'
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'p-2 rounded-lg',
            variant === 'error' && 'bg-red-100 text-red-600 dark:bg-red-800 dark:text-red-400',
            variant === 'warning' &&
              'bg-yellow-100 text-yellow-600 dark:bg-yellow-800 dark:text-yellow-400',
            variant === 'default' && 'bg-theme-elevated text-theme-secondary'
          )}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm text-theme-secondary">{label}</p>
          <p className="text-lg font-semibold text-theme-primary">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  value,
  max = 100,
  variant = 'default',
  label,
}: {
  value: number;
  max?: number;
  variant?: 'default' | 'warning' | 'error' | 'success';
  label?: string;
}) {
  const percentage = Math.min(100, (value / max) * 100);

  const colorClass = {
    default: 'bg-cobalt-500',
    success: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  }[variant];

  return (
    <div>
      {label && (
        <div className="flex justify-between mb-1">
          <span className="text-sm text-theme-secondary">{label}</span>
          <span className="text-sm font-medium text-theme-primary">{value}%</span>
        </div>
      )}
      <div className="h-2 bg-theme-elevated rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-300 rounded-full', colorClass)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// ICONS
// ============================================================================

const RobotIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
    />
  </svg>
);

const ProgressIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

const ClockIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const CalendarIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Comprehensive panel displaying task details, progress, and controls.
 *
 * @example
 * ```tsx
 * function TaskDetailPage() {
 *   const { id } = useParams();
 *   const navigate = useNavigate();
 *
 *   return (
 *     <TaskDetailPanel
 *       taskId={id!}
 *       onBack={() => navigate('/tasks')}
 *     />
 *   );
 * }
 * ```
 */
export function TaskDetailPanel({
  taskId,
  onBack,
  className,
}: TaskDetailPanelProps) {
  const {
    task,
    isLoading,
    isExecuting,
    error,
    refresh,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
  } = useTask(taskId);

  // Loading state
  if (isLoading && !task) {
    return (
      <div className={cn('flex items-center justify-center py-20', className)}>
        <Spinner size="lg" color="cobalt" label="Loading task details..." />
      </div>
    );
  }

  // Error state
  if (error && !task) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-20 text-center', className)}>
        <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-medium text-theme-primary">Failed to load task</h3>
        <p className="mt-1 text-sm text-theme-secondary">{error}</p>
        <div className="flex items-center gap-3 mt-4">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              Go Back
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => refresh()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!task) return null;

  const getProgressVariant = () => {
    if (task.status === 'failed') return 'error';
    if (task.status === 'paused') return 'warning';
    if (task.status === 'completed') return 'success';
    return 'default';
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back
            </Button>
          )}

          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-theme-elevated">
              <svg
                className="h-7 w-7 text-cobalt-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-theme-primary">{task.name}</h1>
              <p className="text-sm text-theme-secondary">{task.description || 'No description'}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} showPulse />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Assigned Robot"
          value={task.robotName || task.robotId}
          icon={<RobotIcon />}
        />
        <StatCard
          label="Progress"
          value={`${task.progress}%`}
          icon={<ProgressIcon />}
          variant={task.status === 'failed' ? 'error' : task.status === 'paused' ? 'warning' : 'default'}
        />
        <StatCard
          label="Duration"
          value={formatTaskDuration(task.startedAt, task.completedAt)}
          icon={<ClockIcon />}
        />
        <StatCard
          label="Created"
          value={new Date(task.createdAt).toLocaleDateString()}
          icon={<CalendarIcon />}
        />
      </div>

      {/* Progress Bar */}
      <Card>
        <Card.Header>
          <h2 className="text-lg font-medium text-theme-primary">Task Progress</h2>
        </Card.Header>
        <Card.Body className="space-y-4">
          <ProgressBar
            value={task.progress}
            variant={getProgressVariant()}
            label="Overall Progress"
          />
          {task.steps.length > 0 && (
            <p className="text-sm text-theme-secondary">
              Steps completed: {task.steps.filter((s) => s.status === 'completed').length} of {task.steps.length}
            </p>
          )}
        </Card.Body>
      </Card>

      {/* Error Display */}
      {task.error && (
        <Card className="border-red-300 dark:border-red-700">
          <Card.Body>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <svg
                  className="h-5 w-5 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-red-600 dark:text-red-400">Task Failed</h3>
                <p className="text-sm text-red-500 mt-1">{task.error}</p>
              </div>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* Task Steps Timeline */}
      {task.steps.length > 0 && (
        <Card>
          <Card.Header>
            <h2 className="text-lg font-medium text-theme-primary">Steps</h2>
          </Card.Header>
          <Card.Body>
            <TaskTimeline steps={task.steps} currentStepIndex={task.currentStepIndex} />
          </Card.Body>
        </Card>
      )}

      {/* Actions */}
      <Card>
        <Card.Header>
          <h2 className="text-lg font-medium text-theme-primary">Actions</h2>
        </Card.Header>
        <Card.Body>
          <div className="flex flex-wrap gap-3">
            {isTaskPauseable(task) && (
              <Button
                variant="secondary"
                onClick={() => pauseTask()}
                disabled={isExecuting}
              >
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Pause Task
              </Button>
            )}

            {isTaskResumeable(task) && (
              <Button
                variant="primary"
                onClick={() => resumeTask()}
                disabled={isExecuting}
              >
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Resume Task
              </Button>
            )}

            {isTaskRetryable(task) && (
              <Button
                variant="primary"
                onClick={() => retryTask()}
                disabled={isExecuting}
              >
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Retry Task
              </Button>
            )}

            {isTaskCancellable(task) && (
              <Button
                variant="destructive"
                onClick={() => cancelTask()}
                disabled={isExecuting}
              >
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                Cancel Task
              </Button>
            )}

            <Button variant="outline" onClick={() => refresh()} disabled={isExecuting}>
              <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </Button>
          </div>

          {isExecuting && (
            <div className="mt-4 flex items-center gap-2 text-sm text-theme-secondary">
              <Spinner size="sm" />
              <span>Executing action...</span>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Task Info */}
      <Card>
        <Card.Header>
          <h2 className="text-lg font-medium text-theme-primary">Task Information</h2>
        </Card.Header>
        <Card.Body>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-theme-secondary">Task ID</dt>
              <dd className="text-sm font-mono text-theme-primary">{task.id}</dd>
            </div>
            <div>
              <dt className="text-sm text-theme-secondary">Robot ID</dt>
              <dd className="text-sm font-mono text-theme-primary">{task.robotId}</dd>
            </div>
            {task.createdBy && (
              <div>
                <dt className="text-sm text-theme-secondary">Created By</dt>
                <dd className="text-sm text-theme-primary">{task.createdBy}</dd>
              </div>
            )}
            {task.estimatedDuration && (
              <div>
                <dt className="text-sm text-theme-secondary">Estimated Duration</dt>
                <dd className="text-sm text-theme-primary">
                  {Math.floor(task.estimatedDuration / 60)}m {task.estimatedDuration % 60}s
                </dd>
              </div>
            )}
            <div>
              <dt className="text-sm text-theme-secondary">Created At</dt>
              <dd className="text-sm text-theme-primary">
                {new Date(task.createdAt).toLocaleString()}
              </dd>
            </div>
            {task.startedAt && (
              <div>
                <dt className="text-sm text-theme-secondary">Started At</dt>
                <dd className="text-sm text-theme-primary">
                  {new Date(task.startedAt).toLocaleString()}
                </dd>
              </div>
            )}
            {task.completedAt && (
              <div>
                <dt className="text-sm text-theme-secondary">Completed At</dt>
                <dd className="text-sm text-theme-primary">
                  {new Date(task.completedAt).toLocaleString()}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-sm text-theme-secondary">Last Updated</dt>
              <dd className="text-sm text-theme-primary">
                {new Date(task.updatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card.Body>
      </Card>
    </div>
  );
}
