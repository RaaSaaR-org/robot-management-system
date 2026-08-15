/**
 * @file range.ts
 * @description Turns a LiDAR point cloud into the one number Agent Mode cannot
 *              get from the VLM: how far away the thing at a given bearing is.
 *              Pure geometry over a `PointCloudFrame`, plus `RangeSensor`, the
 *              live handle that takes ONE snapshot per observation and answers
 *              every bearing from it.
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import type { PointCloudFrame } from '../robot/types.js';
import { normalizeDeg, RAD_TO_DEG } from './types.js';

/**
 * Cone half-width, in degrees. 8° is not a tuning knob picked for looks: the
 * bearing that feeds this function comes from the VLM via `bearingFromImageX`
 * and carries 7.2° mean absolute error (measured against the MJCF room scene,
 * see vision.ts). A cone narrower than that error would routinely miss the very
 * object it is aimed at and report "nothing there".
 */
const DEFAULT_HALF_ANGLE_DEG = 8;
/**
 * Returns closer than this are discarded. On the real MID-360 roughly half of
 * every raw frame is the sensor seeing its own housing/mount at < 0.3 m, so a
 * naive `min(range)` answers ~0 m for every bearing. 0.35 m sits above that
 * blob; nothing useful for navigation lives inside it anyway, because the robot
 * cannot walk 0.35 m without the obstacle already being under its own feet.
 */
export const DEFAULT_MIN_RANGE_M = 0.35;
/** Beyond this, a return says nothing actionable about the current block. */
const DEFAULT_MAX_RANGE_M = 12;
/**
 * Height band above the floor plane. `g1_sidecar.py::_normalize_mid360_frame`
 * un-inverts the (physically upside-down) MID-360 and anchors the floor to
 * z = 0, so these are metres above the floor. 0.15 m drops floor returns and
 * the ripple of near-floor noise that would otherwise read as an obstacle at
 * every bearing; 1.8 m drops ceiling and door-frame returns.
 *
 * Note what the band does NOT do: the sensor's vertical fan is about -52°..+7°
 * from ~1.29-1.34 m up, so at 2 m the highest thing it can see at all is around
 * 1.55 m. An object above the fan produces no returns — which is why a null
 * range means UNKNOWN and never "clear".
 */
export const DEFAULT_MIN_HEIGHT_M = 0.15;
export const DEFAULT_MAX_HEIGHT_M = 1.8;
/** Fewer accepted returns than this is speckle, not a surface. */
const DEFAULT_MIN_POINTS = 6;
/**
 * Fallback order statistic, used only when no group of returns is tight enough
 * to be called a surface (see {@link nearestSurface}).
 *
 * The minimum is one stray return (a dust mote, a mixed pixel on an edge) and
 * would stop the robot early and at random. The median is the middle of
 * whatever is in the cone, which for a wall behind a table is behind the table.
 * A low percentile sits between the two.
 */
const DEFAULT_PERCENTILE = 0.2;
/**
 * How far apart two returns may be along the line of sight and still be called
 * the same surface.
 *
 * This exists because a percentile alone answers the wrong question. Measured
 * on `g1_dex3_room_scene.xml` with the sim's ray-LiDAR (a 360-ray × 24-ring
 * fan), standing 2.5 m in front of the table: the nearest real surface in the
 * corridor is 1.83 m (the table's near edge), the p20 of the corridor returns
 * is 2.22 m — because the wall 3.2 m back fills most of the corridor and
 * outvotes the table. The number is then 0.39 m more free space than exists,
 * and `forwardClearance` exists precisely to stop the robot walking into that
 * table.
 *
 * So the rule is "the nearest range at which at least `minPoints` returns
 * agree", not "the nth-smallest range". A single stray still has no company and
 * is skipped; a real surface brings its neighbours. 0.25 m is comfortably more
 * than the depth spread a flat surface shows across the corridor or the cone,
 * and comfortably less than the gap between one piece of furniture and the wall
 * behind it.
 */
