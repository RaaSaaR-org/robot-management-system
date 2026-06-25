/**
 * @file scan-sim.ts
 * @description Pose-dependent synthetic LiDAR for digital-twin scan sessions.
 *
 * Unlike {@link generateSyntheticScan} (which rebuilds a robot-centric room
 * every call, so accumulating it is meaningless), this module fixes ONE world
 * room per session and returns only the surface points VISIBLE from the robot's
 * current pose — near-field within range, minus what closer geometry occludes.
 * As the robot walks, the union of frames reconstructs the whole room: the
 * "fills in" effect that makes a scan session feel real, with zero hardware.
 *
 * The room is seeded deterministically (mulberry32) so a given session is
 * reproducible (and testable). Points are returned in `base_link` (x-forward,
 * y-left, z-up, floor at z≈0) — identical to the live perception contract — but
 * each frame also carries the world `pose`, so consumers can lift it back into
 * the shared world map.
 *
 * @status live
 */

import type {
  SimulatedRobotState,
  PointCloudFrame,
  PointCloudPose,
  PointCloudSensorType,
} from './types.js';
import type { DepthSensorSpec } from '../embodiment/index.js';
import { worldToBase, voxelDownsample } from './scan-merge.js';

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_SENSOR_NAME = 'mid360_lidar';
const DEFAULT_SENSOR_TYPE: PointCloudSensorType = 'lidar';
const DEFAULT_ORIGIN: [number, number, number] = [0.0, 0.0, 1.0];

/** Points emitted per live frame (kept small for snappy JSON). */
export const SCAN_LIVE_POINTS = 7000;

/**
 * Effective dense range of the simulated sensor, meters. The real MID-360 sees
 * ~40 m, but its return density collapses with range; capping the *dense*
 * near-field here is what makes walking a large room actually reveal new area
 * (otherwise a 360° sensor would see the whole room from one spot).
 */
const DEFAULT_SCAN_RANGE = 6.5;

// ============================================================================
// SEEDED RNG (mulberry32) — deterministic per session
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

/** Hash an arbitrary session id into a 32-bit seed. */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============================================================================
// WORLD ROOM MODEL
// ============================================================================

