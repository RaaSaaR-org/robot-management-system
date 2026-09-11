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
  ],
  info: ['busy', 'queued', 'in_progress', 'training', 'recording', 'syncing', 'rolling_out'],
  warning: ['charging', 'degraded', 'paused', 'pending', 'pending_review', 'warning', 'stale', 'draft_review'],
  danger: ['error', 'failed', 'stopped', 'estop', 'e_stop', 'critical', 'rejected', 'blocked', 'fault'],
  neutral: ['offline', 'idle', 'draft', 'archived', 'cancelled', 'unknown'],
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
