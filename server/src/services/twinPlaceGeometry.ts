/**
 * @file twinPlaceGeometry.ts
 * @description Pure geometry over TwinZone places: "which place contains this
 *              point", and "is this robot in that zone". Shared by the
 *              place-aware slices of TASK-274 (zone E-stop, deployments,
 *              verification scope) so they all answer it the same way.
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

/** A TwinZone resolved to the place id a robot on its twin would report. */
export interface ZonePlaceTarget {
  zoneId: string;
  name: string;
  twinId: string;
  /** Place-graph id; null when the zone is not a place (e.g. `speed`). */
  placeId: string | null;
}

/** The minimum of a robot the zone matcher reads. */
export interface PlacedRobotLike {
  twinId?: string | null;
  location?: { place?: string | null } | null;
}

/**
 * The one "is this robot in that zone" answer (TASK-330): the robot is bound to
 * the zone's twin AND reports the zone's place id. A robot whose place is
 * null/absent (unbound, unaligned, unknown) never matches, and neither does a
 * zone that is not a place.
 */
export function robotIsInTwinZone(robot: PlacedRobotLike, zone: ZonePlaceTarget): boolean {
  const place = robot.location?.place;
  if (zone.placeId === null || place === null || place === undefined) return false;
  return robot.twinId === zone.twinId && place === zone.placeId;
}

/**
 * Area-weighted centroid of a simple polygon. Falls back to the vertex average
 * for degenerate (zero-area) polygons. Returns null for < 1 vertex.
 */
export function polygonCentroid(points: TwinZonePoint[]): { x: number; y: number } | null {
  if (points.length === 0) return null;
  if (points.length < 3) {
    const sx = points.reduce((a, p) => a + p.x, 0) / points.length;
    const sy = points.reduce((a, p) => a + p.y, 0) / points.length;
    return { x: sx, y: sy };
  }

  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    const sx = points.reduce((acc, p) => acc + p.x, 0) / n;
    const sy = points.reduce((acc, p) => acc + p.y, 0) / n;
    return { x: sx, y: sy };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}
