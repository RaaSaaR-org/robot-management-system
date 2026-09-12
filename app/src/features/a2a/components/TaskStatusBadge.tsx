/**
 * @file TaskStatusBadge.tsx
 * @description A2A task state as a kit StatusTag (thin wrapper, keeps the old export)
 * @feature a2a
 */

import { StatusTag, type StatusToneName } from '@/shared/components/ui';
import { A2A_TASK_STATE_LABELS, type A2ATaskState } from '../types';

/** A2A states the shared status map does not know, mapped to their tone. */
const TASK_TONE: Record<A2ATaskState, StatusToneName> = {
  submitted: 'info',
  working: 'info',
  input_required: 'warning',
  completed: 'success',
  canceled: 'neutral',
  failed: 'danger',
  unknown: 'neutral',
};

const ACTIVE: string[] = ['submitted', 'working', 'input_required'];

/**
 * Task state tag; active states pulse.
 */
export function TaskStatusBadge({ state, className }: { state: string; className?: string }) {
  const key = state as A2ATaskState;
  const label = A2A_TASK_STATE_LABELS[key] ?? state;
  return (
    <StatusTag tone={TASK_TONE[key] ?? 'neutral'} dot pulse={ACTIVE.includes(state)} className={className}>
      {label.charAt(0) + label.slice(1).toLowerCase()}
    </StatusTag>
  );
}
