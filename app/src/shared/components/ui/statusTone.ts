/**
 * @file statusTone.ts
 * @description Maps any domain status string (robot, job, deployment, alert …)
 *              onto one of the kit's tones, and turns it into a readable label.
 *              The single source for "what colour is this status" — pages never
 *              pick a colour for a status themselves.
 * @feature shared
 */

import type { BaseTone } from './styles';

/** Tones a status can resolve to. */
export type StatusToneName = Exclude<BaseTone, 'accent'>;

/**
 * The contract's map. Amber (`warning`) means unknown or needs attention, red
 * (`danger`) means stopped or a fault that is true now — so an aborted run is
 * amber, while an overdue regulatory notification (a missed legal deadline) is
 * red. Grouped by domain inside each tone.
 */
const STATUS_GROUPS: Record<StatusToneName, string[]> = {
  success: [
    'online',
    'active',
    'running',
    'completed',
    'succeeded',
    'healthy',
    'deployed',
    'approved',
    'connected',
    'ready',
    'published',
    // runs · deployments · incidents · notifications
    'done',
    'production',
    'resolved',
    'closed',
    'sent',
    'acknowledged',
  ],
  info: [
    'busy',
    'queued',
    'in_progress',
    'training',
    'recording',
    'syncing',
    'rolling_out',
    // A2A tasks · deployments · incidents (being worked on)
    'working',
    'submitted',
    'canary',
    'investigating',
    'contained',
  ],
  warning: [
    'charging',
    'degraded',
    'paused',
    'pending',
    'pending_review',
    'warning',
    'stale',
    'draft_review',
    // runs · A2A tasks · deployments · incidents · severities · notifications
    'aborted',
    'abandoned',
    'input_required',
    'rolling_back',
    'rolled_back',
    'detected',
    'medium',
  ],
  danger: [
    'error',
    'failed',
    'stopped',
    'estop',
    'e_stop',
    'critical',
    'rejected',
    'blocked',
    'fault',
    'high',
    // notifications: a missed legal deadline is a fault, not a reminder
    'overdue',
  ],
  neutral: [
    'offline',
    'idle',
    'draft',
    'archived',
    'cancelled',
    'unknown',
    // severities · deployments · A2A tasks
    'low',
    'info',
    'deprecated',
    'canceled',
  ],
};

/** Case- and separator-insensitive key: "In Progress", "in-progress", "IN_PROGRESS" → "in_progress". */
export function normalizeStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.]+/g, '_');
}

const STATUS_MAP: Map<string, StatusToneName> = new Map(
  (Object.entries(STATUS_GROUPS) as [StatusToneName, string[]][]).flatMap(([tone, names]) =>
    names.map((name) => [normalizeStatus(name), tone] as const),
  ),
);

/**
 * The tone for a status string. Unknown or empty statuses are `neutral`.
 *
 * @example
 * statusTone('online')        // 'success'
 * statusTone('In-Progress')   // 'info'
 * statusTone('E-Stop')        // 'danger'
 * statusTone('whatever')      // 'neutral'
 */
export function statusTone(status: string | null | undefined): StatusToneName {
  if (!status) return 'neutral';
  return STATUS_MAP.get(normalizeStatus(status)) ?? 'neutral';
}

/**
 * A readable label for a status string: separators become spaces, sentence case.
 * `e-stop`/`estop` keep their conventional spelling.
 *
 * @example
 * humanizeStatus('in_progress') // 'In progress'
 * humanizeStatus('ROLLING-OUT') // 'Rolling out'
 */
export function humanizeStatus(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  const key = normalizeStatus(status);
  if (key === 'estop' || key === 'e_stop') return 'E-stop';
  const words = key.split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
