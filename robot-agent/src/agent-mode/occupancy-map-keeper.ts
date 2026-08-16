/**
 * @file occupancy-map-keeper.ts
 * @description Owns the live {@link OccupancyMap} for one Agent Mode
 *              controller (TASK-206): pairs every fresh LiDAR cloud with a
 *              pose, guards the odometry session (sidecar boot id), persists
 *              the grid, and runs the optional background sweep while the
 *              robot walks. All I/O of the map lives here; the map itself
 *              stays pure.
 * @feature agentmode
 * @status live
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CachedBasePose } from '../hardware/HardwareClient.js';
import type { PointCloudFrame } from '../robot/types.js';
import {
  OccupancyMap,
  type OccupancyMapOptions,
  type OccupancyMapSnapshot,
  type OccupancyMapSummary,
} from './occupancy-map.js';
import type { RangeSensor } from './range.js';
import { WorldCloud, type WorldCloudOptions } from './world-cloud.js';

export interface MapKeeperDeps {
  /** Off: nothing is integrated, nothing is written, `summary()` is null. */
  enabled: boolean;
  /** Grid options; `frameId` is managed here and ignored if given. */
  options?: OccupancyMapOptions;
  /** Where to persist; null/empty disables persistence. */
  path?: string | null;
  /** Extra snapshots per second while active (walking); 0 disables the sweep. */
  sweepHz?: number;
  /** The single live range sensor — the keeper taps its fresh frames. */
  range: RangeSensor;
  /** Cached planar pose (2 s poll). */
  getPose: () => CachedBasePose | null;
  /**
   * Fetch a pose right now when the cached one is too old to pair with a
   * cloud. Optional: without it, stale poses simply skip the frame.
   */
  samplePose?: () => Promise<CachedBasePose | null>;
  /** Odometry session id (`/health.boot_id`); null when the sidecar has none. */
  getBootId: () => string | null;
  now?: () => number;
  /** Persist every N-th integration (default 50). */
  saveEvery?: number;
  /** Max |cloud time − pose time| to pair them (default 750 ms). */
  poseMaxAgeMs?: number;
  /**
   * A cached pose older than this is re-sampled before pairing (default 150 ms).
   * 750 ms is the honesty limit, not a target: at the sim's 90°/s turn rate a
   * pose half a second old smears every wall into a rotated ghost.
   */
  poseFreshMs?: number;
  log?: (msg: string) => void;
  /**
   * The 3-D world cloud (TASK-211) fed by the same frames. Off by default in
   * tests; the controller turns it on with the map. `path` null = memory only.
   */
  cloud?: { enabled: boolean; path?: string | null; options?: WorldCloudOptions };
}

/** What `/map` and the state summary read. */
export interface MapKeeperStatus {
  enabled: boolean;
  frameId: string | null;
  persisted: boolean;
  integrations: number;
  skippedNoPose: number;
  skippedStalePose: number;
  lastSkipReason: string | null;
  /** The world cloud (TASK-211): null when off. */
  cloud: { enabled: boolean; persisted: boolean; pointCount: number; frames: number; voxelM: number; lastIntegratedAt: string | null } | null;
}

/**
 * The map's chaperone. Never throws out of `onFrame` — the map is a passenger
 * on the observation path and must never fail a block.
 */
export class MapKeeper {
  private readonly enabled: boolean;
  private readonly options: OccupancyMapOptions;
  private readonly path: string | null;
  private readonly sweepHz: number;
  private readonly range: RangeSensor;
  private readonly getPose: () => CachedBasePose | null;
  private readonly samplePose: (() => Promise<CachedBasePose | null>) | null;
  private readonly getBootId: () => string | null;
  private readonly now: () => number;
  private readonly saveEvery: number;
  private readonly poseMaxAgeMs: number;
  private readonly poseFreshMs: number;
  private readonly log: (msg: string) => void;