const DEFAULT_CLUSTER_DEPTH_M = 0.25;
/**
 * Half-width of the corridor `forwardClearance` looks down, in metres —
 * a width, not an angle, because the robot's footprint does not fan out with
 * distance. An angular cone is uselessly wide at 5 m (a 8° cone spans 1.4 m,
 * catching furniture the robot would walk past) and uselessly narrow at 0.5 m
 * (0.14 m, narrower than the robot). 0.35 m each side ≈ the G1's shoulder
 * width plus margin.
 */
const DEFAULT_CORRIDOR_HALF_WIDTH_M = 0.35;
/**
 * How long one cloud may serve. A `scan_room` look yields up to 8 entities from
 * a single camera frame; ranging them against 8 different clouds would be both
 * slower and less coherent than ranging them against the one cloud that was
 * current when the frame was taken.
 */
const DEFAULT_CACHE_MS = 400;

export interface RangeOptions {
  /** Cone half-width in degrees (default 8 — sized to the VLM's bearing error). */
  halfAngleDeg?: number;
  /** Reject returns nearer than this (default 0.35 — the self-return blob). */
  minRangeM?: number;
  /** Reject returns further than this (default 12). */
  maxRangeM?: number;
  /** Reject returns below this height above the floor plane (default 0.15). */
  minHeightM?: number;
  /** Reject returns above this height above the floor plane (default 1.8). */
  maxHeightM?: number;
  /** Fewer accepted returns than this → `null` (default 6). */
  minPoints?: number;
  /** Fallback order statistic when no cluster is found, 0..1 (default 0.2). */
  percentile?: number;
  /** Depth window `minPoints` returns must agree within (default 0.25 m). */
  clusterDepthM?: number;
  /** Half-width of the `forwardClearance` corridor in metres (default 0.35). */
  corridorHalfWidthM?: number;
}

export interface RangeReading {
  /** Horizontal distance to the nearest surface in the cone, in metres. */
  distanceM: number;
  /** How many returns backed this reading. */
  pointCount: number;
  /**
   * Spread of the accepted returns (p90 − p10), in metres. Small means one flat
   * surface filled the cone; large means the cone caught several things at
   * different depths and `distanceM` is the nearest of them, not "the object".
   */
  spreadM: number;
  /** The bearing that was asked for, degrees, positive = robot's LEFT. */
  bearingDeg: number;
  /** The cone half-width the reading was taken with. */
  halfAngleDeg: number;
}

/** Everything one `measure()` call learned from one cloud. */
export interface RangeMeasurement {
  /** One entry per requested bearing, `null` where the range is unknown. */
  readings: (RangeReading | null)[];
  /** Nearest surface straight ahead inside the corridor, `null` if unknown. */
  clearanceM: number | null;
  /** False when no cloud could be obtained at all — every reading is `null`. */
  ok: boolean;
  /** Why `ok` is false, in words a block log can show verbatim. */
  reason?: string;
}

export interface RangeSensorDeps {
  /** Default: `hardwareClient.snapshotPointCloud(sensor)`. Throws when no sidecar. */
  snapshot?: (sensor: string) => Promise<PointCloudFrame>;
  sensor?: string;
  enabled?: boolean;
  options?: RangeOptions;
  /** How long one cloud may serve all bearings of one observation (default 400). */
  cacheMs?: number;
  /**
   * Called with every FRESH cloud (never a cache hit) the moment it arrives —
   * the single tap the occupancy map (TASK-206) hangs off. Runs synchronously
   * inside `snapshot()`, so it must be cheap and must not throw; a throw is
   * caught and logged, never surfaced to the observation.
   */
  onFrame?: (frame: PointCloudFrame, atMs: number) => void;
}

/** Resolved options — every field present, so the math never re-defaults. */
interface ResolvedOptions {
  halfAngleDeg: number;
  minRangeM: number;
  maxRangeM: number;
  minHeightM: number;
  maxHeightM: number;
  minPoints: number;
  percentile: number;
  clusterDepthM: number;
  corridorHalfWidthM: number;
}

