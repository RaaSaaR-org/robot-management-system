/**
 * @file frame-registration.ts
 * @description A robot's frame registration (TASK-342, epic TASK-325): the SE(2)
 *              transform from its odometry frame into its site twin's world
 *              frame, as the platform stores it (TASK-341), and what the robot
 *              does with it — carry its site's place graph INTO odometry, so
 *              the tracker, the geofence, navigation and the local map keep
 *              working in the one frame the pose actually arrives in.
 * @feature agentmode
 * @status live
 *
 * Convention, the platform's: `twin = Rot(yawDeg) · odom + (x, y)`, yaw CCW in
 * degrees.
 *
 * A registration describes ONE odometry session. It names the frame id it was
 * measured in (`odomFrameId`, the sidecar boot id); a sidecar restart re-zeroes
 * odometry under a new id, and from then on the stored transform is a number
 * about a frame that no longer exists. `place-frame.ts` refuses it then.
 */

import { platformAuthHeaders } from '../utils/platform-auth.js';
import type { PlaceGraph, PlaceVertex } from './place-resolver.js';

/** A registration as `GET /api/robots/:id/frame-registration` serves it. */
export interface OdomRegistration {
  twinId: string;
  /** The odometry session (sidecar boot id) it was measured in. */
  odomFrameId: string;
  x: number;
  y: number;
  yawDeg: number;
  method: string;
  createdAt: string | null;
}

/** A planar pose; yaw in degrees, CCW, +x = 0. */
export interface PlanarPose {
  x: number;
  y: number;
  yawDeg: number;
}

const DEG = Math.PI / 180;

/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Read a registration off the wire; null when it is not one. Never throws. */
export function parseOdomRegistration(raw: unknown): OdomRegistration | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!nonEmpty(o.twinId) || !nonEmpty(o.odomFrameId)) return null;
  if (!finite(o.x) || !finite(o.y) || !finite(o.yawDeg)) return null;
  return {
    twinId: o.twinId,
    odomFrameId: o.odomFrameId,
    x: o.x,
    y: o.y,
    yawDeg: o.yawDeg,
    method: typeof o.method === 'string' ? o.method : 'unknown',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : null,
  };
}

/** Carry an odometry pose into the twin frame. */
export function odomToTwin(reg: OdomRegistration, pose: PlanarPose): PlanarPose {
  const c = Math.cos(reg.yawDeg * DEG);
  const s = Math.sin(reg.yawDeg * DEG);
  return {
    x: c * pose.x - s * pose.y + reg.x,
    y: s * pose.x + c * pose.y + reg.y,
    yawDeg: wrapDeg(pose.yawDeg + reg.yawDeg),
  };
}

/** Carry a twin-frame point into odometry — the inverse of {@link odomToTwin}. */
export function twinPointToOdom(reg: OdomRegistration, x: number, y: number): [number, number] {
  const c = Math.cos(reg.yawDeg * DEG);
  const s = Math.sin(reg.yawDeg * DEG);
  const dx = x - reg.x;
  const dy = y - reg.y;
  return [c * dx + s * dy, -s * dx + c * dy];
}

/**
 * The same graph with every coordinate carried into odometry.
 *
 * Rotation and translation preserve area and winding, so a CCW ring stays CCW
 * and every containment answer is the one the twin would have given. The frame
 * block is kept as it was: `frame.twinId` still says whose places these are,
 * which is what the graph-level checks key on.
 */
export function graphInOdomFrame(graph: PlaceGraph, reg: OdomRegistration): PlaceGraph {
  const toOdom = ([x, y]: PlaceVertex): PlaceVertex => twinPointToOdom(reg, x, y);
  return {
    ...graph,
    places: graph.places.map((place) => ({
      ...place,
      polygon: place.polygon.map(toOdom),
      landmarks: place.landmarks.map((l) => {
        const [x, y] = twinPointToOdom(reg, l.x, l.y);
        return { ...l, x, y };
      }),
    })),
  };
}

// ============================================================================
// SOURCE
// ============================================================================

/** How long a registration fetch may take; it never runs on a block's path. */
export const FRAME_REGISTRATION_FETCH_TIMEOUT_MS = 5000;

/** The server's 404 body for a robot without one (TASK-341). */
export const NO_FRAME_REGISTRATION_ERROR = 'no frame registration';

/**
 * - `found`: the platform's registration for this robot.
 * - `none`: the platform says there is none — authoritative, drop any copy.
 * - `error`: the platform could not be asked; keep what you had.
 */
export type FrameRegistrationFetch =
  | { kind: 'found'; registration: OdomRegistration }
  | { kind: 'none' }
  | { kind: 'error'; error: string };

export interface FrameRegistrationSourceOptions {
  serverUrl: string;
  robotId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Ask the platform for this robot's registration. {@link refresh} never throws. */
export class FrameRegistrationSource {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  readonly url: string;

  constructor(options: FrameRegistrationSourceOptions) {
    this.url =
      `${options.serverUrl.replace(/\/+$/, '')}/api/robots/` +
      `${encodeURIComponent(options.robotId)}/frame-registration`;
    this.timeoutMs = options.timeoutMs ?? FRAME_REGISTRATION_FETCH_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  async refresh(): Promise<FrameRegistrationFetch> {
    try {
      const res = await this.fetchImpl(this.url, {
        headers: platformAuthHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 404) {
        // Only the server's own "none" is authoritative; a 404 from a platform
        // that predates the route is an error, and changes nothing.
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        return body?.error === NO_FRAME_REGISTRATION_ERROR
          ? { kind: 'none' }
          : { kind: 'error', error: 'HTTP 404' };
      }
      if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` };
      const registration = parseOdomRegistration(await res.json());
      return registration ? { kind: 'found', registration } : { kind: 'error', error: 'malformed registration' };
    } catch (err) {
      return { kind: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }
}
