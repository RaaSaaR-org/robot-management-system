/**
 * @file format.ts
 * @description Formatting utilities for dates, numbers, and strings
 * @feature shared
 */

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
  return date.toLocaleDateString();
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
