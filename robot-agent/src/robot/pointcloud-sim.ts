/**
 * @file pointcloud-sim.ts
 * @description Synthetic point-cloud generator for depth / LiDAR sensors.
 *
 * Produces a believable Livox MID-360-style scan of the robot's surroundings
 * (ground plane + walls + a few objects) so the perception UI works in
 * simulation without physical hardware. The real Livox / RealSense path is
 * wired separately via the hardware sidecar; this module is the SIM side of
 * that seam (see RobotStateManager.getPointCloudFrame).
 *
 * Points are emitted in a robotics base frame (x-forward, y-left, z-up) with
 * the floor at z = 0, so the robot model stands inside its own scan in the
 * viewer. Each frame is reseeded from its `sequence` number, making the cloud
 * deterministic for tests while shimmering frame-to-frame like a live scan.
 *
 * @status live
 */

import type { SimulatedRobotState, PointCloudFrame, PointCloudSensorType } from './types.js';
import type { DepthSensorSpec } from '../embodiment/index.js';

// ============================================================================
// DEFAULTS (Livox MID-360)
// ============================================================================

const DEFAULT_SENSOR_NAME = 'mid360_lidar';
const DEFAULT_SENSOR_TYPE: PointCloudSensorType = 'lidar';
const DEFAULT_RANGE: [number, number] = [0.1, 40.0];
const DEFAULT_ORIGIN: [number, number, number] = [0.0, 0.0, 1.0];

/** Points emitted for a live/preview frame (kept small for snappy JSON). */
export const LIVE_POINTS_PER_FRAME = 7000;

export interface SyntheticScanOptions {
  /** Total points to emit. Defaults to LIVE_POINTS_PER_FRAME, or the sensor's
   *  full `points_per_frame` when `full` is requested via the caller. */
  targetPoints?: number;
  /** Half-size of the simulated room in meters. */
  roomExtent?: number;
  /** Wall / ceiling height in meters. */
  ceilingHeight?: number;
}

// ============================================================================
// SEEDED RNG (mulberry32) — deterministic per frame
// ============================================================================

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// GENERATOR
// ============================================================================

/**
 * Generate a synthetic point-cloud frame for a depth / LiDAR sensor.
 *
 * @param state    Current simulated robot state (drives object placement)
 * @param spec     Depth sensor spec from the embodiment config (optional)
 * @param sequence Monotonic frame counter (seeds deterministic geometry)
 * @param options  Scene tuning overrides
 */
