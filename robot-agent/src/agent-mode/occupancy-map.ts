/**
 * @file occupancy-map.ts
 * @description The robot's own 2D map (TASK-206): a log-odds occupancy grid
 *              accumulated from the point clouds Agent Mode already snapshots,
 *              expressed in the ODOMETRY frame. Pure — no I/O, no clock of its
 *              own, no knowledge of where clouds or poses come from. The
 *              controller feeds it; `persistence` and `/map` read it.
 * @feature agentmode
 * @status live
 */

import type { PointCloudFrame } from '../robot/types.js';
import { DEFAULT_MAX_HEIGHT_M, DEFAULT_MIN_HEIGHT_M, DEFAULT_MIN_RANGE_M } from './range.js';

/** Planar pose in the odometry frame; yaw in DEGREES, +x = 0, CCW positive. */
export interface MapPose {
  x: number;
  y: number;
  yawDeg: number;
}

export type CellState = 'occupied' | 'free' | 'unknown';

export interface OccupancyMapOptions {
  /** Cell edge in metres (default 0.1). */
  resolutionM?: number;
  /** Side of the initial square grid centred on the first pose (default 20 m). */
  initialSizeM?: number;
  /** Hard cap on either side; growth stops here and outside points are dropped (default 60 m). */
  maxSizeM?: number;
  /** Height band above the floor, metres — same band `range.ts` uses. */
  minHeightM?: number;
  maxHeightM?: number;
  /** Returns nearer than this are the sensor seeing itself and are dropped entirely. */
  minRangeM?: number;
  /**
   * Returns beyond this mark FREE space along the ray only — the hit itself is
   * too far to be trusted as a wall for the current block (default 12, mirrors
   * `AGENT_RANGE_MAX_M`).
   */
  maxRangeM?: number;
  /** Log-odds added per hit / subtracted per pass-through. */
  hitLogOdds?: number;
  missLogOdds?: number;
  /** Clamp so one wall cannot become un-learnable. */
  clampLogOdds?: number;
  /** Cell class thresholds. */
  occupiedAbove?: number;
  freeBelow?: number;
  /**
   * Seconds after which an un-observed cell starts drifting back toward
   * unknown; 0 (default) disables decay. Kept as a knob for moving obstacles.
   */
  decayS?: number;
  /**
   * Which odometry session this map belongs to. A sidecar restart re-zeroes
   * odometry, so a map from a previous session would be lying by metres;
   * {@link OccupancyMap.fromSnapshot} refuses a mismatch.
   */
  frameId?: string | null;
}

/** Wire/persist form. `cells` is base64 of Int8 log-odds × {@link LOGODDS_SCALE}. */
export interface OccupancyMapSnapshot {
  version: 1;
  frame: 'odom';
  frameId: string | null;
  resolution: number;
  /** World coordinates of the outer corner of cell (0, 0). */
  originX: number;
  originY: number;
  width: number;
  height: number;
  encoding: 'int8-logodds-b64';
  cells: string;
  /** Classification thresholds in log-odds, so any consumer can classify. */
  occupiedAbove: number;
  freeBelow: number;
  /** How many `integrate()` calls contributed. */
  poseCount: number;
  lastIntegratedAt: string | null;
  knownCells: number;
  occupiedCells: number;
}

/** The small summary that rides along in the mirrored `AgentModeState`. */
export interface OccupancyMapSummary {
  knownCells: number;
  occupiedCells: number;
  lastIntegratedAt: string | null;
}

/** Int8 quantisation of log-odds for the wire (±5 → ±125). */
export const LOGODDS_SCALE = 25;

const DEFAULTS = {
  resolutionM: 0.1,
  initialSizeM: 20,
  maxSizeM: 60,
  minHeightM: DEFAULT_MIN_HEIGHT_M,
  maxHeightM: DEFAULT_MAX_HEIGHT_M,
  minRangeM: DEFAULT_MIN_RANGE_M,
  maxRangeM: 12,
  hitLogOdds: 0.85,
  missLogOdds: 0.4,
  clampLogOdds: 5,
  occupiedAbove: 1.2,
  freeBelow: -1.2,
  decayS: 0,
} as const;

