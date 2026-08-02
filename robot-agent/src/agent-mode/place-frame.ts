/**
 * @file place-frame.ts
 * @description Is the frame the robot's POSE arrives in the same frame the place
 *              graph's POLYGONS are expressed in? Nothing in this repo registers
 *              the two, so this module's whole job is to say so out loud and let
 *              the callers fail closed (TASK-200 review finding 2).
 * @feature agentmode
 * @status live
 */

import type { PlaceGraph } from './place-resolver.js';

/**
 * Frame kind of a graph authored directly against a simulated scene. The MJCF
 * fixes the scene's world origin, and the sim's odometry publisher reports in
 * that same world frame, so the two frames coincide BY CONSTRUCTION and the
 * registration is the identity. This is the only case anything here can honestly
 * call registered.
 */
export const SIM_FRAME_KIND = 'sim';

/**
 * Whether a graph's frame may be compared against a raw odometry pose.
 *
 * `registered: false` is not a soft warning — the callers refuse to name a place
 * or judge a keepout on it. See {@link assessFrameRegistration} for why.
 */
export type FrameRegistration =
  | {
      registered: true;
      /** How the two frames were related. Only `identity` exists today. */
      how: 'identity';
    }
  | {
      registered: false;
      /** Operator-facing, one line, says what to do about it. */
      reason: string;
    };

/**
 * Can this graph's coordinates be compared with the robot's odometry pose?
 *
 * The hazard, stated plainly: `TwinPlaceGraphService` emits polygons in the twin
 * world frame, whose origin is `ScanSession.originX/Y` — the robot's pose at the
 * moment somebody started the scan. `CachedBasePose` comes off
 * `rt/odommodestate`, whose origin is wherever the base was when the sidecar
 * last came up. **The two are unrelated**, and they differ by an arbitrary
 * offset after any robot or sidecar restart. Grep this repo for `frameOffset`,
 * `registerFrame` or `twinOrigin` and you find comments, not code.
 *
 * What makes that worth failing closed over rather than logging: the honest-null
 * rule elsewhere in this feature cannot catch it. The pose IS finite and it DOES
 * fall inside some polygon — just the wrong one. So the resolver confidently
 * names a place the robot is not in, and the geofence built on top of it either
 * stops the robot for a rack it is nowhere near or reports `clear` while the
 * robot is physically inside a keepout.
 *
 * The one case that is genuinely safe is a graph authored against a simulated
 * scene ({@link SIM_FRAME_KIND}, no `twinId`): the MJCF fixes the world origin,
 * the sim publishes odometry about that same origin, and the registration is the
 * identity. Everything else — every scan-derived twin, and every hand-authored
 * `site` graph, which is surveyed against a building and not against a robot
 * boot — is unregistered until someone implements registration.
 */
export function assessFrameRegistration(graph: PlaceGraph): FrameRegistration {
  const { id, kind, twinId } = graph.frame;

  if (twinId !== undefined) {
    return {
      registered: false,
      reason:
        `place graph '${id}' is expressed in digital twin '${twinId}', whose origin is the robot's ` +
        'pose at scan start — nothing registers it to this robot\'s odometry origin, which is ' +
        'wherever the base was when the sidecar last came up. Places and keepouts stay UNKNOWN ' +
        'until a frame registration exists.',
    };
  }

  if (kind !== SIM_FRAME_KIND) {
    return {
      registered: false,
      reason:
        `place graph '${id}' has frame.kind '${kind}', which is surveyed against a building rather ` +
        'than against this robot\'s odometry origin, and nothing registers the two. Places and ' +
        `keepouts stay UNKNOWN until a frame registration exists (only '${SIM_FRAME_KIND}' frames ` +
        'coincide with odometry by construction).',
    };
  }

  return { registered: true, how: 'identity' };
}
