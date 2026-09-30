/**
 * @file FrameRegistrationService.ts
 * @description A robot's frame registration (TASK-341, epic TASK-325): the SE(2)
 *              transform from its odometry frame into its site twin's world
 *              frame, so places and keepouts can be judged for a robot whose
 *              odometry origin is not the twin origin.
 * @feature robots
 *
 * Convention, everywhere: `twin = Rot(yawDeg) · odom + (x, y)`, yaw CCW in
 * degrees — the same unit `location.heading` is reported in.
 *
 * A registration is only ever true for ONE odometry session. Odometry re-zeroes
 * wherever the base stands when the sidecar comes up, so the row remembers the
 * frame id it was measured in (`odomFrameId`, the sidecar's boot id) and is
 * `current` only while the robot still reports that frame — and only while the
 * robot is still bound to the twin it was measured against. The robot agent
 * applies the same rule on its side (TASK-342); `current` here is for the
 * operator.
 */

import { prisma } from '../database/index.js';
import { robotRepository } from '../repositories/index.js';
import { robotManager } from './RobotManager.js';
import { twinPlaceGraphService } from './TwinPlaceGraphService.js';

// ============================================================================
// SE(2)
// ============================================================================

/** A planar pose; heading in degrees, CCW, +x = 0. */
export interface Pose2D {
  x: number;
  y: number;
  headingDeg: number;
}

