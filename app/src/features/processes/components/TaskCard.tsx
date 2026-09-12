/**
 * @file TaskCard.tsx
 * @description One automation as an interactive card (the Cards view of /processes)
 * @feature processes
 */

import { Bot } from 'lucide-react';
import { Panel, ProgressBar, RowActions, type RowActionItem } from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils/format';
import type { Process as Task } from '../types';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskPriorityBadge } from './TaskPriorityBadge';

export interface TaskCardProps {
  task: Task;
  /** Robot name to show (falls back to task.robotName, then "Unassigned") */
  robotName?: string;
  onClick?: () => void;
  /** Row-action items (Pause, Resume, Retry, Cancel) */
  actions?: RowActionItem[];
  className?: string;
}

export function TaskCard({ task, robotName, onClick, actions, className }: TaskCardProps) {
  const robot = robotName ?? task.robotName ?? (task.robotId ? task.robotId : 'Unassigned');
  return (
    <Panel interactive={Boolean(onClick)} onClick={onClick} padding="sm" className={className}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink-primary">{task.name}</div>
            <div className="truncate text-[13px] text-ink-tertiary">{task.description || 'No description'}</div>
          </div>
          {actions && actions.length > 0 && <RowActions items={actions} label={`Actions for ${task.name}`} />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskStatusBadge status={task.status} showPulse />
          <TaskPriorityBadge priority={task.priority} />
        </div>
        <ProgressBar value={task.progress} size="sm" />
        <div className="flex items-center justify-between gap-2 text-xs text-ink-tertiary">
          <span className="flex min-w-0 items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate">{robot}</span>
          </span>
          <span className="shrink-0">{formatTimeAgo(task.updatedAt)}</span>
        </div>
      </div>
    </Panel>
  );
}
