/**
 * @file place-frame.ts
 * @description Is the frame the robot's POSE arrives in the same frame the place
 *              graph's POLYGONS are expressed in? Nothing in this repo registers
 *              the two on real hardware, so this module's job is to say so out
 *              loud and let the callers fail closed (TASK-200 review finding 2)
 *              — and to recognise the cases that coincide by construction.
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
      /**
       * How the two frames were related:
       * - `identity`: a `sim`-kind graph authored against the scene itself.
       * - `sim-twin-origin`: a twin graph on a SIMULATED robot, whose world
       *   origin is the twin's origin by construction (TASK-328).
       */
      how: 'identity' | 'sim-twin-origin';
    }
  | {
      registered: false;
      /** Operator-facing, one line, says what to do about it. */
      reason: string;
    };

/**
 * The frame the robot's POSE arrives in, as the robot itself declares it
 * (TASK-328). This is an input, not something read off the graph: the graph
 * cannot know what kind of robot is asking.
 *
 * - `twin`: a simulated robot. Its world is the scene the twin was built from,
 *   and the sim's world origin IS the twin origin (the seeded "Demo Warehouse"
 *   twin and the MuJoCo warehouse scene share one origin) — so a twin graph
 *   needs no registration for it.
 * - `odom`: real hardware. Odometry re-zeroes wherever the base was when the
 *   sidecar came up, which is registered to nothing (alignment is TASK-325).
 */
export type PoseFrame = 'twin' | 'odom';

export interface FrameRegistrationInput {
  poseFrame: PoseFrame;
}

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
 * Two cases are genuinely safe. A graph authored against a simulated scene
 * ({@link SIM_FRAME_KIND}, no `twinId`): the MJCF fixes the world origin, the
 * sim publishes odometry about that same origin, and the registration is the
 * identity. And (TASK-328) a twin graph on a robot that declares
 * `poseFrame: 'twin'` — a sim robot, whose world origin is the twin origin by
 * construction, so nothing needs registering. Everything else — every twin on
 * real hardware, and every hand-authored `site` graph, which is surveyed against
 * a building and not against a robot boot — is unregistered until someone
 * implements registration (TASK-325). Real hardware gets exactly the answer it
 * got before `poseFrame` existed.
 */
export function assessFrameRegistration(
  graph: PlaceGraph,
  { poseFrame }: FrameRegistrationInput = { poseFrame: 'odom' },
): FrameRegistration {
  const { id, kind, twinId } = graph.frame;

  if (twinId !== undefined && poseFrame === 'twin') {
    return { registered: true, how: 'sim-twin-origin' };
  }

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