function resolve(opts: RangeOptions | undefined): ResolvedOptions {
  return {
    halfAngleDeg: opts?.halfAngleDeg ?? DEFAULT_HALF_ANGLE_DEG,
    minRangeM: opts?.minRangeM ?? DEFAULT_MIN_RANGE_M,
    maxRangeM: opts?.maxRangeM ?? DEFAULT_MAX_RANGE_M,
    minHeightM: opts?.minHeightM ?? DEFAULT_MIN_HEIGHT_M,
    maxHeightM: opts?.maxHeightM ?? DEFAULT_MAX_HEIGHT_M,
    minPoints: opts?.minPoints ?? DEFAULT_MIN_POINTS,
    percentile: opts?.percentile ?? DEFAULT_PERCENTILE,
    clusterDepthM: opts?.clusterDepthM ?? DEFAULT_CLUSTER_DEPTH_M,
    corridorHalfWidthM: opts?.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M,
  };
}

/** Nearest-rank percentile of an ASCENDING-sorted, non-empty array. */
function percentileOf(sortedAsc: number[], p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.round(clamped * (sortedAsc.length - 1));
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, idx))];
}

/**
 * Range of the NEAREST surface in an ASCENDING-sorted, non-empty array of
 * ranges: the smallest range at which at least `minPoints` returns agree to
 * within `clusterDepthM`.
 *
 * Erring towards the near side is the safe direction and the only one. Every
 * consumer of this number is deciding how far the robot may still move, so an
 * answer that is too large is a collision and an answer that is too small is a
 * cautious stop. See {@link DEFAULT_CLUSTER_DEPTH_M} for the measurement that
 * made the plain percentile insufficient.
 *
 * Falls back to the percentile when nothing clusters at all — a cone full of
 * returns at every depth (a doorway edge-on, a ramp) genuinely has no single
 * surface, and the order statistic is the honest summary of it.
 */
function nearestSurface(sortedAsc: number[], o: ResolvedOptions): number {
  const last = sortedAsc.length - o.minPoints;
  for (let i = 0; i <= last; i++) {
    if (sortedAsc[i + o.minPoints - 1] - sortedAsc[i] <= o.clusterDepthM) return sortedAsc[i];
  }
  return percentileOf(sortedAsc, o.percentile);
}

/**
 * The frame's points as a plain iterable of accepted candidates.
 *
 * `positions` is flat XYZ in metres, `base_link`, x forward / y left / z up
 * with the floor at z = 0. Anything malformed (odd length, NaN) is skipped
 * rather than propagated — a NaN that reaches a percentile poisons the answer
 * silently, and a silently wrong metre is exactly what this module exists to
 * avoid.
 */
function* candidates(
  frame: PointCloudFrame,
  o: ResolvedOptions
): Generator<{ x: number; y: number; range: number; azimuthDeg: number }> {
  const p = frame.positions;
  if (!Array.isArray(p)) return;

  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (z < o.minHeightM || z > o.maxHeightM) continue;

    // Horizontal range: the distance the robot has to WALK. The 3D slant range
    // would over-report by the height difference — a table top 1.2 m up at 0.5 m
    // horizontally is 1.3 m of slant range but half a metre of walking.
    const range = Math.hypot(x, y);
    if (range < o.minRangeM || range > o.maxRangeM) continue;

    yield { x, y, range, azimuthDeg: Math.atan2(y, x) * RAD_TO_DEG };
  }
}

/** Build a reading from accepted ranges, or `null` when there are too few. */
function readingFrom(
  ranges: number[],
  bearingDeg: number,
  o: ResolvedOptions
): RangeReading | null {
  if (ranges.length < o.minPoints) return null;
  ranges.sort((a, b) => a - b);
  return {
    distanceM: nearestSurface(ranges, o),
    pointCount: ranges.length,
    spreadM: percentileOf(ranges, 0.9) - percentileOf(ranges, 0.1),
    bearingDeg,
    halfAngleDeg: o.halfAngleDeg,
  };
}

