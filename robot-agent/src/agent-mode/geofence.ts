/**
 * @file geofence.ts
 * @description The first ENFORCED spatial boundary (TASK-200). Pure geometry:
 *              a pose plus a place graph become a {@link GeofenceStatus}, which
 *              `SafetyMonitor` turns into a `zone_violation` protective stop
 *              through its existing stop path.
 *
 *              `robot-agent/src/safety/types.ts` has declared
 *              `SafetyStopType 'zone_violation'` since the safety system was
 *              written and nothing ever implemented it. This module is what
 *              makes the enum true.
 * @feature agentmode
 * @status live
 */

import { distanceToBoundaryM, pointInPolygon } from './place-resolver.js';
import type { Place, PlaceGraph, PlacePose } from './place-resolver.js';
import type { GeofenceStatus, ZoneViolation } from '../safety/types.js';

/**
 * How far OUTSIDE a keepout polygon still counts as a violation, in metres.
 *
 * 0.50 m, sized to the thing being fenced rather than to the map: the G1's
 * footprint is roughly 0.4 m across and a walking biped's stopping distance at
 * the speeds Agent Mode uses is a good fraction of a step. Fencing the polygon
 * exactly would mean the stop fires when the robot is ALREADY in the rack, which
 * is not a geofence, it is a witness statement.
 */
export const DEFAULT_KEEPOUT_MARGIN_M = 0.5;

/**
 * Extra distance beyond the margin the robot must be before a latched violation
 * releases, in metres.
 *
 * Without it, a robot parked exactly on the margin would trip and release and
 * trip again on odometry jitter alone, and each cycle logs a compliance record
 * and damps the base. It also gives the "recoverable by an operator who can see
 * the robot is nowhere near the boundary" clause its meaning: nowhere near is
 * margin + this, and the operator can just walk it back.
 */
export const DEFAULT_KEEPOUT_CLEARANCE_M = 0.25;

/** What the evaluator needs to know about the pose it is handed. */
export interface GeofenceInput {
  /** The pose in the graph's frame, or null when there is none. */
  pose: PlacePose | null;
  /**
   * Whether the pose is still worth acting on. `false` for a belief the drift
   * budget has degraded to `stale` — a pose that may be tens of metres wrong is
   * not evidence that the robot is in a rack, and it is not evidence that it is
   * out of one either.
   */
  poseTrusted: boolean;
}

export interface GeofenceOptions {
  /** Default {@link DEFAULT_KEEPOUT_MARGIN_M}. */
  marginM?: number;
  /** Default {@link DEFAULT_KEEPOUT_CLEARANCE_M}. */
  clearanceM?: number;
}

/** Every keepout place in a graph. */
export function keepoutPlaces(graph: PlaceGraph): Place[] {
  return graph.places.filter((p) => p.keepout);
}

/**
 * How far past the MARGINED boundary of `place` the pose is, or null when it is
 * outside the margin altogether.
 *
 * Inside the polygon: margin + depth inside. On the boundary: exactly the
 * margin. Outside by `d` (< margin): margin − d. So the number grows
 * monotonically as the robot goes further in, which is what an operator reading
 * the stop reason wants.
 */
export function keepoutDepthM(
  x: number,
  y: number,
  place: Place,
  marginM: number,
): number | null {
  const boundary = distanceToBoundaryM(x, y, place.polygon);
  if (pointInPolygon(x, y, place.polygon)) return marginM + boundary;
  return boundary <= marginM ? marginM - boundary : null;
}

/**
 * Pose + graph → what the geofence knows.
 *
 * The floor predicate is applied exactly as the resolver applies it: a keepout
 * on floor 1 does not fence a robot on floor 0. (No multi-floor site exists to
 * test against yet — see TASK-200 "out of scope" — but agreeing with the
 * resolver costs one line and disagreeing with it would be a silent hazard.)
 */
export function evaluateGeofence(
  input: GeofenceInput,
  graph: PlaceGraph,
  options: GeofenceOptions = {},
): GeofenceStatus {
  const marginM = options.marginM ?? DEFAULT_KEEPOUT_MARGIN_M;
  const clearanceM = options.clearanceM ?? DEFAULT_KEEPOUT_CLEARANCE_M;

  const pose = input.pose;
  if (pose === null || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
    return { kind: 'unknown', reason: 'no pose sample' };
  }
  if (!input.poseTrusted) {
    return { kind: 'unknown', reason: 'the pose has drifted past its budget' };
  }

  const floor = pose.floor ?? 0;
  const fences = keepoutPlaces(graph).filter((p) => p.floor === floor);
  if (fences.length === 0) {
    // A graph with no keepouts on this floor is not a geofence failure — it is
    // a site nobody has fenced. `clear` is the honest answer: the robot really
    // is outside every keepout there is.
    return { kind: 'clear' };
  }

  let worst: ZoneViolation | null = null;
  let clearOfAll = true;
  for (const place of fences) {
    const depthM = keepoutDepthM(pose.x, pose.y, place, marginM);
    if (depthM !== null) {
      if (!worst || depthM > worst.depthM) {
        worst = {
          placeId: place.id,
          placeName: place.name,
          depthM,
          poseM: { x: pose.x, y: pose.y },
        };
      }
      clearOfAll = false;
      continue;
    }
    // Outside the margin, but is it outside by ENOUGH to release a latch?
    if (distanceToBoundaryM(pose.x, pose.y, place.polygon) <= marginM + clearanceM) {
      clearOfAll = false;
    }
  }

  if (worst) return { kind: 'violating', violation: worst };
  // Not violating, but sitting in the release hysteresis band of some keepout:
  // report UNKNOWN rather than `clear` so a latched stop is held. Nothing is
  // being hidden — the robot is genuinely too close to say it is out.
  return clearOfAll ? { kind: 'clear' } : { kind: 'unknown', reason: 'inside the keepout release margin' };
}
