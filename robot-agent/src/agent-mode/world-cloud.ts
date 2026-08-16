/**
 * @file world-cloud.ts
 * @description The robot's own 3-D point cloud of the world (TASK-211): every
 *              lidar frame the map keeper integrates into the 2-D grid is also
 *              placed in the odometry frame and kept here, one point per voxel.
 *
 * Why next to the grid and not instead of it: the grid is what the planner
 * walks on; the cloud is what a person (or a twin) LOOKS at, and it is what
 * the digital-twin scan sessions produced by hand before — now it falls out
 * of every Agent Mode run for free.
 *
 * Bounded three ways so it can never grow past what a small computer holds:
 *   - one point per {@link WorldCloudOptions.voxelM} voxel (default 5 cm);
 *   - a hard {@link WorldCloudOptions.maxPoints} cap — when full, the voxels
 *     seen longest ago are dropped first;
 *   - {@link WorldCloud.purgeFreed}: a voxel whose 2-D cell the grid has since
 *     carved confidently FREE is deleted. That is how a chair that was carried
 *     away disappears from the cloud, and it is the only way it does — the
 *     cloud itself never carves.
 *
 * Same session rules as the grid: keyed to the sidecar's boot id, persisted
 * next to the map, restored only when the id matches (odometry re-zeroes on a
 * restart, and a cloud in the wrong frame is worse than none).
 */

import type { PointCloudFrame } from '../robot/types.js';
import type { MapPose } from './occupancy-map.js';

export interface WorldCloudOptions {
  frameId?: string | null;
  /** Voxel edge in metres — one point survives per voxel. */
  voxelM?: number;
  /** Hard cap on stored points; oldest-seen voxels go first. */
  maxPoints?: number;
  /** Returns nearer than this are the robot's own body. */
  minRangeM?: number;
  /** Returns farther than this are too sparse to trust as geometry. */
  maxRangeM?: number;
  /** Below the floor by more than this is reflection noise. */
  minZM?: number;
  /** Above this is ceiling; kept out so the walls stay visible. */
  maxZM?: number;
}

const DEFAULTS = {
  voxelM: 0.05,
  maxPoints: 300_000,
  minRangeM: 0.3,
  maxRangeM: 12,
  minZM: -0.2,
  maxZM: 2.4,
} as const;

/** Wire/persist form: base64 Float32 xyz triplets + Uint32 last-seen seconds. */
export interface WorldCloudSnapshot {
  version: 1;
  frame: 'odom';
  frameId: string | null;
  voxelM: number;
  pointCount: number;
  encoding: 'f32-xyz-b64';
  positions: string;
  /** Unix seconds each point was last confirmed, base64 Uint32, same order. */
  seenS: string;
  frames: number;
  lastIntegratedAt: string | null;
}

export interface CloudIntegrationReport {
  integrated: boolean;
  pointsUsed: number;
  added: number;
  refreshed: number;
}

interface Voxel {
  x: number;
  y: number;
  z: number;
  seenS: number;
}

export class WorldCloud {
  readonly frameId: string | null;
  readonly voxelM: number;
  readonly maxPoints: number;
  private readonly minRangeM: number;
  private readonly maxRangeM: number;
  private readonly minZM: number;
  private readonly maxZM: number;

  /** Insertion-ordered; refreshing a voxel re-inserts it so the head is always the oldest. */
  private voxels = new Map<string, Voxel>();
  private frames = 0;
  private lastIntegratedMs: number | null = null;

  constructor(opts: WorldCloudOptions = {}) {
    this.frameId = opts.frameId ?? null;
    this.voxelM = opts.voxelM ?? DEFAULTS.voxelM;
    this.maxPoints = opts.maxPoints ?? DEFAULTS.maxPoints;
    this.minRangeM = opts.minRangeM ?? DEFAULTS.minRangeM;
    this.maxRangeM = opts.maxRangeM ?? DEFAULTS.maxRangeM;
    this.minZM = opts.minZM ?? DEFAULTS.minZM;
    this.maxZM = opts.maxZM ?? DEFAULTS.maxZM;
  }

  get pointCount(): number {
    return this.voxels.size;
  }

  getFrames(): number {
    return this.frames;
  }

  private key(x: number, y: number, z: number): string {
    const v = this.voxelM;
    return `${Math.floor(x / v)},${Math.floor(y / v)},${Math.floor(z / v)}`;
  }

  /**
   * The point stored for a voxel is its CENTRE, rounded to float32 — what a
   * voxel filter emits, and it survives the float32 snapshot exactly: a
   * centre is half a voxel from every boundary, so re-keying it after a
   * round-trip can never land in the neighbour.
   */
  private centre(x: number, y: number, z: number): [number, number, number] {
    const v = this.voxelM;
    return [Math.fround((Math.floor(x / v) + 0.5) * v), Math.fround((Math.floor(y / v) + 0.5) * v), Math.fround((Math.floor(z / v) + 0.5) * v)];
  }

