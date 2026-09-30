/**
 * @file places.ts
 * @description Pure helpers over a site's place graph: the centroid a robot is
 *              sent to, and the places a robot may be sent to at all (TASK-332).
 *              Mirrors the server's `polygonCentroid` (twinPlaceGeometry.ts).
 * @feature digitaltwin
 */

import type { PlaceGraphPlace } from '../types/twin.types';

/**
 * Area-weighted centroid of a simple polygon; the vertex average for a
 * degenerate (zero-area) one; null for no vertices.
 */
export function placeCentroid(polygon: readonly [number, number][]): { x: number; y: number } | null {
  const n = polygon.length;
  if (n === 0) return null;
  const average = () => ({
    x: polygon.reduce((a, [x]) => a + x, 0) / n,
    y: polygon.reduce((a, [, y]) => a + y, 0) / n,
  });
  if (n < 3) return average();

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % n];
    const cross = ax * by - bx * ay;
    area += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) return average();
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Places a robot can be sent to: everything but keepouts. */
export function reachablePlaces(places: readonly PlaceGraphPlace[]): PlaceGraphPlace[] {
  return places.filter((p) => !p.keepout);
}
