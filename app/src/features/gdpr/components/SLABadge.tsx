/**
 * @file SLABadge.tsx
 * @description SLA state of an open GDPR request as a kit StatusTag
 * @feature gdpr
 */

import { StatusTag, type StatusTagTone } from '@/shared/components/ui';
import type { GDPRRequest } from '../types';
import { getDaysUntilDeadline, isRequestOverdue } from '../types';

export interface SLABadgeProps {
  request: GDPRRequest;
  className?: string;
}

const CLOSED = ['completed', 'cancelled', 'rejected'];

/** Tone and label of a request's SLA, or null once the request is closed. */
export function slaState(request: GDPRRequest): { tone: StatusTagTone; label: string } | null {
  if (CLOSED.includes(request.status)) return null;
  const days = getDaysUntilDeadline(request);
  if (isRequestOverdue(request)) return { tone: 'stopped', label: `${Math.abs(days)} d overdue` };
  const label = `${days} ${days === 1 ? 'day' : 'days'} left`;
  if (days <= 7) return { tone: 'gated', label };
  return { tone: 'neutral', label };
}

/** Overdue → stopped, due within 7 days → gated, otherwise neutral. */
export function SLABadge({ request, className }: SLABadgeProps) {
  const state = slaState(request);
  if (!state) return <span className="text-[13px] text-ink-muted">—</span>;
  return <StatusTag tone={state.tone} className={className}>{state.label}</StatusTag>;
}
