/**
 * @file twinPlaceGeometry.ts
 * @description Pure geometry over TwinZone places: "which place contains this
 *              point". Shared by the place-aware slices of TASK-274 (zone
 *              E-stop, deployments) so they all answer it the same way.
 * @feature digitaltwin
 */

import type { TwinZonePoint } from '../types/twin.types.js';

/**
 * Zone types that are places, and the `keepout` flag each carries in the place
 * graph. The one list: TwinPlaceGraphService emits exactly these, and
 * `findContainingPlace` searches exactly these, so the two cannot drift.
 */
export const PLACE_ZONE_KEEPOUT: ReadonlyMap<string, boolean> = new Map([
  ['room', false],
  ['workcell', false],
  ['charging', false],
  ['keepout', true],
]);

/** The minimum a zone needs for containment: a type and a polygon. */
export interface PlaceZoneLike {
  type: string;
  points: TwinZonePoint[];
}

/** Even-odd ray cast. Points exactly on an edge may land either side. */
export function pointInPolygon(point: TwinZonePoint, polygon: TwinZonePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Unsigned shoelace area in square metres. */
export function polygonArea(polygon: TwinZonePoint[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(sum) / 2;
}

/**
 * The place-type zone containing `point`, or null. On overlap the SMALLEST
 * zone wins: a workcell drawn inside a room is the more specific answer to
 * "where is it". Zones that are not places (e.g. `speed`) or have fewer than
 * three vertices are ignored.
 */
export function findContainingPlace<Z extends PlaceZoneLike>(
  zones: readonly Z[],
  point: TwinZonePoint,
): Z | null {
  let best: Z | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    if (!PLACE_ZONE_KEEPOUT.has(zone.type)) continue;
    if (!Array.isArray(zone.points) || zone.points.length < 3) continue;
    if (!pointInPolygon(point, zone.points)) continue;
    const area = polygonArea(zone.points);
    if (area < bestArea) {
      best = zone;
      bestArea = area;
    }
  }
  return best;
}