/** What one `integrate()` did — for logs and tests, never for control. */
export interface IntegrationReport {
  /** False when the frame was skipped wholesale (no points, no pose). */
  integrated: boolean;
  pointsUsed: number;
  pointsDropped: number;
  hits: number;
  grew: boolean;
}

/**
 * Log-odds occupancy grid in the odometry frame.
 *
 * Coordinates: world metres (odom) → cell indices via `originX/Y` and
 * `resolution`. The grid grows by doubling when a return lands outside it, up
 * to `maxSizeM`; existing cells never move (they are copied at an offset), so
 * a snapshot taken before a growth step still classifies the same world point
 * the same way after it.
 */
export class OccupancyMap {
  readonly resolution: number;
  readonly frameId: string | null;
  private readonly maxCells: number;
  private readonly initialCells: number;
  private readonly minHeightM: number;
  private readonly maxHeightM: number;
  private readonly minRangeM: number;
  private readonly maxRangeM: number;
  private readonly hitLogOdds: number;
  private readonly missLogOdds: number;
  private readonly clampLogOdds: number;
  readonly occupiedAbove: number;
  readonly freeBelow: number;
  private readonly decayS: number;

  private originX = 0;
  private originY = 0;
  private width = 0;
  private height = 0;
  private cells: Float32Array = new Float32Array(0);
  /** Seconds-since-epoch of the last observation per cell; only kept when decaying. */
  private seenS: Uint32Array | null = null;
  private lastDecayMs = 0;
  private poseCount = 0;
  private lastIntegratedMs: number | null = null;

  constructor(opts: OccupancyMapOptions = {}) {
    this.resolution = opts.resolutionM ?? DEFAULTS.resolutionM;
    this.frameId = opts.frameId ?? null;
    const maxSizeM = opts.maxSizeM ?? DEFAULTS.maxSizeM;
    const initialSizeM = Math.min(opts.initialSizeM ?? DEFAULTS.initialSizeM, maxSizeM);
    this.maxCells = Math.max(1, Math.round(maxSizeM / this.resolution));
    this.initialCells = Math.max(1, Math.round(initialSizeM / this.resolution));
    this.minHeightM = opts.minHeightM ?? DEFAULTS.minHeightM;
    this.maxHeightM = opts.maxHeightM ?? DEFAULTS.maxHeightM;
    this.minRangeM = opts.minRangeM ?? DEFAULTS.minRangeM;
    this.maxRangeM = opts.maxRangeM ?? DEFAULTS.maxRangeM;
    this.hitLogOdds = opts.hitLogOdds ?? DEFAULTS.hitLogOdds;
    this.missLogOdds = opts.missLogOdds ?? DEFAULTS.missLogOdds;
    this.clampLogOdds = opts.clampLogOdds ?? DEFAULTS.clampLogOdds;
    this.occupiedAbove = opts.occupiedAbove ?? DEFAULTS.occupiedAbove;
    this.freeBelow = opts.freeBelow ?? DEFAULTS.freeBelow;
    this.decayS = opts.decayS ?? DEFAULTS.decayS;
  }

  // ── geometry ──────────────────────────────────────────────────────────────

  /** True once the grid has been allocated (first integration or restore). */
  isAllocated(): boolean {
    return this.width > 0;
  }

  bounds(): { originX: number; originY: number; width: number; height: number } {
    return { originX: this.originX, originY: this.originY, width: this.width, height: this.height };
  }

  private toCell(x: number, y: number): [number, number] {
    return [Math.floor((x - this.originX) / this.resolution), Math.floor((y - this.originY) / this.resolution)];
  }

  private inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  private allocateAround(x: number, y: number): void {
    const n = this.initialCells;
    this.width = n;
    this.height = n;
    // Snap the origin to the resolution so cell edges are stable across grows.
    this.originX = Math.floor(x / this.resolution) * this.resolution - (n / 2) * this.resolution;
    this.originY = Math.floor(y / this.resolution) * this.resolution - (n / 2) * this.resolution;
    this.cells = new Float32Array(n * n);
    if (this.decayS > 0) this.seenS = new Uint32Array(n * n);
  }