/**
 * Distance to the nearest surface within a cone around `bearingDeg`.
 *
 * Bearings are degrees, POSITIVE = the robot's LEFT (CCW) — the same convention
 * `vision.ts` produces and `turn` consumes.
 *
 * HONESTY NOTE, because this is the function most likely to be misread: LiDAR
 * returns are unlabelled. Nothing here knows which return belongs to "the table
 * the VLM named". The claim this function makes is exactly "the nearest surface
 * inside a ±halfAngleDeg cone about that bearing, in the accepted height band",
 * nothing more. If the VLM named a chair and a wall stands closer in the same
 * direction, this returns the wall.
 *
 * @returns `null` for UNKNOWN — no cloud, no returns in the cone, or too few to
 *          be a surface. Never 0 and never Infinity: a caller must be forced to
 *          distinguish "I do not know" from "it is right here" / "it is clear".
 */
export function rangeAtBearing(
  frame: PointCloudFrame | null | undefined,
  bearingDeg: number,
  opts?: RangeOptions
): RangeReading | null {
  if (!frame || !Number.isFinite(bearingDeg)) return null;
  const o = resolve(opts);
  const target = normalizeDeg(bearingDeg);
  const ranges: number[] = [];

  for (const c of candidates(frame, o)) {
    // normalizeDeg folds the difference into (-180, 180], so a target at 179°
    // still matches a return at -179° (2° apart, not 358°).
    if (Math.abs(normalizeDeg(c.azimuthDeg - target)) > o.halfAngleDeg) continue;
    ranges.push(c.range);
  }

  return readingFrom(ranges, normalizeDeg(bearingDeg), o);
}

/**
 * `rangeAtBearing` for several bearings against ONE frame — the shape Agent
 * Mode actually needs, since one `look` yields up to 8 entities that must all be
 * ranged against the cloud that was current when the camera frame was taken.
 */
export function rangesAtBearings(
  frame: PointCloudFrame | null | undefined,
  bearingsDeg: number[],
  opts?: RangeOptions
): (RangeReading | null)[] {
  if (!frame) return bearingsDeg.map(() => null);
  const o = resolve(opts);
  const targets = bearingsDeg.map((b) => (Number.isFinite(b) ? normalizeDeg(b) : null));
  const buckets: number[][] = bearingsDeg.map(() => []);

  // One pass over the cloud for all bearings: a real MID-360 frame is ~20k
  // points after normalisation and eight separate passes buy nothing.
  for (const c of candidates(frame, o)) {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t === null) continue;
      if (Math.abs(normalizeDeg(c.azimuthDeg - t)) > o.halfAngleDeg) continue;
      buckets[i].push(c.range);
    }
  }

  return buckets.map((ranges, i) => {
    const t = targets[i];
    return t === null ? null : readingFrom(ranges, t, o);
  });
}

/**
 * Nearest surface straight ahead, inside a corridor as wide as the robot.
 *
 * This is the number that stops `goto` from walking into furniture, which today
 * it does by design ("arrival by contact", see navigator.ts). Reported distance
 * is the ALONG-TRACK distance (x), not the radial one: for an obstacle at the
 * corridor edge, x is what the robot may still walk before touching it.
 *
 * @returns `null` for UNKNOWN. Never 0 — "unknown" and "flush against a wall"
 *          must not be the same value.
 */
export function forwardClearance(
  frame: PointCloudFrame | null | undefined,
  opts?: RangeOptions
): number | null {
  if (!frame) return null;
  const o = resolve(opts);
  const ranges: number[] = [];

  for (const c of candidates(frame, o)) {
    if (c.x < o.minRangeM) continue; // behind, beside, or inside the self-return blob
    if (Math.abs(c.y) > o.corridorHalfWidthM) continue;
    ranges.push(c.x);
  }

  if (ranges.length < o.minPoints) return null;
  ranges.sort((a, b) => a - b);
  return nearestSurface(ranges, o);
}