  private map: OccupancyMap | null = null;
  private readonly cloudEnabled: boolean;
  private readonly cloudPath: string | null;
  private readonly cloudOptions: WorldCloudOptions;
  private cloud: WorldCloud | null = null;
  /** Boot ids we already tried to restore from disk — restore once per session. */
  private restoreTried = new Set<string>();
  private warnedNoBootId = false;
  private integrations = 0;
  private skippedNoPose = 0;
  private skippedStalePose = 0;
  private lastSkipReason: string | null = null;
  private lastSkipLogMs = 0;
  private lastSavedAtIntegration = 0;
  private saveInFlight = false;
  /** Per file, so a failing grid can never mask a failing cloud. */
  private lastSaveErrLogMs = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweepInFlight = false;
  private disposed = false;

  constructor(deps: MapKeeperDeps) {
    this.enabled = deps.enabled;
    const { frameId: _ignored, ...rest } = deps.options ?? {};
    void _ignored;
    this.options = rest;
    this.path = deps.path && deps.path.trim() ? deps.path : null;
    this.sweepHz = Number.isFinite(deps.sweepHz) && (deps.sweepHz ?? 0) > 0 ? (deps.sweepHz as number) : 0;
    this.range = deps.range;
    this.getPose = deps.getPose;
    this.samplePose = deps.samplePose ?? null;
    this.getBootId = deps.getBootId;
    this.now = deps.now ?? (() => Date.now());
    this.saveEvery = deps.saveEvery ?? 50;
    this.poseMaxAgeMs = deps.poseMaxAgeMs ?? 750;
    this.poseFreshMs = deps.poseFreshMs ?? 150;
    this.log = deps.log ?? ((m) => console.log(m));
    this.cloudEnabled = this.enabled && deps.cloud?.enabled === true;
    this.cloudPath = deps.cloud?.path && deps.cloud.path.trim() ? deps.cloud.path : null;
    const { frameId: _cf, ...cloudRest } = deps.cloud?.options ?? {};
    void _cf;
    this.cloudOptions = cloudRest;
    if (this.enabled) this.range.setFrameListener((frame, at) => this.onFrame(frame, at));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * The live map, or null when disabled / nothing integrated yet.
   *
   * A first read after a restart RESTORES the persisted map, provided the
   * sidecar's boot id is already known — the map on disk used to come back only
   * with the first lidar frame, i.e. the first motion block, so an agent that
   * had just restarted answered `/map` with nothing and planned "no map yet"
   * although the grid was sitting in `AGENT_MAP_PATH` (TASK-209). With no boot
   * id yet nothing is created here: a null-frame map could never be restored
   * into, and the first frame does the right thing anyway.
   */
  getMap(): OccupancyMap | null {
    if (!this.enabled) return null;
    if (!this.map && this.getBootId() !== null) this.ensureSession();
    return this.map;
  }

  /** The live world cloud (TASK-211), or null when off / no session yet. Same restore-on-read as the grid. */
  getCloud(): WorldCloud | null {
    if (!this.cloudEnabled) return null;
    if (!this.cloud && this.getBootId() !== null) this.ensureSession();
    return this.cloud;
  }

  isCloudEnabled(): boolean {
    return this.cloudEnabled;
  }

  summary(): OccupancyMapSummary | null {
    if (!this.enabled) return null;
    return this.getMap()?.summary() ?? { knownCells: 0, occupiedCells: 0, lastIntegratedAt: null };
  }

  snapshot(): OccupancyMapSnapshot | null {
    const map = this.getMap();
    return map ? map.toSnapshot() : null;
  }

  status(): MapKeeperStatus {
    return {
      enabled: this.enabled,
      frameId: this.map?.frameId ?? null,
      persisted: this.path !== null,
      integrations: this.integrations,
      skippedNoPose: this.skippedNoPose,
      skippedStalePose: this.skippedStalePose,
      lastSkipReason: this.lastSkipReason,
      cloud: this.cloudEnabled
        ? {
            enabled: true,
            persisted: this.cloudPath !== null,
            ...(this.getCloud()?.summary() ?? { pointCount: 0, frames: 0, voxelM: this.cloudOptions.voxelM ?? 0.05, lastIntegratedAt: null }),
          }
        : null,
    };
  }

  // ── frames ────────────────────────────────────────────────────────────────

  /**
   * A fresh cloud arrived. Synchronous entry (the range sensor calls it inline);
   * the actual pairing may await a fresh pose and runs detached.
   */
  onFrame(frame: PointCloudFrame, atMs: number): void {
    if (!this.enabled || this.disposed) return;
    void this.pairAndIntegrate(frame, atMs).catch((err) => {
      this.skip(`map integration failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async pairAndIntegrate(frame: PointCloudFrame, atMs: number): Promise<void> {
    let pose = this.getPose();
    if (pose && Math.abs(atMs - pose.atMs) > this.poseFreshMs && this.samplePose) {
      // The 2 s poll is usually older than the cloud; ask once, right now. If
      // that fails, fall back to the cached pose — the 750 ms gate below decides.
      pose = (await this.samplePose()) ?? pose;
    }
    if (!pose) {
      this.skippedNoPose++;
      this.skip('no pose — the map is not updated (never assumed at the origin)');
      return;
    }
    if (Math.abs(atMs - pose.atMs) > this.poseMaxAgeMs) {
      this.skippedStalePose++;
      this.skip(`pose is ${Math.round(Math.abs(atMs - pose.atMs))} ms from the cloud — skipped`);
      return;
    }
    const map = this.ensureSession();
    const report = map.integrate(frame, { x: pose.x, y: pose.y, yawDeg: pose.yawDeg }, atMs);
    if (!report.integrated) return;
    this.integrations++;
    this.lastSkipReason = null;
    if (this.cloud) {
      this.cloud.integrate(frame, { x: pose.x, y: pose.y, yawDeg: pose.yawDeg }, atMs);
      // What the grid has since carved free within lidar reach is gone from
      // the cloud too — that is how a moved chair leaves the picture. Every
      // frame, not every N-th: the carving that frees a cell is usually the
      // LAST look before the robot stands still, and a purge that waits for
      // more frames would leave the ghost standing exactly then. One linear
      // pass over ≤300k voxels is a few milliseconds.
      this.cloud.purgeFreed(map, { x: pose.x, y: pose.y, radiusM: this.cloudReachM() });
    }
    if (this.integrations - this.lastSavedAtIntegration >= this.saveEvery) this.saveSoon();
  }

  private cloudReachM(): number {
    return this.options.maxRangeM ?? 12;
  }

  /** Once a minute, not once a frame. */
  private skip(reason: string): void {
    this.lastSkipReason = reason;
    const t = this.now();
    if (t - this.lastSkipLogMs > 60_000) {
      this.lastSkipLogMs = t;
      this.log(`[Map] ${reason}`);
    }
  }

  /**
   * Make sure the live map belongs to the CURRENT odometry session. A changed
   * boot id (sidecar/sim restarted) means odometry re-zeroed under us — the old
   * grid is saved under its own id and a fresh one starts. Restore from disk is
   * attempted once per session and only when the id matches.
   */
  private ensureSession(): OccupancyMap {
    const bootId = this.getBootId();
    if (this.map && this.map.frameId === bootId) return this.map;

    if (this.map && this.map.frameId !== null && this.map.frameId !== bootId) {
      this.log(`[Map] odometry session changed (${this.map.frameId} → ${bootId ?? 'none'}) — starting a new map`);
      this.save();
    }

    if (bootId === null) {
      if (!this.warnedNoBootId) {
        this.warnedNoBootId = true;
        this.log('[Map] sidecar reports no boot_id — the map lives in memory only and is never restored');
      }
      this.map = new OccupancyMap({ ...this.options, frameId: null });
      this.cloud = this.cloudEnabled ? new WorldCloud({ ...this.cloudOptions, frameId: null }) : null;
      return this.map;
    }

    let restored: OccupancyMap | null = null;
    let restoredCloud: WorldCloud | null = null;
    if (!this.restoreTried.has(bootId)) {
      this.restoreTried.add(bootId);
      if (this.path) restored = this.load(bootId);
      if (this.cloudEnabled && this.cloudPath) restoredCloud = this.loadCloud(bootId);
    }
    this.map = restored ?? new OccupancyMap({ ...this.options, frameId: bootId });
    this.cloud = this.cloudEnabled ? (restoredCloud ?? new WorldCloud({ ...this.cloudOptions, frameId: bootId })) : null;
    return this.map;
  }

  private loadCloud(bootId: string): WorldCloud | null {
    if (!this.cloudPath) return null;
    let raw: string;
    try {
      raw = readFileSync(this.cloudPath, 'utf-8');
    } catch {
      return null;
    }
    try {
      const result = WorldCloud.fromSnapshot(JSON.parse(raw) as unknown, { ...this.cloudOptions, frameId: bootId });
      if (!result.cloud) {
        this.log(`[Map] not restoring cloud ${this.cloudPath}: ${result.reason}`);
        return null;
      }
      this.log(`[Map] restored ${result.cloud.pointCount} cloud points from ${this.cloudPath}`);
      return result.cloud;
    } catch (err) {
      this.log(`[Map] not restoring cloud ${this.cloudPath}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private load(bootId: string): OccupancyMap | null {
    if (!this.path) return null;
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf-8');
    } catch {
      return null; // no file yet — the normal first boot
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const result = OccupancyMap.fromSnapshot(parsed, { ...this.options, frameId: bootId });
      if (!result.map) {
        this.log(`[Map] not restoring ${this.path}: ${result.reason}`);
        return null;
      }
      const s = result.map.summary();
      this.log(`[Map] restored ${s.knownCells} known / ${s.occupiedCells} occupied cells from ${this.path}`);
      return result.map;
    } catch (err) {
      this.log(`[Map] not restoring ${this.path}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Atomic write (tmp + rename), synchronously. Never throws. Skipped without a
   * session id.
   *
   * Blocking is right HERE and only here: this is the shutdown path
   * (`dispose()`, the controller's `persistMap()` beside `saveStateSync()`) and
   * the session change, where the old map must land before it is replaced. The
   * periodic save goes through {@link saveSoon}, which is not on the shutdown
   * clock and must not stall the agent.
   */
  save(): boolean {
    const map = this.map;
    if (!this.enabled || !this.path || !map || !map.isAllocated() || map.frameId === null) return false;
    // Claim the watermark before writing, not after. It used to advance only on
    // success, so a write that threw (full disk, read-only mount) left the
    // "N integrations since the last save" guard true and the next lidar frame
    // tried again — a multi-megabyte stringify, a failing write and an
    // unthrottled log line per frame, for as long as the disk stayed full.
    this.lastSavedAtIntegration = this.integrations;
    let ok = true;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(map.toSnapshot()), 'utf-8');
      renameSync(tmp, this.path);
    } catch (err) {
      this.logSaveError(this.path, err);
      ok = false;
    }
    const cloud = this.cloudSaveTarget(map);
    if (cloud) {
      try {
        mkdirSync(dirname(cloud.path), { recursive: true });
        const ctmp = `${cloud.path}.tmp`;
        writeFileSync(ctmp, JSON.stringify(cloud.cloud.toSnapshot()), 'utf-8');
        renameSync(ctmp, cloud.path);
      } catch (err) {
        // Its own try/catch and its own path in the message: a failing cloud
        // write used to be swallowed under the GRID's watermark and reported
        // under the GRID's path, so the operator read "could not save
        // occupancy-map.json" while that file was landing fine and the 3-D
        // cloud was the thing quietly lost across every restart.
        this.logSaveError(cloud.path, err);
        ok = false;
      }
    }
    return ok;
  }

  /** Nothing to write, or the cloud belongs to another session — then nothing. */
  private cloudSaveTarget(map: OccupancyMap): { cloud: WorldCloud; path: string } | null {
    if (!this.cloud || !this.cloudPath) return null;
    if (this.cloud.frameId !== map.frameId) return null;
    return { cloud: this.cloud, path: this.cloudPath };
  }

  /**
   * The periodic save, off the lidar frame path.
   *
   * `onFrame` runs synchronously inside the range sensor's `snapshot()`, on the
   * agent's only event loop — the same loop serving A2A/REST, the telemetry
   * socket and the loco commands. At defaults the payload is a 300k-point cloud
   * plus the grid, ~7 MB of JSON, so a `writeFileSync` there froze everything
   * for a few hundred milliseconds mid-walk. The write now goes through
   * `fs/promises` from a `setImmediate`, so it never runs inside the frame
   * callback and the I/O itself leaves the loop; one save at a time, and a new
   * request while one is in flight is dropped rather than queued (the next
   * frames make it up anyway).
   */
  private saveSoon(): void {
    const map = this.map;
    if (!this.enabled || !this.path || !map || !map.isAllocated() || map.frameId === null) return;
    if (this.saveInFlight) return;
    this.saveInFlight = true;
    // Same rule as `save()`: the watermark is claimed up front, so a failing
    // disk is retried once per `saveEvery`, not once per frame.
    this.lastSavedAtIntegration = this.integrations;
    const path = this.path;
    const cloud = this.cloudSaveTarget(map);
    setImmediate(() => {
      // The map is a passenger: nothing it does may outlive the agent.
      if (this.disposed) {
        this.saveInFlight = false;
        return;
      }
      void this.writeSnapshots(map, path, cloud).finally(() => {
        this.saveInFlight = false;
      });
    });
  }

  /** The async half of {@link saveSoon}. Never throws. */
  private async writeSnapshots(
    map: OccupancyMap,
    path: string,
    cloud: { cloud: WorldCloud; path: string } | null,
  ): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(map.toSnapshot()), 'utf-8');
      await rename(tmp, path);
    } catch (err) {
      this.logSaveError(path, err);
    }
    if (!cloud || this.disposed) return;
    try {
      await mkdir(dirname(cloud.path), { recursive: true });
      const ctmp = `${cloud.path}.tmp`;
      await writeFile(ctmp, JSON.stringify(cloud.cloud.toSnapshot()), 'utf-8');
      await rename(ctmp, cloud.path);
    } catch (err) {
      this.logSaveError(cloud.path, err);
    }
  }

  /** Once a minute per file, like {@link skip} — not once a frame. */
  private logSaveError(path: string, err: unknown): void {
    const t = this.now();
    const last = this.lastSaveErrLogMs.get(path) ?? Number.NEGATIVE_INFINITY;
    if (t - last < 60_000) return;
    this.lastSaveErrLogMs.set(path, t);
    this.log(`[Map] could not save ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── sweep ─────────────────────────────────────────────────────────────────

  /**
   * Turn the background sweep on/off. Meant to track "a motion block is
   * running". Each tick is one `range.probe()`, which honours the sensor's cache
   * and failure backoff — a dead sidecar costs one timeout per backoff window,
   * not one per tick.
   */
  setSweeping(active: boolean): void {
    if (!this.enabled || this.sweepHz <= 0 || !this.range.isEnabled()) return;
    if (active && !this.sweepTimer && !this.disposed) {
      const periodMs = Math.max(200, Math.round(1000 / this.sweepHz));
      this.sweepTimer = setInterval(() => {
        if (this.sweepInFlight) return;
        this.sweepInFlight = true;
        void this.range.probe().finally(() => {
          this.sweepInFlight = false;
        });
      }, periodMs);
      this.sweepTimer.unref?.();
    } else if (!active && this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  isSweeping(): boolean {
    return this.sweepTimer !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.setSweeping(false);
    this.save();
    if (this.enabled) this.range.setFrameListener(null);
  }
}
