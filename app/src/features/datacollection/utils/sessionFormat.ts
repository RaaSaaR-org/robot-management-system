/**
 * @file sessionFormat.ts
 * @description Display helpers for teleoperation sessions: the human name
 *              shown first (task text, else input type + created date) and a
 *              short relative time.
 * @feature datacollection
 */

import { formatDateTime } from '@/shared/utils/format';
import type { TeleoperationSession } from '../types/datacollection.types';
import { TELEOPERATION_TYPE_LABELS } from '../types/datacollection.types';

/** The session's human name: its task text, else "‹Input› session · ‹date›". */
export function sessionName(s: Pick<TeleoperationSession, 'languageInstr' | 'type' | 'createdAt'>): string {
  const task = s.languageInstr?.trim();
  if (task) return task.charAt(0).toUpperCase() + task.slice(1);
  const date = formatDateTime(s.createdAt, { month: 'short', day: 'numeric' });
  return `${TELEOPERATION_TYPE_LABELS[s.type] ?? 'Recording'} session · ${date}`;
}

/** "12s ago", "5m ago", "3h ago", "2d ago", else a short date. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDateTime(iso, { year: 'numeric', month: 'short', day: 'numeric' });
}