  /**
   * Grow the grid so `(x, y)` fits, doubling per axis as needed and never past
   * `maxCells`. Returns false when the point cannot be contained even at the cap.
   */
  private ensureContains(x: number, y: number): boolean {
    if (!this.isAllocated()) this.allocateAround(x, y);
    let [cx, cy] = this.toCell(x, y);
    if (this.inBounds(cx, cy)) return true;

    let newW = this.width;
    let newH = this.height;
    let newOx = this.originX;
    let newOy = this.originY;
    let guard = 0;
    while (guard++ < 16) {
      cx = Math.floor((x - newOx) / this.resolution);
      cy = Math.floor((y - newOy) / this.resolution);
      const fitsX = cx >= 0 && cx < newW;
      const fitsY = cy >= 0 && cy < newH;
      if (fitsX && fitsY) break;
      if (!fitsX) {
        if (newW >= this.maxCells) return false;
        const grown = Math.min(newW * 2, this.maxCells);
        const extra = grown - newW;
        // Extend toward the point.
        if (cx < 0) newOx -= extra * this.resolution;
        newW = grown;
      }
      if (!fitsY) {
        if (newH >= this.maxCells) return false;
        const grown = Math.min(newH * 2, this.maxCells);
        const extra = grown - newH;
        if (cy < 0) newOy -= extra * this.resolution;
        newH = grown;
      }
    }
    if (!(cx >= 0 && cx < newW && cy >= 0 && cy < newH)) return false;

    // Copy existing cells at their offset — nothing moves in world coordinates.
    const dx = Math.round((this.originX - newOx) / this.resolution);
    const dy = Math.round((this.originY - newOy) / this.resolution);
    const next = new Float32Array(newW * newH);
    const nextSeen = this.seenS ? new Uint32Array(newW * newH) : null;
    for (let row = 0; row < this.height; row++) {
      const src = row * this.width;
      const dst = (row + dy) * newW + dx;
      next.set(this.cells.subarray(src, src + this.width), dst);
      if (nextSeen && this.seenS) nextSeen.set(this.seenS.subarray(src, src + this.width), dst);
    }
    this.cells = next;
    this.seenS = nextSeen;
    this.width = newW;
    this.height = newH;
    this.originX = newOx;
    this.originY = newOy;
    return true;
  }

  // ── integration ───────────────────────────────────────────────────────────

