/**
 * @file approvalFormat.ts
 * @description Pure helpers that turn approval data into labels and status tones
 * @feature approvals
 */

import type { Tone } from '@/shared/components/ui';
import type { ApprovalPriority, ApprovalRequest, ApprovalStatus, ApprovalStepStatus } from '../types';

/** Statuses a human can still act on. */
export const OPEN_STATUSES: ApprovalStatus[] = ['pending', 'in_progress', 'escalated'];

export function isOpen(status: ApprovalStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** "safety_parameter_modification" → "Safety parameter modification" */
export function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function priorityTone(priority: ApprovalPriority): Tone {
  if (priority === 'urgent' || priority === 'critical') return 'danger';
  if (priority === 'high') return 'warning';
  if (priority === 'normal') return 'info';
  return 'neutral';
}

export function statusTone(status: ApprovalStatus): Tone {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
    case 'expired':
      return 'danger';
    case 'escalated':
      return 'warning';
    case 'pending':
    case 'in_progress':
      return 'info';
    default:
      return 'neutral';
  }
}

export function stepTone(status: ApprovalStepStatus): Tone {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'awaiting') return 'warning';
  return 'neutral';
}

export interface SlaInfo {
  tone: Tone;
  label: string;
  /** Milliseconds until the deadline (negative when overdue); null once decided. */
  remainingMs: number | null;
}

function formatSpan(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Overdue → stopped, under a quarter of the SLA left → gated, otherwise neutral. */
export function slaInfo(request: Pick<ApprovalRequest, 'slaDeadline' | 'slaHours' | 'status'>, now = Date.now()): SlaInfo {
  if (!isOpen(request.status)) return { tone: 'neutral', label: 'Closed', remainingMs: null };
  const remainingMs = new Date(request.slaDeadline).getTime() - now;
  if (remainingMs < 0) return { tone: 'stopped', label: `${formatSpan(remainingMs)} overdue`, remainingMs };
  const quarter = request.slaHours * 0.25 * 3600000;
  return {
    tone: remainingMs < quarter ? 'gated' : 'neutral',
    label: `${formatSpan(remainingMs)} left`,
    remainingMs,
  };
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  return `${formatSpan(diff)} ago`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
