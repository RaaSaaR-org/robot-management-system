/**
 * @file format.ts
 * @description Formatting utilities for dates, numbers, and strings
 * @feature shared
 */

/**
 * Explicit locale for all user-facing date/time formatting.
 *
 * The UI copy is English, so date formatting must not pick up the OS locale
 * (e.g. German "11. Juli") via bare toLocaleDateString(). 'en-US' matches the
 * locale the app already uses most in explicit call sites.
 *
 * Numbers follow the same rule ("69,460", not "69.460"): use `formatNumber`,
 * `formatDate`, `formatTime` and `formatDateTime` below rather than a bare
 * `toLocale*String()` — `__tests__/localeGuard.test.ts` fails on a bare call.
 */
export const UI_DATE_LOCALE = 'en-US';

/** Anything `new Date()` takes. */
export type DateInput = string | number | Date;

/**
 * Format a date/time with the app's fixed English locale
 * (e.g. "Jul 11, 2026, 01:15 PM").
 * @param value - ISO string, epoch ms or Date (null/undefined/'' renders "-")
 * @param options - Optional Intl options to override the default parts
 * @returns Formatted date/time string, or "-" when no date is given
 */
export function formatDateTime(
  value: DateInput | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '-';
  return new Date(value).toLocaleString(
    UI_DATE_LOCALE,
    options ?? {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}

/**
 * Format a calendar date with the app's fixed English locale, month spelled
 * out so it cannot be read as day-first or month-first (e.g. "Nov 13, 2026").
 * @param value - ISO string, epoch ms or Date (null/undefined/'' renders "-")
 * @param options - Optional Intl options to override the default parts
 */
export function formatDate(
  value: DateInput | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '-';
  return new Date(value).toLocaleDateString(
    UI_DATE_LOCALE,
    options ?? { year: 'numeric', month: 'short', day: 'numeric' }
  );
}

/**
 * Format a time of day with the app's fixed English locale (e.g. "1:15:02 PM").
 * @param value - ISO string, epoch ms or Date (null/undefined/'' renders "-")
 * @param options - Optional Intl options to override the default parts
 */
export function formatTime(
  value: DateInput | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '-';
  return new Date(value).toLocaleTimeString(UI_DATE_LOCALE, options);
}

/**
 * Format a number with the app's fixed English locale: "69,460", never the
 * browser's "69.460".
 * @param value - Number to format
 * @param options - Optional Intl.NumberFormat options
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(UI_DATE_LOCALE, options);
}

/**
 * Format a date string as relative time (e.g., "5m ago", "2h ago")
 * @param dateString - ISO date string to format
 * @returns Human-readable relative time string
 */
export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

/**
 * Format a number as a percentage string
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted percentage string
 */
export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a number with units (e.g., "25.5°C", "1.5 m/s")
 * @param value - Number to format
 * @param unit - Unit string to append
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string with unit
 */
export function formatWithUnit(value: number, unit: string, decimals = 1): string {
  return `${value.toFixed(decimals)}${unit}`;
}
