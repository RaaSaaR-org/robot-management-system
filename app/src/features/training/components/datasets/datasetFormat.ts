/**
 * @file datasetFormat.ts
 * @description Formatting helpers shared by the dataset list, card and episode browser
 * @feature training
 */

import { UI_DATE_LOCALE } from '@/shared/utils/format';

/** 42 → "42s", 125 → "2m 5s", 3900 → "1h 5m". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/** Thousands separators in the UI locale. */
export function formatCount(value: number): string {
  return value.toLocaleString(UI_DATE_LOCALE);
}

/** "just now", "5 min ago", "3 h ago", "4 d ago", else a date. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 14) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(UI_DATE_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** First 8 characters of an id, for the secondary line. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