  /**
   * Place a base_link frame in the odometry frame at `pose` (planar: x, y,
   * yaw — the same pairing the grid uses) and merge it. Returns what changed.
   */
  integrate(frame: PointCloudFrame, pose: MapPose | null, nowMs: number = Date.now()): CloudIntegrationReport {
    const none: CloudIntegrationReport = { integrated: false, pointsUsed: 0, added: 0, refreshed: 0 };
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.yawDeg)) return none;
    const positions = frame.positions;
    if (!Array.isArray(positions) || positions.length < 3) return none;
    if (frame.frame !== 'base_link') return none;

    const yaw = (pose.yawDeg * Math.PI) / 180;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const [ox, oy] = frame.origin ?? [0, 0, 0];
    const minR2 = this.minRangeM * this.minRangeM;
    const maxR2 = this.maxRangeM * this.maxRangeM;
    const seenS = Math.floor(nowMs / 1000);
    const count = Math.floor(positions.length / 3);
    let used = 0;
    let added = 0;
    let refreshed = 0;
    for (let i = 0; i < count; i++) {
      const bx = positions[i * 3];
      const by = positions[i * 3 + 1];
      const bz = positions[i * 3 + 2];
      if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) continue;
      if (bz < this.minZM || bz > this.maxZM) continue;
      const rx = bx - ox;
      const ry = by - oy;
      const r2 = rx * rx + ry * ry;
      if (r2 < minR2 || r2 > maxR2) continue;
      const wx = pose.x + c * bx - s * by;
      const wy = pose.y + s * bx + c * by;
      const k = this.key(wx, wy, bz);
      const existing = this.voxels.get(k);
      if (existing) {
        // Re-insert at the tail: Map keeps insertion order, and eviction
        // takes from the head — the voxel seen longest ago.
        this.voxels.delete(k);
        existing.seenS = seenS;
        this.voxels.set(k, existing);
        refreshed++;
      } else {
        const [cx, cy, cz] = this.centre(wx, wy, bz);
        this.voxels.set(k, { x: cx, y: cy, z: cz, seenS });
        added++;
      }
      used++;
    }
    if (used === 0) return none;
    this.frames++;
    this.lastIntegratedMs = nowMs;
    this.evict();
    return { integrated: true, pointsUsed: used, added, refreshed };
  }

  /** Drop the oldest-seen voxels until under the cap. */
  private evict(): number {
    let dropped = 0;
    if (this.voxels.size <= this.maxPoints) return 0;
    for (const k of this.voxels.keys()) {
      this.voxels.delete(k);
      dropped++;
      if (this.voxels.size <= this.maxPoints) break;
    }
    return dropped;
  }

  /**
   * Delete every voxel inside the grid's height band whose (x, y) cell the
   * grid now calls FREE — the object was there and is not any more. Voxels
   * outside the band (floor, ceiling) are left alone: the grid never looked
   * at them, so its "free" says nothing about them. `near` limits the sweep
   * to a disc around the robot: only what it can currently see can be gone.
   */
  purgeFreed(
    grid: { cellAt(x: number, y: number): 'free' | 'occupied' | 'unknown'; heightBand(): { minM: number; maxM: number } },
    near?: { x: number; y: number; radiusM: number },
  ): number {
    const band = grid.heightBand();
    const r2 = near ? near.radiusM * near.radiusM : Infinity;
    let purged = 0;
    for (const [k, v] of this.voxels) {
      if (v.z < band.minM || v.z > band.maxM) continue;
      if (near) {
        const dx = v.x - near.x;
        const dy = v.y - near.y;
        if (dx * dx + dy * dy > r2) continue;
      }
      if (grid.cellAt(v.x, v.y) === 'free') {
        this.voxels.delete(k);
        purged++;
      }
    }
    return purged;
  }

  /**
   * Points as a flat Float32Array (odom frame, z up). `maxPoints` > 0 returns
   * an even stride sample of at most that many, for viewers on a thin link.
   */
  positions(maxPoints = 0): { positions: Float32Array; total: number } {
    const total = this.voxels.size;
    const stride = maxPoints > 0 && total > maxPoints ? total / maxPoints : 1;
    const n = stride === 1 ? total : Math.min(maxPoints, total);
    const out = new Float32Array(n * 3);
    let i = 0;
    let next = 0;
    let idx = 0;
    for (const v of this.voxels.values()) {
      if (idx++ < next) continue;
      if (i >= n) break;
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
      i++;
      next += stride;
    }
    return { positions: i === n ? out : out.subarray(0, i * 3), total };
  }

  summary(): { pointCount: number; frames: number; voxelM: number; lastIntegratedAt: string | null } {
    return {
      pointCount: this.voxels.size,
      frames: this.frames,
      voxelM: this.voxelM,
      lastIntegratedAt: this.lastIntegratedMs === null ? null : new Date(this.lastIntegratedMs).toISOString(),
    };
  }

  // ── serialisation ─────────────────────────────────────────────────────────

  toSnapshot(): WorldCloudSnapshot {
    const n = this.voxels.size;
    const pos = new Float32Array(n * 3);
    const seen = new Uint32Array(n);
    let i = 0;
    for (const v of this.voxels.values()) {
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      seen[i] = v.seenS;
      i++;
    }
    return {
      version: 1,
      frame: 'odom',
      frameId: this.frameId,
      voxelM: this.voxelM,
      pointCount: n,
      encoding: 'f32-xyz-b64',
      positions: Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength).toString('base64'),
      seenS: Buffer.from(seen.buffer, seen.byteOffset, seen.byteLength).toString('base64'),
      frames: this.frames,
      lastIntegratedAt: this.lastIntegratedMs === null ? null : new Date(this.lastIntegratedMs).toISOString(),
    };
  }

  /** Rebuild from a snapshot; null (never a wrong cloud) on a frame mismatch or a malformed payload. */
  static fromSnapshot(raw: unknown, opts: WorldCloudOptions): { cloud: WorldCloud | null; reason?: string } {
    if (!raw || typeof raw !== 'object') return { cloud: null, reason: 'not an object' };
    const s = raw as Partial<WorldCloudSnapshot>;
    if (s.version !== 1 || s.encoding !== 'f32-xyz-b64') return { cloud: null, reason: 'unknown version/encoding' };
    if (!opts.frameId || s.frameId !== opts.frameId) {
      return { cloud: null, reason: `frame ${s.frameId ?? 'none'} is not the current ${opts.frameId ?? 'none'}` };
    }
    if (typeof s.positions !== 'string' || typeof s.pointCount !== 'number') return { cloud: null, reason: 'malformed' };
    const cloud = new WorldCloud({ ...opts, voxelM: typeof s.voxelM === 'number' ? s.voxelM : opts.voxelM });
    const pb = Buffer.from(s.positions, 'base64');
    if (pb.byteLength !== s.pointCount * 12) return { cloud: null, reason: 'positions length does not match pointCount' };
    const pos = new Float32Array(pb.buffer.slice(pb.byteOffset, pb.byteOffset + pb.byteLength));
    const sb = typeof s.seenS === 'string' ? Buffer.from(s.seenS, 'base64') : null;
    const seen = sb && sb.byteLength === s.pointCount * 4 ? new Uint32Array(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength)) : null;
    for (let i = 0; i < s.pointCount; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      cloud.voxels.set(cloud.key(x, y, z), { x, y, z, seenS: seen ? seen[i] : 0 });
    }
    cloud.frames = typeof s.frames === 'number' ? s.frames : 0;
    cloud.lastIntegratedMs =
      typeof s.lastIntegratedAt === 'string' && !Number.isNaN(Date.parse(s.lastIntegratedAt)) ? Date.parse(s.lastIntegratedAt) : null;
    return { cloud };
  }

  /** Binary little-endian PCD (x y z), the format CloudCompare / Open3D / PCL / Foxglove read. */
  toPcd(): Buffer {
    const { positions } = this.positions();
    const n = positions.length / 3;
    const header = Buffer.from(
      [
        '# .PCD v0.7 - Point Cloud Data file format',
        `# odom-frame world cloud, frame ${this.frameId ?? 'unknown'}, ${this.voxelM} m voxels, ${this.frames} frames`,
        'VERSION 0.7',
        'FIELDS x y z',
        'SIZE 4 4 4',
        'TYPE F F F',
        'COUNT 1 1 1',
        `WIDTH ${n}`,
        'HEIGHT 1',
        'VIEWPOINT 0 0 0 1 0 0 0',
        `POINTS ${n}`,
        'DATA binary',
        '',
      ].join('\n'),
      'ascii',
    );
    return Buffer.concat([header, Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength)]);
  }

  /** Binary little-endian PLY (vertex x y z), for MeshLab / Blender / three.js PLYLoader. */
  toPly(): Buffer {
    const { positions } = this.positions();
    const n = positions.length / 3;
    const header = Buffer.from(
      [
        'ply',
        'format binary_little_endian 1.0',
        `comment odom-frame world cloud, frame ${this.frameId ?? 'unknown'}, ${this.voxelM} m voxels`,
        `element vertex ${n}`,
        'property float x',
        'property float y',
        'property float z',
        'end_header',
        '',
      ].join('\n'),
      'ascii',
    );
    return Buffer.concat([header, Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength)]);
  }
}