/** The `config.agentMode` keys this module reads; all optional on purpose. */
interface RangeConfigKeys {
  rangeEnabled: boolean;
  rangeSensor: string;
  rangeMaxM: number;
  rangeConeDeg: number;
  rangeMinM: number;
}

/**
 * Read the range keys defensively. They may not exist yet in `config.agentMode`
 * — this module and the config/env wiring land separately — so every read is a
 * type-checked `?? fallback` instead of a property access that would compile
 * against one version of the config and crash against the other.
 */
function rangeConfig(): Partial<RangeConfigKeys> {
  const raw = config.agentMode as unknown as Partial<Record<keyof RangeConfigKeys, unknown>>;
  const out: Partial<RangeConfigKeys> = {};
  if (typeof raw.rangeEnabled === 'boolean') out.rangeEnabled = raw.rangeEnabled;
  if (typeof raw.rangeSensor === 'string' && raw.rangeSensor) out.rangeSensor = raw.rangeSensor;
  if (typeof raw.rangeMaxM === 'number' && Number.isFinite(raw.rangeMaxM)) out.rangeMaxM = raw.rangeMaxM;
  if (typeof raw.rangeConeDeg === 'number' && Number.isFinite(raw.rangeConeDeg))
    out.rangeConeDeg = raw.rangeConeDeg;
  if (typeof raw.rangeMinM === 'number' && Number.isFinite(raw.rangeMinM)) out.rangeMinM = raw.rangeMinM;
  return out;
}

/**
 * The name the real G1 sidecar publishes the MID-360 under. Proven live on
 * 2026-07-18: `rt/utlidar/cloud_livox_mid360` (DDS domain 0) → g1_sidecar.py →
 * `GET :8767/pointcloud/mid360_lidar/snapshot`.
 */
const DEFAULT_SENSOR = 'mid360_lidar';

/**
 * Live range sensing for Agent Mode.
 *
 * Deliberately talks to {@link hardwareClient} and NOT to `RobotStateManager`:
 * `getPointCloudFrame()` falls back to `pointcloud-sim.ts`, which fabricates a
 * room that does not exist. A fabricated metre would be indistinguishable from
 * a measured one at the call site and the robot would walk on it. Here, no
 * sidecar means an honest `{ ok: false }`.
 */
export class RangeSensor {
  private readonly snapshotFn: (sensor: string) => Promise<PointCloudFrame>;
  private readonly sensor: string;
  private readonly enabled: boolean;
  private readonly options: RangeOptions;
  private readonly cacheMs: number;
  /**
   * Last snapshot attempt, successful or not. Failures are cached too: with no
   * sidecar, `snapshotPointCloud` costs a 1.5 s timeout, and eight entities of
   * one `scan_room` would otherwise stall a block for twelve seconds.
   */
  private cache: { at: number; frame: PointCloudFrame | null; error: string | null } | null = null;
  private frameListener: ((frame: PointCloudFrame, atMs: number) => void) | null;
  private frameListenerFailedAtMs = 0;

  constructor(deps: RangeSensorDeps = {}) {
    const cfg = rangeConfig();
    this.snapshotFn = deps.snapshot ?? ((sensor) => hardwareClient.snapshotPointCloud(sensor));
    this.sensor = deps.sensor ?? cfg.rangeSensor ?? DEFAULT_SENSOR;
    // Enabled unless someone says otherwise: without the config key present the
    // useful default is "try, and degrade honestly when there is no sidecar".
    this.enabled = deps.enabled ?? cfg.rangeEnabled ?? true;
    this.options = {
      halfAngleDeg: cfg.rangeConeDeg ?? DEFAULT_HALF_ANGLE_DEG,
      minRangeM: cfg.rangeMinM ?? DEFAULT_MIN_RANGE_M,
      maxRangeM: cfg.rangeMaxM ?? DEFAULT_MAX_RANGE_M,
      // Explicit options win over config, so a caller (or a test) can be precise.
      ...deps.options,
    };
    this.cacheMs = deps.cacheMs ?? DEFAULT_CACHE_MS;
    this.frameListener = deps.onFrame ?? null;
  }