/** odom → twin: `twin = Rot(yawDeg) · odom + (x, y)`. */
export interface FrameTransform {
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

/** Carry a pose from the odometry frame into the twin frame. */
export function applyTransform(t: FrameTransform, p: Pose2D): Pose2D {
  const c = Math.cos(t.yawDeg * DEG);
  const s = Math.sin(t.yawDeg * DEG);
  return {
    x: c * p.x - s * p.y + t.x,
    y: s * p.x + c * p.y + t.y,
    headingDeg: wrapDeg(p.headingDeg + t.yawDeg),
  };
}

/** The twin → odom transform of an odom → twin one. */
export function invertTransform(t: FrameTransform): FrameTransform {
  const c = Math.cos(t.yawDeg * DEG);
  const s = Math.sin(t.yawDeg * DEG);
  return {
    x: -(c * t.x + s * t.y),
    y: -(-s * t.x + c * t.y),
    yawDeg: wrapDeg(-t.yawDeg),
  };
}

/**
 * The transform that puts the robot's current odometry pose exactly on a pose
 * known in the twin — the place anchor: "the robot stands HERE, facing THAT way".
 */
export function composeAnchorTransform(odom: Pose2D, twin: Pose2D): FrameTransform {
  const yawDeg = wrapDeg(twin.headingDeg - odom.headingDeg);
  const c = Math.cos(yawDeg * DEG);
  const s = Math.sin(yawDeg * DEG);
  return {
    x: twin.x - (c * odom.x - s * odom.y),
    y: twin.y - (s * odom.x + c * odom.y),
    yawDeg,
  };
}

/**
 * Area centroid of a simple polygon (implicitly closed). Falls back to the
 * vertex mean for a degenerate ring, which the place graph never emits.
 */
export function polygonCentroid(polygon: readonly (readonly [number, number])[]): { x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i];
    const [x1, y1] = polygon[(i + 1) % polygon.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    const n = Math.max(polygon.length, 1);
    return {
      x: polygon.reduce((sum, [x]) => sum + x, 0) / n,
      y: polygon.reduce((sum, [, y]) => sum + y, 0) / n,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

// ============================================================================
// REQUESTS
// ============================================================================

export type FrameRegistrationMethod = 'manual' | 'place-anchor';

export type FrameRegistrationRequest =
  | { method: 'manual'; x: number; y: number; yawDeg: number }
  | { method: 'place-anchor'; placeId: string; headingDeg: number };

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate a PUT body; the string is the 400 message. */
export function parseRegistrationRequest(body: unknown): FrameRegistrationRequest | string {
  if (typeof body !== 'object' || body === null) return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (b.method === 'manual') {
    if (!finite(b.x) || !finite(b.y) || !finite(b.yawDeg)) {
      return 'manual registration needs finite numbers x, y and yawDeg';
    }
    return { method: 'manual', x: b.x, y: b.y, yawDeg: wrapDeg(b.yawDeg) };
  }
  if (b.method === 'place-anchor') {
    if (typeof b.placeId !== 'string' || b.placeId.trim() === '') return 'placeId must be a non-empty string';
    if (!finite(b.headingDeg)) return 'headingDeg must be a finite number (the robot\'s heading in the twin frame)';
    return { method: 'place-anchor', placeId: b.placeId.trim(), headingDeg: wrapDeg(b.headingDeg) };
  }
  return "method must be 'manual' or 'place-anchor'";
}

// ============================================================================
// SERVICE
// ============================================================================

/** What the API returns. */
export interface FrameRegistrationView extends FrameTransform {
  robotId: string;
  twinId: string;
  odomFrameId: string;
  method: FrameRegistrationMethod;
  anchorPlaceId: string | null;
  createdAt: string;
  /** Whether it still applies: same site, same odometry session. */
  current: boolean;
  /** Why it does not, operator-facing; null when `current`. */
  staleReason: string | null;
}

export type FrameRegistrationResult =
  | { ok: true; registration: FrameRegistrationView }
  | { ok: false; status: 400 | 404 | 409; error: string };

interface RegistrationRow {
  robotId: string;
  twinId: string;
  odomFrameId: string;
  x: number;
  y: number;
  yawDeg: number;
  method: string;
  anchorPlaceId: string | null;
  createdAt: Date;
}

/** The robot's live odometry: pose + frame, or why there is none. */
type LiveOdometry = { ok: true; pose: Pose2D; frameId: string } | { ok: false; error: string };

export class FrameRegistrationService {
  /** The registration of a robot of this tenant, or null (no robot, or none stored). */
  async get(robotId: string): Promise<FrameRegistrationView | null> {
    const robot = await robotRepository.findById(robotId);
    if (!robot) return null;
    const row = await prisma.robotFrameRegistration.findUnique({ where: { robotId } });
    if (!row) return null;
    return this.view(row, robot.twinId ?? null, await this.liveFrameId(robotId));
  }

  /** Create or replace a robot's registration. */
  async set(robotId: string, request: FrameRegistrationRequest): Promise<FrameRegistrationResult> {
    const robot = await robotRepository.findById(robotId);
    if (!robot) return { ok: false, status: 404, error: 'Robot not found' };
    const twinId = robot.twinId ?? null;
    if (!twinId) return { ok: false, status: 409, error: 'robot has no site — bind it to a site before aligning it' };

    const live = await this.liveOdometry(robotId);
    if (!live.ok) return { ok: false, status: 409, error: live.error };

    let transform: FrameTransform;
    let anchorPlaceId: string | null = null;
    if (request.method === 'manual') {
      transform = { x: request.x, y: request.y, yawDeg: request.yawDeg };
    } else {
      const graph = await twinPlaceGraphService.exportPlaceGraph(twinId);
      // Place ids are upper-case slugs (`AISLE-3`); an operator may type `aisle-3`.
      const wanted = request.placeId.toUpperCase();
      const place = graph?.places.find((p) => p.id.toUpperCase() === wanted);
      if (!place) return { ok: false, status: 404, error: `place '${request.placeId}' is not a place of this robot's site` };
      const at = polygonCentroid(place.polygon);
      transform = composeAnchorTransform(live.pose, { x: at.x, y: at.y, headingDeg: request.headingDeg });
      anchorPlaceId = place.id;
    }

    await prisma.robotFrameRegistration.deleteMany({ where: { robotId } });
    const row = await prisma.robotFrameRegistration.create({
      data: {
        robotId,
        twinId,
        odomFrameId: live.frameId,
        x: transform.x,
        y: transform.y,
        yawDeg: wrapDeg(transform.yawDeg),
        method: request.method,
        anchorPlaceId,
      },
    });
    return { ok: true, registration: this.view(row, twinId, live.frameId) };
  }

  /** Remove a robot's registration; false when there was none (or no such robot). */
  async clear(robotId: string): Promise<boolean> {
    const robot = await robotRepository.findById(robotId);
    if (!robot) return false;
    const { count } = await prisma.robotFrameRegistration.deleteMany({ where: { robotId } });
    return count > 0;
  }

  /**
   * The robot's live odometry pose and frame id, off the connected agent's
   * last report. A registration measured against anything else would be a
   * transform from nowhere.
   */
  private async liveOdometry(robotId: string): Promise<LiveOdometry> {
    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered?.isConnected) {
      return { ok: false, error: 'robot is not connected — its odometry pose is unknown' };
    }
    const loc = registered.robot.location;
    const frame = loc?.frame ?? null;
    if (frame?.kind === 'sim') {
      return {
        ok: false,
        error: "robot's pose is already in its simulated world frame — it needs no alignment",
      };
    }
    if (frame?.kind !== 'odom' || !frame.id) {
      return { ok: false, error: 'robot reports no odometry frame — its pose cannot be registered' };
    }
    if (!finite(loc.x) || !finite(loc.y) || !finite(loc.heading)) {
      return { ok: false, error: 'robot reports no complete odometry pose (x, y, heading)' };
    }
    return { ok: true, pose: { x: loc.x, y: loc.y, headingDeg: loc.heading }, frameId: frame.id };
  }

  private async liveFrameId(robotId: string): Promise<string | null> {
    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered?.isConnected) return null;
    const frame = registered.robot.location?.frame ?? null;
    return frame?.kind === 'odom' ? frame.id : null;
  }

  private view(row: RegistrationRow, robotTwinId: string | null, liveFrameId: string | null): FrameRegistrationView {
    let staleReason: string | null = null;
    if (robotTwinId !== row.twinId) {
      staleReason = "measured against another site than the robot's current one";
    } else if (liveFrameId === null) {
      staleReason = 'robot is not connected — cannot tell whether its odometry is still the registered session';
    } else if (liveFrameId !== row.odomFrameId) {
      staleReason = 'odometry restarted since it was measured (new odometry session) — align again';
    }
    return {
      robotId: row.robotId,
      twinId: row.twinId,
      odomFrameId: row.odomFrameId,
      x: row.x,
      y: row.y,
      yawDeg: row.yawDeg,
      method: row.method === 'manual' ? 'manual' : 'place-anchor',
      anchorPlaceId: row.anchorPlaceId,
      createdAt: row.createdAt.toISOString(),
      current: staleReason === null,
      staleReason,
    };
  }
}

export const frameRegistrationService = new FrameRegistrationService();
