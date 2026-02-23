/**
 * @file zoneUtils.ts
 * @description Zone boundary utilities for real-time robot position tracking
 * @feature robot
 */

import type { ZoneBounds } from './types.js';

/**
 * Check if a point (x, y) falls within zone bounds.
 */
export function isPointInZone(x: number, y: number, bounds: ZoneBounds): boolean {
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}