  /** Install (or clear) the fresh-frame tap after construction. */
  setFrameListener(cb: ((frame: PointCloudFrame, atMs: number) => void) | null): void {
    this.frameListener = cb;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Take one snapshot for its side effect only (feeding the frame listener),
   * honouring the cache and the failure backoff exactly like `measure()`. The
   * background map sweep uses this; it never throws and never returns the cloud
   * — nothing but `measure()` may hand clouds to callers.
   */
  async probe(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.snapshot();
      return true;
    } catch {
      return false;
    }
  }

  /** Drop everything cached, cloud and failure alike. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Drop a cached CLOUD but keep a cached FAILURE. Call this after the base has
   * moved.
   *
   * The two halves of the cache age for opposite reasons. A cloud describes the
   * pose it was taken in, and after a turn its bearings point at different
   * things — the cache window is 400 ms and a stage's motion can be shorter
   * (`walk` and `turn` both floor at a fraction of a second), so "it cannot
   * still be current" is not something the clock can be trusted to enforce. A
   * missing sidecar, in contrast, does not become present by walking, and
   * re-probing it costs a 1.5 s timeout per look — eight of them in one
   * `scan_room`. So motion expires the cloud and only the cloud.
   */
  invalidateAfterMotion(): void {
    if (this.cache?.frame) this.cache = null;
  }

  /**
   * Range every given bearing against ONE cloud.
   *
   * NEVER throws. No sidecar, a timeout, an empty cloud → `{ ok: false, reason }`
   * with all readings `null`. Losing range must degrade Agent Mode to its
   * previous bearing-only behaviour, never fail a block.
   */
  async measure(bearingsDeg: number[]): Promise<RangeMeasurement> {
    const none = (reason: string): RangeMeasurement => ({
      readings: bearingsDeg.map(() => null),
      clearanceM: null,
      ok: false,
      reason,
    });

    if (!this.enabled) return none('range sensing is disabled');

    let frame: PointCloudFrame;
    try {
      frame = await this.snapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return none(`no point cloud from sensor "${this.sensor}": ${message}`);
    }

    // Zero points is UNKNOWN, not "nothing in the way" — a dead publisher and an
    // empty room produce the identical array.
    const count = Array.isArray(frame.positions) ? Math.floor(frame.positions.length / 3) : 0;
    if (count === 0) return none(`sensor "${this.sensor}" returned an empty point cloud`);

    return {
      readings: rangesAtBearings(frame, bearingsDeg, this.options),
      clearanceM: forwardClearance(frame, this.options),
      ok: true,
    };
  }

  /** Cached snapshot; re-throws the cached error inside the cache window. */
  private async snapshot(): Promise<PointCloudFrame> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.cacheMs) {
      if (this.cache.frame) return this.cache.frame;
      throw new Error(this.cache.error ?? 'point cloud unavailable');
    }

    try {
      const frame = await this.snapshotFn(this.sensor);
      const at = Date.now();
      this.cache = { at, frame, error: null };
      if (this.frameListener) {
        try {
          this.frameListener(frame, at);
        } catch (err) {
          // Once a minute is enough: the map is a passenger, the observation is not.
          if (at - this.frameListenerFailedAtMs > 60_000) {
            this.frameListenerFailedAtMs = at;
            console.warn('[Range] frame listener failed:', err instanceof Error ? err.message : err);
          }
        }
      }
      return frame;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.cache = { at: Date.now(), frame: null, error: message };
      throw err;
    }
  }
}
