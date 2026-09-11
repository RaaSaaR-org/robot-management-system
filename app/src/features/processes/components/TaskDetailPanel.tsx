/**
 * @file TaskDetailPanel.tsx
 * @description The automation detail page body (recipe 4): PageHeader with the
 *              next natural act, a stat row, the failure note, the steps
 *              timeline and the details. Live updates come over the websocket.
 * @feature processes
 */

import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import {
  Button,
  ErrorState,
  KeyValueList,
  PageHeader,
  Panel,
  StatRow,
  StatTile,
  StatusTag,
} from '@/shared/components/ui';
import { formatDateTime, formatTimeAgo } from '@/shared/utils/format';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { useTask } from '../hooks/useTasks';
import { useProcessWebSocket } from '../hooks/useProcessWebSocket';
import {
  PROCESS_PRIORITY_LABELS,
  formatProcessDuration,
  isProcessCancellable,
  isProcessPauseable,
  isProcessResumeable,
  isProcessRetryable,
  isProcessStartable,
  type ProcessAction,
} from '../types';
import { TaskDetailSkeleton } from './TaskDetailSkeleton';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskTimeline } from './TaskTimeline';
import { runProcessAct } from './processActs';

export interface TaskDetailPanelProps {
  taskId: string;
  /** Back link target; defaults to the automations list */
  backTo?: string;
  /** @deprecated kept for callers; the PageHeader back link replaces it */
  onBack?: () => void;
  className?: string;
}

const ICON = 'h-4 w-4';

export function TaskDetailPanel({ taskId, backTo = '/processes', className }: TaskDetailPanelProps) {
  const { task, isLoading, error, refresh, startTask, pauseTask, resumeTask, cancelTask, retryTask } = useTask(taskId);
  const { robots, fetchRobots } = useRobots();
  const [pending, setPending] = useState<ProcessAction | null>(null);

  // No automation page loads the robots on its own; the robot name needs them.
  useEffect(() => {
    if (robots.length === 0) void fetchRobots();
  }, [robots.length, fetchRobots]);

  useProcessWebSocket({ processId: taskId, enabled: !!taskId });

  const robotName = useMemo(() => {
    if (task?.robotName) return task.robotName;
    if (!task?.robotId) return 'Unassigned';
    return robots.find((r) => r.id === task.robotId)?.name ?? task.robotId;
  }, [task?.robotName, task?.robotId, robots]);

  const back = { to: backTo, label: 'Automations' };

  if (!task) {
    if (isLoading || !error) {
      return (
        <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
          <PageHeader eyebrow="Operate" back={back} title="Loading…" />
          <TaskDetailSkeleton />
        </div>
      );
    }
    return (
      <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
        <PageHeader eyebrow="Operate" back={back} title="Automation not found" />
        <Panel>
          <ErrorState
            title="Couldn't load this automation"
            message={/not found|404/i.test(error) ? 'It may have been deleted, or the link is wrong.' : error}
            onRetry={() => void refresh()}
          />
        </Panel>
      </div>
    );
  }

  const act = async (action: ProcessAction) => {
    const run = { start: startTask, pause: pauseTask, resume: resumeTask, cancel: cancelTask, retry: retryTask }[action];
    try {
      // The spinner starts once the act is confirmed, not while the question is open.
      await runProcessAct(action, task, run, () => setPending(action));
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;
  const primary = isProcessStartable(task)
    ? { action: 'start' as const, label: 'Run', icon: <Play className={ICON} strokeWidth={1.75} /> }
    : isProcessPauseable(task)
      ? { action: 'pause' as const, label: 'Pause', icon: <Pause className={ICON} strokeWidth={1.75} /> }
      : isProcessResumeable(task)
        ? { action: 'resume' as const, label: 'Resume', icon: <Play className={ICON} strokeWidth={1.75} /> }
        : isProcessRetryable(task)
          ? { action: 'retry' as const, label: 'Retry', icon: <RotateCcw className={ICON} strokeWidth={1.75} /> }
          : null;

  const doneSteps = task.steps.filter((s) => s.status === 'completed').length;

  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
      <PageHeader
        eyebrow="Operate"
        back={back}
        title={task.name}
        description={task.description}
        meta={<TaskStatusBadge status={task.status} size="md" showPulse />}
        actions={
          <>
            {isProcessCancellable(task) && (
              <Button
                variant="secondary"
                leftIcon={<XCircle className={ICON} strokeWidth={1.75} />}
                isLoading={pending === 'cancel'}
                disabled={busy}
                onClick={() => void act('cancel')}
              >
                Cancel
              </Button>
            )}
            {primary && (
              <Button leftIcon={primary.icon} isLoading={pending === primary.action} disabled={busy} onClick={() => void act(primary.action)}>
                {primary.label}
              </Button>
            )}
          </>
        }
      />

      <StatRow columns={4}>
        <StatTile label="Progress" value={task.progress} unit="%" progress={task.progress} />
        <StatTile label="Steps" value={doneSteps} unit={`/ ${task.steps.length}`} hint="Completed" />
        <StatTile label="Robot" value={robotName} tone="neutral" />
        <StatTile
          label="Duration"
          value={formatProcessDuration(task.startedAt, task.completedAt)}
          hint={task.startedAt ? `Started ${formatTimeAgo(task.startedAt)}` : 'Not started'}
        />
      </StatRow>

      {task.error && (
        <Panel variant="inset" padding="sm" role="alert" className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StatusTag status="failed" size="sm" />
            <span className="text-sm font-semibold text-signal-stopped">The automation stopped</span>
          </div>
          <p className="text-sm text-ink-secondary">{task.error}</p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <Panel.Header title="Steps" description={task.steps.length ? `${doneSteps} of ${task.steps.length} done` : undefined} />
          <Panel.Body>
            <TaskTimeline steps={task.steps} currentStepIndex={task.currentStepIndex} />
          </Panel.Body>
        </Panel>
        <Panel>
          <Panel.Header title="Details" />
          <Panel.Body>
            <KeyValueList
              columns={1}
              items={[
                { label: 'ID', value: task.id, mono: true },
                { label: 'Robot ID', value: task.robotId, mono: true },
                { label: 'Priority', value: PROCESS_PRIORITY_LABELS[task.priority] ?? task.priority },
                { label: 'Created', value: formatDateTime(task.createdAt) },
                { label: 'Started', value: task.startedAt ? formatDateTime(task.startedAt) : null },
                { label: 'Completed', value: task.completedAt ? formatDateTime(task.completedAt) : null },
                { label: 'Updated', value: formatDateTime(task.updatedAt) },
                ...(task.createdBy ? [{ label: 'Created by', value: task.createdBy }] : []),
              ]}
            />
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