  /**
   * Fold one `base_link` cloud, taken at `pose`, into the grid.
   *
   * `pose === null` is the honest-null rule: no pose → no update, never "assume
   * the origin". Points are filtered by the same height band and blind radius
   * `range.ts` uses, so the map and the per-bearing ranges agree about what
   * counts as an obstacle.
   */
  integrate(frame: PointCloudFrame, pose: MapPose | null, nowMs: number = Date.now()): IntegrationReport {
    const none: IntegrationReport = { integrated: false, pointsUsed: 0, pointsDropped: 0, hits: 0, grew: false };
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.yawDeg)) return none;
    const positions = frame.positions;
    if (!Array.isArray(positions) || positions.length < 3) return none;
    if (frame.frame !== 'base_link') return none;

    this.decay(nowMs);

    const yaw = (pose.yawDeg * Math.PI) / 180;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Sensor origin in the base frame → odom. Only the planar part matters.
    const [ox, oy] = frame.origin ?? [0, 0, 0];
    const sensorX = pose.x + c * ox - s * oy;
    const sensorY = pose.y + s * ox + c * oy;

    const before = this.width * this.height;
    if (!this.ensureContains(sensorX, sensorY)) return none;

    const minR2 = this.minRangeM * this.minRangeM;
    let used = 0;
    let dropped = 0;
    let hits = 0;
    const count = Math.floor(positions.length / 3);

    // ── pass 1: filter, transform, and find the NEAREST return per bearing ──
    //
    // The cloud is 3-D and the grid is 2-D, and projecting naively loses the
    // table: a ring that skims 0.4 m ABOVE the table top reaches the wall
    // behind it, and traced as a 2-D ray it would carve the table's cells
    // free — eight rings pass over for every three that hit, and the log-odds
    // sum says "free". So free space is carved per BEARING BIN only up to the
    // nearest in-band return in that bin (a virtual 2-D laser scan), while
    // every in-band return still marks its own cell occupied. What sits between
    // the nearest return and a farther one in the same bin stays unknown —
    // occluded is the honest reading.
    const BINS = 360;
    const nearestR = new Float64Array(BINS).fill(Infinity);
    const nearestX = new Float64Array(BINS);
    const nearestY = new Float64Array(BINS);
    const nearestHit = new Uint8Array(BINS);
    const hitX: number[] = [];
    const hitY: number[] = [];
    for (let i = 0; i < count; i++) {
      const bx = positions[i * 3];
      const by = positions[i * 3 + 1];
      const bz = positions[i * 3 + 2];
      if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) {
        dropped++;
        continue;
      }
      if (bz < this.minHeightM || bz > this.maxHeightM) {
        dropped++;
        continue;
      }
      // Range and bearing are measured from the sensor origin, like `range.ts`.
      const rx = bx - ox;
      const ry = by - oy;
      const r2 = rx * rx + ry * ry;
      if (r2 < minR2) {
        dropped++;
        continue;
      }
      const r = Math.sqrt(r2);
      let hit = true;
      let ex = bx;
      let ey = by;
      if (r > this.maxRangeM) {
        // Too far to trust as a wall: free up to maxRange, no hit.
        const k = this.maxRangeM / r;
        ex = ox + rx * k;
        ey = oy + ry * k;
        hit = false;
      }
      // Base frame → odom.
      const wx = pose.x + c * ex - s * ey;
      const wy = pose.y + s * ex + c * ey;
      used++;
      if (hit) {
        hitX.push(wx);
        hitY.push(wy);
      }
      const bin = ((Math.floor((Math.atan2(ry, rx) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
      const rr = hit ? r : this.maxRangeM;
      if (rr < nearestR[bin]) {
        nearestR[bin] = rr;
        nearestX[bin] = wx;
        nearestY[bin] = wy;
        nearestHit[bin] = hit ? 1 : 0;
      }
    }

    // ── pass 2: carve free space along each bearing up to its nearest return ──
    for (let b = 0; b < BINS; b++) {
      if (nearestR[b] === Infinity) continue;
      if (!this.ensureContains(nearestX[b], nearestY[b])) continue;
      const [sx, sy] = this.toCell(sensorX, sensorY);
      const [tx, ty] = this.toCell(nearestX[b], nearestY[b]);
      // The endpoint itself is left to pass 3 (a hit) or untouched (clipped).
      this.traceRay(sx, sy, tx, ty, false, nowMs);
    }

    // ── pass 3: every in-band return marks its cell — once per cell per frame ──
    //
    // Several rings of one sweep land in the same 2-D cell of a wall; counting
    // each would let ONE frame saturate a cell (and a single stray return then
    // never gets outvoted). One vote per cell per frame keeps hit and miss
    // evidence on the same scale.
    const seenCells = new Set<number>();
    for (let i = 0; i < hitX.length; i++) {
      if (!this.ensureContains(hitX[i], hitY[i])) {
        dropped++;
        continue;
      }
      const [tx, ty] = this.toCell(hitX[i], hitY[i]);
      const idx = ty * this.width + tx;
      if (seenCells.has(idx)) continue;
      seenCells.add(idx);
      this.bump(idx, this.hitLogOdds);
      if (this.seenS) this.seenS[idx] = Math.floor(nowMs / 1000);
      hits++;
    }

    this.poseCount++;
    this.lastIntegratedMs = nowMs;
    return { integrated: true, pointsUsed: used, pointsDropped: dropped, hits, grew: this.width * this.height !== before };
  }

  /** Bresenham from sensor cell to end cell: every cell before the end is a miss; the end is a hit when `hit`. */
  private traceRay(x0: number, y0: number, x1: number, y1: number, hit: boolean, nowMs: number): void {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const seenStamp = Math.floor(nowMs / 1000);
    for (;;) {
      const atEnd = x === x1 && y === y1;
      if (this.inBounds(x, y)) {
        const idx = y * this.width + x;
        if (atEnd) {
          if (hit) this.bump(idx, this.hitLogOdds);
        } else {
          this.bump(idx, -this.missLogOdds);
        }
        if (this.seenS) this.seenS[idx] = seenStamp;
      }
      if (atEnd) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  private bump(idx: number, delta: number): void {
    const v = this.cells[idx] + delta;
    this.cells[idx] = v > this.clampLogOdds ? this.clampLogOdds : v < -this.clampLogOdds ? -this.clampLogOdds : v;
  }

  /** Pull cells not seen for `decayS` toward unknown. Cheap: at most once per second. */
  private decay(nowMs: number): void {
    if (this.decayS <= 0 || !this.seenS || !this.isAllocated()) return;
    if (nowMs - this.lastDecayMs < 1000) return;
    this.lastDecayMs = nowMs;
    const nowS = Math.floor(nowMs / 1000);
    const cutoff = nowS - this.decayS;
    // Per second past the cutoff, shed a fixed fraction of the log-odds.
    const factor = 0.9;
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      if (v === 0) continue;
      const seen = this.seenS[i];
      if (seen === 0 || seen > cutoff) continue;
      const next = v * factor;
      this.cells[i] = Math.abs(next) < 0.05 ? 0 : next;
    }
  }

  // ── queries ───────────────────────────────────────────────────────────────

  logOddsAt(x: number, y: number): number | null {
    if (!this.isAllocated()) return null;
    const [cx, cy] = this.toCell(x, y);
    if (!this.inBounds(cx, cy)) return null;
    return this.cells[cy * this.width + cx];
  }

  cellAt(x: number, y: number): CellState {
    const v = this.logOddsAt(x, y);
    if (v === null) return 'unknown';
    if (v > this.occupiedAbove) return 'occupied';
    if (v < this.freeBelow) return 'free';
    return 'unknown';
  }

  /**
   * Can a robot of `radiusM` stand centred on `(x, y)`? True only when every
   * cell within the radius is FREE — unknown counts as not traversable, which is
   * the conservative reading a planner (TASK-208) needs.
   */
  isTraversable(x: number, y: number, radiusM = 0.35): boolean {
    if (!this.isAllocated()) return false;
    const rCells = Math.ceil(radiusM / this.resolution);
    const [cx, cy] = this.toCell(x, y);
    const r2 = (radiusM / this.resolution) * (radiusM / this.resolution);
    for (let dy = -rCells; dy <= rCells; dy++) {
      for (let dx = -rCells; dx <= rCells; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const ix = cx + dx;
        const iy = cy + dy;
        if (!this.inBounds(ix, iy)) return false;
        if (this.cells[iy * this.width + ix] >= this.freeBelow) return false;
      }
    }
    return true;
  }

  summary(): OccupancyMapSummary {
    let known = 0;
    let occupied = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      if (v > this.occupiedAbove) {
        occupied++;
        known++;
      } else if (v < this.freeBelow) {
        known++;
      }
    }
    return {
      knownCells: known,
      occupiedCells: occupied,
      lastIntegratedAt: this.lastIntegratedMs === null ? null : new Date(this.lastIntegratedMs).toISOString(),
    };
  }

  getPoseCount(): number {
    return this.poseCount;
  }

  // ── serialisation ─────────────────────────────────────────────────────────

  toSnapshot(): OccupancyMapSnapshot {
    const q = new Int8Array(this.cells.length);
    for (let i = 0; i < q.length; i++) {
      const v = Math.round(this.cells[i] * LOGODDS_SCALE);
      q[i] = v > 127 ? 127 : v < -127 ? -127 : v;
    }
    const s = this.summary();
    return {
      version: 1,
      frame: 'odom',
      frameId: this.frameId,
      resolution: this.resolution,
      originX: this.originX,
      originY: this.originY,
      width: this.width,
      height: this.height,
      encoding: 'int8-logodds-b64',
      cells: Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString('base64'),
      occupiedAbove: this.occupiedAbove,
      freeBelow: this.freeBelow,
      poseCount: this.poseCount,
      lastIntegratedAt: s.lastIntegratedAt,
      knownCells: s.knownCells,
      occupiedCells: s.occupiedCells,
    };
  }

  /**
   * Rebuild a map from a snapshot. Returns `null` (never a wrong map) when the
   * snapshot's `frameId` does not match `opts.frameId`, when either side has no
   * frame id at all, or when the payload is malformed.
   */
  static fromSnapshot(
    snap: unknown,
    opts: OccupancyMapOptions = {},
  ): { map: OccupancyMap; reason?: undefined } | { map: null; reason: string } {
    if (!snap || typeof snap !== 'object') return { map: null, reason: 'snapshot is not an object' };
    const s = snap as Partial<OccupancyMapSnapshot>;
    if (s.version !== 1 || s.encoding !== 'int8-logodds-b64') return { map: null, reason: 'unknown snapshot version/encoding' };
    if (typeof s.cells !== 'string' || typeof s.width !== 'number' || typeof s.height !== 'number')
      return { map: null, reason: 'snapshot is missing cells/width/height' };
    if (typeof s.resolution !== 'number' || typeof s.originX !== 'number' || typeof s.originY !== 'number')
      return { map: null, reason: 'snapshot is missing geometry' };
    const want = opts.frameId ?? null;
    const have = s.frameId ?? null;
    if (want === null || have === null)
      return { map: null, reason: 'no odometry session id to validate the stored map against' };
    if (want !== have) return { map: null, reason: `stored map belongs to odometry session ${have}, this one is ${want}` };
    if (Math.abs(s.resolution - (opts.resolutionM ?? DEFAULTS.resolutionM)) > 1e-9)
      return { map: null, reason: `stored map resolution ${s.resolution} differs from configured` };
    const buf = Buffer.from(s.cells, 'base64');
    if (buf.length !== s.width * s.height) return { map: null, reason: 'cell payload length does not match width×height' };

    const map = new OccupancyMap({ ...opts, resolutionM: s.resolution });
    if (s.width > map.maxCells || s.height > map.maxCells) return { map: null, reason: 'stored map exceeds the configured size cap' };
    map.width = s.width;
    map.height = s.height;
    map.originX = s.originX;
    map.originY = s.originY;
    map.cells = new Float32Array(s.width * s.height);
    const q = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < q.length; i++) map.cells[i] = q[i] / LOGODDS_SCALE;
    if (map.decayS > 0) map.seenS = new Uint32Array(s.width * s.height);
    map.poseCount = typeof s.poseCount === 'number' ? s.poseCount : 0;
    map.lastIntegratedMs =
      typeof s.lastIntegratedAt === 'string' && !Number.isNaN(Date.parse(s.lastIntegratedAt))
        ? Date.parse(s.lastIntegratedAt)
        : null;
    return { map };
  }

  /**
   * Binary PGM (P5) for eyeballing: occupied = black, free = white,
   * unknown = grey. Row 0 of the image is the TOP, i.e. the largest y — the
   * usual map convention, so north is up.
   */
  toPgm(): Buffer {
    const header = Buffer.from(`P5\n# odom-frame occupancy, ${this.resolution} m/cell, origin (${this.originX}, ${this.originY})\n${this.width} ${this.height}\n255\n`, 'ascii');
    const body = Buffer.alloc(this.width * this.height, 128);
    for (let row = 0; row < this.height; row++) {
      const srcRow = this.height - 1 - row;
      for (let col = 0; col < this.width; col++) {
        const v = this.cells[srcRow * this.width + col];
        body[row * this.width + col] = v > this.occupiedAbove ? 0 : v < this.freeBelow ? 255 : 128;
      }
    }
    return Buffer.concat([header, body]);
  }
}
