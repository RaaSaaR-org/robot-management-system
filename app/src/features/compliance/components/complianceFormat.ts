/**
 * @file complianceFormat.ts
 * @description Shared formatting for the compliance sections: tones for the
 *              compliance-only status words, date and relative-date strings,
 *              and humanised event-type labels. Severities and the shared
 *              status words (closed, in_progress, overdue …) come from the
 *              kit's statusTone().
 * @feature compliance
 */

import { statusTone, type StatusToneName } from '@/shared/components/ui';
import type { ComplianceEventType, ComplianceSeverity } from '../types';

/**
 * Compliance-only vocabulary the kit does not know, plus `active`, which here
 * is a legal hold in force (needs attention), not a healthy running thing.
 */
const DOMAIN_TONES: Record<string, StatusToneName> = {
  compliant: 'success',
  valid: 'success',
  current: 'success',
  verified: 'success',
  open: 'warning',
  at_risk: 'warning',
  due_soon: 'warning',
  expiring_soon: 'warning',
  review_needed: 'warning',
  expired: 'danger',
  update_required: 'danger',
  broken: 'danger',
  not_started: 'neutral',
  not_applicable: 'neutral',
  released: 'neutral',
  active: 'warning',
};

/** Tone for a compliance-domain status (deadline, gap, document, inspection …). */
export function complianceTone(status: string | null | undefined): StatusToneName {
  if (!status) return 'neutral';
  return DOMAIN_TONES[status] ?? statusTone(status);
}

/** Readable label for a domain status: `not_applicable` → "Not applicable". */
export function humanize(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  if (value === 'not_applicable') return 'N/A';
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const EVENT_TYPE_LABELS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI decision',
  safety_action: 'Safety action',
  command_execution: 'Command execution',
  system_event: 'System event',
  access_audit: 'Access audit',
};

export const EVENT_TYPE_OPTIONS = (Object.keys(EVENT_TYPE_LABELS) as ComplianceEventType[]).map((value) => ({
  value,
  label: EVENT_TYPE_LABELS[value],
}));

export const SEVERITIES: ComplianceSeverity[] = ['critical', 'error', 'warning', 'info', 'debug'];

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type as ComplianceEventType] ?? humanize(type);
}

/** Local date and time, or "—" for an empty value. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Local date only, or "—". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** "in 12 days", "3 days ago", "today" from a day count relative to now. */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) return '—';
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** "5m ago", "3h ago", "2d ago". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
