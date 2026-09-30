/**
 * @file place-destination.ts
 * @description Resolves a named move target against the robot's place graph and
 * finds the keepout a target point lies in (TASK-329). Pure — no I/O, no state.
 * @feature navigation
 */

import { pointInPolygon, resolvePlaceByName, type Place } from '../agent-mode/place-resolver.js';
import { placeGoal } from '../agent-mode/navigator.js';

/** The one destination that needs no place graph: the frame origin. */
export const HOME_ALIAS = 'home';

/** Lower-case, `-`/`_` as spaces, collapsed — how names are compared. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The point a move to `place` drives to: its polygon centroid (or deepest interior point). */
export function placeTarget(place: Place): { x: number; y: number } {
  return placeGoal(place);
}

/**
 * The place a human means by `name`, in this order: the place `id`
 * (case-insensitive), then its `name`, then its `placeType` — "charging" or
 * "charging station" pick the `charging` place nearest to `from`. Last, the
 * looser partial match the planner uses (`resolvePlaceByName`). Keepouts are
 * returned like any other place: refusing them is the caller's job, and it can
 * only name the keepout if it gets it back.
 */
export function resolvePlaceDestination(
  name: string,
  places: readonly Place[],
  from?: { x: number; y: number },
): Place | null {
  const wanted = norm(name);
  if (!wanted) return null;

  const byId = places.filter((p) => norm(p.id) === wanted);
  if (byId.length === 1) return byId[0]!;
  const byName = places.filter((p) => norm(p.name) === wanted);
  if (byName.length === 1) return byName[0]!;

  const byType = places.filter((p) => {
    const t = norm(p.placeType);
    return wanted === t || wanted.startsWith(`${t} `);
  });
  if (byType.length > 0) return nearest(byType, from);

  return resolvePlaceByName(name, places);
}

/** The keepout place containing `(x, y)`, or null when the point is clear. */
export function keepoutAt(x: number, y: number, places: readonly Place[]): Place | null {
  return places.find((p) => p.keepout && pointInPolygon(x, y, p.polygon)) ?? null;
}

/** The place whose target point is closest to `from` (the first one when `from` is unknown). */
export function nearest(places: readonly Place[], from?: { x: number; y: number }): Place | null {
  if (places.length === 0) return null;
  if (!from) return places[0]!;
  let best = places[0]!;
  let bestD = Infinity;
  for (const p of places) {
    const t = placeTarget(p);
    const d = Math.hypot(t.x - from.x, t.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
