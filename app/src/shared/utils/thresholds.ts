/**
 * @file thresholds.ts
 * @description System resource threshold constants for UI indicators
 */

// ============================================================================
// SYSTEM RESOURCE THRESHOLDS
// ============================================================================

/**
 * CPU usage thresholds for status indicators
 */
export const CPU_THRESHOLDS = {
  /** CPU usage above this triggers warning state */
  WARNING: 70,
  /** CPU usage above this triggers error state */
  ERROR: 90,
} as const;

/**
 * Memory usage thresholds for status indicators
 */
export const MEMORY_THRESHOLDS = {
  /** Memory usage above this triggers warning state */
  WARNING: 70,
  /** Memory usage above this triggers error state */
  ERROR: 90,
} as const;

/**
 * Battery level thresholds for status indicators
 */
export const BATTERY_THRESHOLDS = {
  /** Battery below this triggers critical warning */
  CRITICAL: 10,
  /** Battery below this triggers low warning */
  LOW: 20,
  /** Battery above this is considered good */
  GOOD: 50,
} as const;

/**
 * Get status variant based on value and thresholds
 */
export function getResourceVariant(
  value: number,
  warningThreshold: number,
  errorThreshold: number
): 'default' | 'warning' | 'error' {
  if (value >= errorThreshold) return 'error';
  if (value >= warningThreshold) return 'warning';
  return 'default';
}
