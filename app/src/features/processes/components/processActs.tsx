/**
 * @file processActs.tsx
 * @description Shared helpers for automations: the priority tone, the row-action
 *              items per status, and one act runner (confirm where needed, toast
 *              for every result) used by the list, the cards and the detail page.
 * @feature processes
 */

import { Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import { confirm, errorMessage, toast, type RowActionItem, type StatusToneName } from '@/shared/components/ui';
import {
  isProcessCancellable,
  isProcessPauseable,
  isProcessResumeable,
  isProcessRetryable,
  isProcessStartable,
  type Process,
  type ProcessAction,
  type ProcessPriority,
} from '../types';

/** critical -> danger, high -> warning, everything else neutral. */
export function priorityTone(priority: ProcessPriority | string): StatusToneName {
  if (priority === 'critical' || priority === 'urgent') return 'danger';
  if (priority === 'high') return 'warning';
  return 'neutral';
}

const ACT_COPY: Record<ProcessAction, { ok: string; fail: string }> = {
  start: { ok: 'Automation started', fail: "Couldn't start automation" },
  pause: { ok: 'Automation paused', fail: "Couldn't pause automation" },
  resume: { ok: 'Automation resumed', fail: "Couldn't resume automation" },
  cancel: { ok: 'Automation cancelled', fail: "Couldn't cancel automation" },
  retry: { ok: 'Automation restarted', fail: "Couldn't retry automation" },
};

/** Asks first for the acts that send, stop or restart a robot; pause/resume just run. */
async function confirmAct(action: ProcessAction, task: Process): Promise<boolean> {
  if (action === 'start') {
    return confirm({
      title: `Run ${task.name}?`,
      description: 'A robot picks up the first step right away.',
      confirmLabel: 'Run',
    });
  }
  if (action === 'cancel') {
    return confirm({
      title: `Cancel ${task.name}?`,
      description: 'The robot stops after the current step. You can retry the automation later.',
      confirmLabel: 'Cancel automation',
      cancelLabel: 'Keep running',
      tone: 'danger',
    });
  }
  if (action === 'retry') {
    return confirm({
      title: `Retry ${task.name}?`,
      description: 'The robot starts again from the step that stopped.',
      confirmLabel: 'Retry',
    });
  }
  return true;
}

/**
 * Runs one act with the shared confirm + toast behaviour.
 * Returns true when the act ran and succeeded.
 */
export async function runProcessAct(
  action: ProcessAction,
  task: Process,
  run: () => Promise<unknown>,
  /** Called once the act is confirmed, right before it runs (e.g. to show a spinner) */
  onStart?: () => void,
): Promise<boolean> {
  if (!(await confirmAct(action, task))) return false;
  onStart?.();
  try {
    await run();
    toast.success(ACT_COPY[action].ok, { description: task.name });
    return true;
  } catch (err) {
    toast.error(ACT_COPY[action].fail, { description: errorMessage(err) });
    return false;
  }
}

const iconCls = 'h-4 w-4';

/** The acts available for a task's status, in menu order (Cancel last, danger). */
export function processActionItems(
  task: Process,
  onAct: (action: ProcessAction, task: Process) => void,
): RowActionItem[] {
  const items: RowActionItem[] = [];
  if (isProcessStartable(task)) {
    items.push({ label: 'Run', icon: <Play className={iconCls} strokeWidth={1.75} />, onSelect: () => onAct('start', task) });
  }
  if (isProcessPauseable(task)) {
    items.push({ label: 'Pause', icon: <Pause className={iconCls} strokeWidth={1.75} />, onSelect: () => onAct('pause', task) });
  }
  if (isProcessResumeable(task)) {
    items.push({ label: 'Resume', icon: <Play className={iconCls} strokeWidth={1.75} />, onSelect: () => onAct('resume', task) });
  }
  if (isProcessRetryable(task)) {
    items.push({ label: 'Retry', icon: <RotateCcw className={iconCls} strokeWidth={1.75} />, onSelect: () => onAct('retry', task) });
  }
  if (isProcessCancellable(task)) {
    items.push({
      label: 'Cancel',
      icon: <XCircle className={iconCls} strokeWidth={1.75} />,
      tone: 'danger',
      separatorBefore: items.length > 0,
      onSelect: () => onAct('cancel', task),
    });
  }
  return items;
}