export function generateSyntheticScan(
  state: SimulatedRobotState,
  spec: DepthSensorSpec | undefined,
  sequence: number,
  options: SyntheticScanOptions = {},
): PointCloudFrame {
  const sensorName = spec?.name ?? DEFAULT_SENSOR_NAME;
  const sensorType: PointCloudSensorType = spec?.type ?? DEFAULT_SENSOR_TYPE;
  const range = spec?.range ?? DEFAULT_RANGE;
  const origin = spec?.position ?? DEFAULT_ORIGIN;
  const hasIntensity = spec?.has_intensity ?? true;
  const maxRange = range[1];

  const target = Math.max(500, options.targetPoints ?? LIVE_POINTS_PER_FRAME);
  const roomExtent = options.roomExtent ?? 4.0;
  const ceiling = options.ceilingHeight ?? 2.5;

  // Reseed per frame: deterministic geometry, but each sequence differs so the
  // cloud shimmers like a non-repetitive LiDAR scan.
  const rng = makeRng((sequence * 2654435761) >>> 0);

  // Budget split across scene elements.
  const groundCount = Math.floor(target * 0.5);
  const wallCount = Math.floor(target * 0.32);
  const objectCount = target - groundCount - wallCount;

  const positions: number[] = [];
  const intensities: number[] = [];

  // Slow time phase for gentle animation (object drift / bob).
  const phase = sequence * 0.12;

  const push = (x: number, y: number, z: number, intensity: number) => {
    const dist = Math.hypot(x, y, z - origin[2]);
    if (dist < range[0] || dist > maxRange) return;
    positions.push(x, y, z);
    // Intensity falls off gently with range, clamped to [0,1].
    const falloff = 1 - Math.min(1, dist / (maxRange * 0.5)) * 0.4;
    intensities.push(hasIntensity ? Math.max(0, Math.min(1, intensity * falloff)) : 0.5);
  };

  // --- Ground plane (radial, biased denser toward the sensor) ---
  for (let i = 0; i < groundCount; i++) {
    const r = roomExtent * Math.pow(rng(), 0.7);
    const theta = rng() * Math.PI * 2;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    const z = (rng() - 0.5) * 0.02; // ±1 cm sensor noise
    push(x, y, z, 0.22 + rng() * 0.06);
  }

  // --- Walls (4 planes of the room box) ---
  for (let i = 0; i < wallCount; i++) {
    const wall = i % 4;
    const along = (rng() * 2 - 1) * roomExtent;
    const z = rng() * ceiling;
    const jitter = (rng() - 0.5) * 0.03;
    let x: number, y: number;
    if (wall === 0) { x = roomExtent + jitter; y = along; }
    else if (wall === 1) { x = -roomExtent + jitter; y = along; }
    else if (wall === 2) { x = along; y = roomExtent + jitter; }
    else { x = along; y = -roomExtent + jitter; }
    push(x, y, z, 0.45 + rng() * 0.1);
  }

  // --- Objects (crate + pillar + an orbiting "mover", and held object) ---
  const objects = buildObjects(state, phase, roomExtent);
  for (let i = 0; i < objectCount; i++) {
    const obj = objects[i % objects.length];
    sampleObject(obj, rng, push);
  }

  return {
    robotId: state.id,
    sensor: sensorName,
    sensorType,
    frame: 'base_link',
    pointCount: positions.length / 3,
    positions,
    intensities,
    hasIntensity,
    sequence,
    origin,
    source: 'sim',
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// OBJECT PRIMITIVES
// ============================================================================

interface SceneObject {
  kind: 'box' | 'cylinder';
  cx: number;
  cy: number;
  base: number; // z of the bottom
  // box
  sx?: number;
  sy?: number;
  sz?: number;
  // cylinder
  radius?: number;
  height?: number;
  intensity: number;
}

function buildObjects(state: SimulatedRobotState, phase: number, roomExtent: number): SceneObject[] {
  const objects: SceneObject[] = [
    // Static crate
    { kind: 'box', cx: 1.6, cy: -1.2, base: 0, sx: 0.5, sy: 0.5, sz: 0.5, intensity: 0.85 },
    // Static pillar
    { kind: 'cylinder', cx: -1.8, cy: 1.4, base: 0, radius: 0.18, height: 1.4, intensity: 0.7 },
    // Slowly orbiting object → makes the scan visibly "live"
    {
      kind: 'cylinder',
      cx: Math.cos(phase) * (roomExtent * 0.55),
      cy: Math.sin(phase) * (roomExtent * 0.55),
      base: 0,
      radius: 0.22,
      height: 1.7,
      intensity: 0.78,
    },
  ];

  // When the robot is carrying something, show it close in front.
  if (state.heldObject) {
    objects.push({ kind: 'box', cx: 0.45, cy: 0, base: 0.6, sx: 0.25, sy: 0.25, sz: 0.25, intensity: 0.95 });
  }

  return objects;
}

function sampleObject(obj: SceneObject, rng: () => number, push: (x: number, y: number, z: number, i: number) => void): void {
  if (obj.kind === 'box') {
    const sx = obj.sx ?? 0.4, sy = obj.sy ?? 0.4, sz = obj.sz ?? 0.4;
    // Pick one of the 5 visible faces (skip the bottom).
    const face = Math.floor(rng() * 5);
    let x = obj.cx + (rng() - 0.5) * sx;
    let y = obj.cy + (rng() - 0.5) * sy;
    let z = obj.base + rng() * sz;
    if (face === 0) z = obj.base + sz;                 // top
    else if (face === 1) x = obj.cx + sx / 2;          // +x
    else if (face === 2) x = obj.cx - sx / 2;          // -x
    else if (face === 3) y = obj.cy + sy / 2;          // +y
    else y = obj.cy - sy / 2;                          // -y
    push(x, y, z, obj.intensity);
  } else {
    const radius = obj.radius ?? 0.2, height = obj.height ?? 1.0;
    const a = rng() * Math.PI * 2;
    const x = obj.cx + Math.cos(a) * radius;
    const y = obj.cy + Math.sin(a) * radius;
    const z = obj.base + rng() * height;
    push(x, y, z, obj.intensity);
  }
}
