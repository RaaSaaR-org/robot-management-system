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
    if (this.integrations - this.lastSavedAtIntegration >= this.saveEvery) this.save();
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

  /** Atomic write (tmp + rename). Never throws. Skipped without a session id. */
  save(): boolean {
    if (!this.enabled || !this.path || !this.map || !this.map.isAllocated()) return false;
    if (this.map.frameId === null) return false;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.map.toSnapshot()), 'utf-8');
      renameSync(tmp, this.path);
      this.lastSavedAtIntegration = this.integrations;
      if (this.cloud && this.cloudPath && this.cloud.frameId === this.map.frameId) {
        mkdirSync(dirname(this.cloudPath), { recursive: true });
        const ctmp = `${this.cloudPath}.tmp`;
        writeFileSync(ctmp, JSON.stringify(this.cloud.toSnapshot()), 'utf-8');
        renameSync(ctmp, this.cloudPath);
      }
      return true;
    } catch (err) {
      this.log(`[Map] could not save ${this.path}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
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