/** An axis-aligned box used both as render geometry and as an occluder. */
export interface ScanBox {
  cx: number;
  cy: number;
  base: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface ScanRoom {
  seed: number;
  /** Interleaved world-frame surface points `[x,y,z,...]`. */
  worldPositions: Float32Array;
  /** Per-point intensity, 0..1. */
  worldIntensities: Float32Array;
  /** Occluder boxes (shelves / machines) cast shadows as the robot walks. */
  occluders: ScanBox[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export interface ScanRoomOptions {
  /** Room X extent (meters). */
  width?: number;
  /** Room Y extent (meters). */
  depth?: number;
  /** Ceiling height (meters). */
  height?: number;
  /** Total world surface points to synthesize. */
  density?: number;
}

/**
 * Build a fixed, deterministic world room: a factory-ish space with a ground
 * plane, four perimeter walls, and a few internal shelf/machine blocks that
 * occlude (so walking reveals their far sides + shadowed floor behind them).
 */
export function createScanRoom(seed: number, opts: ScanRoomOptions = {}): ScanRoom {
  const width = opts.width ?? 14;
  const depth = opts.depth ?? 10;
  const ceiling = opts.height ?? 3.0;
  const density = opts.density ?? 42000;

  const hw = width / 2;
  const hd = depth / 2;
  const rng = makeRng(seed);

  // Internal occluders — shelf rows + a machine block, deterministic per seed.
  const occluders: ScanBox[] = [
    { cx: -hw * 0.45, cy: hd * 0.35, base: 0, sx: 3.2, sy: 0.7, sz: 2.0 }, // shelf row A
    { cx: hw * 0.1, cy: -hd * 0.35, base: 0, sx: 3.6, sy: 0.7, sz: 2.0 }, // shelf row B
    { cx: hw * 0.55, cy: hd * 0.45, base: 0, sx: 1.6, sy: 1.6, sz: 1.5 }, // machine
    { cx: -hw * 0.6, cy: -hd * 0.5, base: 0, sx: 1.2, sy: 1.2, sz: 1.1 }, // crate stack
  ];

  const positions: number[] = [];
  const intensities: number[] = [];
  const push = (x: number, y: number, z: number, intensity: number) => {
    positions.push(x, y, z);
    intensities.push(Math.max(0, Math.min(1, intensity)));
  };

  // Budget split: ground / walls / occluder surfaces.
  const groundCount = Math.floor(density * 0.45);
  const wallCount = Math.floor(density * 0.3);
  const occCount = density - groundCount - wallCount;

  // --- Ground plane (uniform grid jitter) ---
  for (let i = 0; i < groundCount; i++) {
    const x = (rng() * 2 - 1) * hw;
    const y = (rng() * 2 - 1) * hd;
    const z = (rng() - 0.5) * 0.02;
    push(x, y, z, 0.2 + rng() * 0.08);
  }

  // --- Four perimeter walls ---
  for (let i = 0; i < wallCount; i++) {
    const wall = i % 4;
    const z = rng() * ceiling;
    const jitter = (rng() - 0.5) * 0.03;
    let x: number, y: number;
    if (wall === 0) { x = hw + jitter; y = (rng() * 2 - 1) * hd; }
    else if (wall === 1) { x = -hw + jitter; y = (rng() * 2 - 1) * hd; }
    else if (wall === 2) { x = (rng() * 2 - 1) * hw; y = hd + jitter; }
    else { x = (rng() * 2 - 1) * hw; y = -hd + jitter; }
    push(x, y, z, 0.42 + rng() * 0.12);
  }

  // --- Occluder surfaces (visible faces of the shelves/machines) ---
  for (let i = 0; i < occCount; i++) {
    const box = occluders[i % occluders.length];
    sampleBoxFace(box, rng, push, 0.78 + rng() * 0.15);
  }

  return {
    seed,
    worldPositions: new Float32Array(positions),
    worldIntensities: new Float32Array(intensities),
    occluders,
    bounds: { minX: -hw, maxX: hw, minY: -hd, maxY: hd, minZ: 0, maxZ: ceiling },
  };
}

/** Sample a random point on one of the 5 visible faces of a box (skip bottom). */
function sampleBoxFace(
  box: ScanBox,
  rng: () => number,
  push: (x: number, y: number, z: number, i: number) => void,
  intensity: number,
): void {
  const face = Math.floor(rng() * 5);
  let x = box.cx + (rng() - 0.5) * box.sx;
  let y = box.cy + (rng() - 0.5) * box.sy;
  let z = box.base + rng() * box.sz;
  if (face === 0) z = box.base + box.sz; // top
  else if (face === 1) x = box.cx + box.sx / 2; // +x
  else if (face === 2) x = box.cx - box.sx / 2; // -x
  else if (face === 3) y = box.cy + box.sy / 2; // +y
  else y = box.cy - box.sy / 2; // -y
  push(x, y, z, intensity);
}

// ============================================================================
// VISIBILITY (range + occlusion) FROM A POSE
// ============================================================================

/** Does segment `s→p` enter `box` strictly before reaching `p`? (slab test) */
function segmentHitsBox(
  sx: number, sy: number, sz: number,
  px: number, py: number, pz: number,
  box: ScanBox,
): boolean {
  const minX = box.cx - box.sx / 2, maxX = box.cx + box.sx / 2;
  const minY = box.cy - box.sy / 2, maxY = box.cy + box.sy / 2;
  const minZ = box.base, maxZ = box.base + box.sz;
  const dx = px - sx, dy = py - sy, dz = pz - sz;

  let tmin = 0, tmax = 1;
  // Per-axis slab clamp.
  const axes: Array<[number, number, number, number]> = [
    [sx, dx, minX, maxX],
    [sy, dy, minY, maxY],
    [sz, dz, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false; // parallel & outside slab
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  // Entered the box before (nearly) reaching the endpoint → occluded.
  return tmin > 1e-3 && tmin < 1 - 1e-3;
}

export interface PosedScanOptions {
  /** Cap on returned points (downsampled if exceeded). */
  targetPoints?: number;
  /** Effective dense sensor range, meters. */
  scanRange?: number;
  /** Session this frame belongs to. */
  scanSessionId?: string;
}

/**
 * Render the slice of `room` visible from the robot's world `pose`, returned in
 * `base_link` with the world pose attached.
 */
export function generatePosedScan(
  room: ScanRoom,
  state: SimulatedRobotState,
  pose: PointCloudPose,
  spec: DepthSensorSpec | undefined,
  sequence: number,
  opts: PosedScanOptions = {},
): PointCloudFrame {
  const sensorName = spec?.name ?? DEFAULT_SENSOR_NAME;
  const sensorType: PointCloudSensorType = spec?.type ?? DEFAULT_SENSOR_TYPE;
  const origin = spec?.position ?? DEFAULT_ORIGIN;
  const hasIntensity = spec?.has_intensity ?? true;
  const minRange = spec?.range?.[0] ?? 0.1;
  const scanRange = opts.scanRange ?? DEFAULT_SCAN_RANGE;
  const target = Math.max(500, opts.targetPoints ?? SCAN_LIVE_POINTS);

  // Sensor sits above the robot base by the configured mount height.
  const sx = pose.x;
  const sy = pose.y;
  const sz = pose.z + origin[2];

  const basePose = { x: pose.x, y: pose.y, z: 0, yaw: pose.yaw };
  const wp = room.worldPositions;
  const wi = room.worldIntensities;
  const n = Math.floor(wp.length / 3);

  const positions: number[] = [];
  const intensities: number[] = [];

  for (let i = 0; i < n; i++) {
    const wx = wp[i * 3];
    const wy = wp[i * 3 + 1];
    const wz = wp[i * 3 + 2];

    const dx = wx - sx, dy = wy - sy, dz = wz - sz;
    const range = Math.hypot(dx, dy, dz);
    if (range < minRange || range > scanRange) continue;

    // Occlusion: skip if a closer occluder box lies on the ray to this point.
    let occluded = false;
    for (const box of room.occluders) {
      // Don't let a box occlude its own surface points.
      if (pointInBox(wx, wy, wz, box)) continue;
      if (segmentHitsBox(sx, sy, sz, wx, wy, wz, box)) { occluded = true; break; }
    }
    if (occluded) continue;

    // Lift world point into base_link (floor stays at z≈0).
    const [bx, by, bz] = worldToBase(wx, wy, wz, basePose);
    // Range-based intensity falloff for a believable look.
    const falloff = 1 - Math.min(1, range / scanRange) * 0.45;
    positions.push(bx, by, bz);
    intensities.push(hasIntensity ? Math.max(0, Math.min(1, wi[i] * falloff)) : 0.5);
  }

  // Cap the frame size. Voxel-thin first (uniform), then stride if still over.
  let cloud = { positions, intensities };
  if (cloud.positions.length / 3 > target * 1.5) {
    cloud = voxelDownsample(cloud, 0.06);
  }
  if (cloud.positions.length / 3 > target) {
    cloud = strideSample(cloud, target);
  }

  return {
    robotId: state.id,
    sensor: sensorName,
    sensorType,
    frame: 'base_link',
    pointCount: cloud.positions.length / 3,
    positions: cloud.positions,
    intensities: cloud.intensities,
    hasIntensity,
    sequence,
    origin,
    source: 'sim',
    pose,
    scanSessionId: opts.scanSessionId,
    timestamp: new Date().toISOString(),
  };
}

function pointInBox(x: number, y: number, z: number, box: ScanBox): boolean {
  return (
    x >= box.cx - box.sx / 2 - 1e-3 && x <= box.cx + box.sx / 2 + 1e-3 &&
    y >= box.cy - box.sy / 2 - 1e-3 && y <= box.cy + box.sy / 2 + 1e-3 &&
    z >= box.base - 1e-3 && z <= box.base + box.sz + 1e-3
  );
}

function strideSample(
  cloud: { positions: number[]; intensities: number[] },
  target: number,
): { positions: number[]; intensities: number[] } {
  const n = Math.floor(cloud.positions.length / 3);
  if (n <= target) return cloud;
  const step = n / target;
  const positions: number[] = [];
  const intensities: number[] = [];
  for (let f = 0; f < n && positions.length / 3 < target; f += step) {
    const i = Math.floor(f);
    positions.push(cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]);
    intensities.push(cloud.intensities[i]);
  }
  return { positions, intensities };
}
