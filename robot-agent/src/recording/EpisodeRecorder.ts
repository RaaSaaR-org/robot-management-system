/**
 * @file EpisodeRecorder.ts
 * @description Turns a teleoperation session into a LeRobot v3.0 dataset with
 *              camera video: one tick per frame, commanded and measured kept
 *              apart, images spilled to disk as they arrive.
 * @feature recording
 * @status live
 */

import { mkdir, writeFile, link, copyFile, rm } from 'fs/promises';
import { join } from 'path';
import type { RobotType } from '../robot/types.js';
import { layoutFor, extractVector } from './dex3-layout.js';
import { mapCameras } from './camera-map.js';
import {
  writeLeRobotV3,
  discardScratch,
  type WriterCamera,
  type WriterEpisode,
  type WriterFrame,
} from './lerobot-writer.js';

/**
 * A refusal the caller can act on, carried as a type rather than as a sentence.
 *
 * The alternative — matching the message with a regex at the HTTP boundary — was
 * how this started, and it is unanchored substring matching on prose: any future
 * error whose text happens to contain "does not report" would be misclassified
 * as an operator-actionable refusal, and any rewording of one of these would
 * silently turn a 409 into a 500.
 */
export class RecordingError extends Error {
  constructor(
    message: string,
    /** Machine-readable, stable across rewordings. */
    readonly code: 'RECORDING_REFUSED' | 'RECORDING_UNAVAILABLE',
    /** The HTTP status this deserves. 409: you asked for something I will not
     *  do. 503: I cannot do it YET, ask again. */
    readonly status: 409 | 503,
  ) {
    super(message);
    this.name = 'RecordingError';
  }
}

/** Ticks with no usable frame before the recorder calls itself degraded. */
const DEGRADED_AFTER_CONSECUTIVE_DROPS = 15;

/** JPEG quality asked of the sidecar. Training data, not a preview. */
const SNAPSHOT_QUALITY = 90;

export interface RecorderHooks {
  /** Commanded joint pose, name-keyed. `{}` when teleop is off. */
  getCommanded: () => Record<string, number>;
  isTeleopActive: () => boolean;
  isEStopTriggered: () => boolean;
  /** A FRESH measured pose, name-keyed. Missing joints must be absent, not 0. */
  getMeasured: () => Promise<Record<string, number>>;
  /**
   * Raw JPEG for one scene camera. The render options come from the recorder
   * so the choice that shapes the picture is made in one place and recorded in
   * the dataset, not buried in whatever wired the hook up.
   */
  snapshot: (camera: string, opts: { shadows: boolean; quality: number }) => Promise<Buffer>;
  listCameras: () => Promise<string[]>;
  describeSidecar: () => Promise<{ scene: string | null; bootId: string | null; behindS: number | null }>;
  now?: () => number;
}

export interface StartRecordingRequest {
  sessionId: string;
  /** Target rate. What is achieved is measured and reported, never assumed. */
  fps?: number;
  /** Scene camera names. Empty records joints only — and says so. */
  cameras?: string[];
  task?: string;
  /** Keep MuJoCo's shadow pass. Costs ~5x per frame; off by default. */
  shadows?: boolean;
  /** How the operator is driving, for the episode metadata. */
  inputMode?: string;
}

export interface EpisodeReport {
  episodeIndex: number;
  frames: number;
  dropped: number;
  durationS: number;
  fpsActual: number;
}

export interface RecordingStatus {
  recording: boolean;
  sessionId: string | null;
  episodeIndex: number;
  /** Frames in the CURRENT episode. */
  frames: number;
  /** Frames across every episode so far. */
  totalFrames: number;
  dropped: number;
  totalDropped: number;
  fpsTarget: number;
  fpsActual: number;
  degraded: boolean;
  /** Last reason a tick produced nothing, or null. */
  lastDropReason: string | null;
  cameras: { camera: string; key: string }[];
  scene: string | null;
  /** Sim seconds behind the wall clock, when the sidecar reports it. */
  behindS: number | null;
  episodes: EpisodeReport[];
}

export interface StopRecordingResult {
  ok: boolean;
  /** Absolute path of the dataset tree, or null when nothing was recorded. */
  datasetPath: string | null;
  robotType: string;
  totalEpisodes: number;
  totalFrames: number;
  totalDropped: number;
  fpsActual: number;
  episodes: EpisodeReport[];
  videoFeatures: string[];
  scene: string | null;
  bootId: string | null;
  /** Set when the session produced no dataset, with the reason. */
  error?: string;
}

interface LiveEpisode {
  index: number;
  frames: WriterFrame[];
  /** Per-camera JPEG paths, index-aligned with `frames`. */
  images: Map<string, string[]>;
  dropped: number;
  startedAtMs: number;
  endedAtMs: number | null;
  /**
   * When the first and last ACCEPTED frame landed. The rate is measured across
   * these, not across the episode's wall clock: an operator who pressed Start
   * and then spent forty seconds putting a headset on has not recorded forty
   * seconds of anything, and averaging over that would put a false fps into
   * `meta/info.json` and a false timestamp on every row.
   */
  firstFrameAtMs: number | null;
  lastFrameAtMs: number | null;
}

/**
 * Read a JPEG's pixel dimensions from its SOF marker.
 *
 * Cheaper than decoding: `info.json` needs `[height, width, 3]` once per
 * camera, and decoding 640x480 for every frame just to learn a number that
 * never changes would be paid on the recorder's own tick budget.
 */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1]!;
    // SOF0..SOF15, minus the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * One episode at a time, one session at a time.
 *
 * The design decisions this encodes, all from TASK-215:
 *
 * - **The recorder never stalls the robot.** A tick that cannot get everything
 *   it needs is dropped and counted; nothing waits, nothing is interpolated,
 *   and nothing is stretched to hide it.
 * - **A frame is all-or-nothing.** If one camera is late the whole tick is
 *   dropped, so the JPEG sequences stay contiguous and every video has exactly
 *   as many frames as the episode has rows. A hole in one stream would encode
 *   as a short video that silently desynchronises from the joints.
 * - **`action` and `observation.state` are different arrays.** Commanded pose
 *   comes from the teleop socket, measured pose from the sidecar, each tick.
 *   Conflating them is what made the old recorder's data untrainable.
 * - **fps is measured.** The target is what was asked for; `info.json` gets
 *   what happened.
 */
export class EpisodeRecorder {
  private readonly hooks: RecorderHooks;
  private readonly now: () => number;
  private readonly scratchRoot: string;
  private readonly datasetRoot: string;
  private readonly robotType: RobotType;

  private timer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;
  private stopping = false;

  private sessionId: string | null = null;
  private task = 'teleoperation';
  private fpsTarget = 30;
  private shadows = false;
  private inputMode: string | null = null;
  private cameras: { camera: string; key: string }[] = [];
  private scene: string | null = null;
  private bootId: string | null = null;
  private behindS: number | null = null;
  private imageSize: { width: number; height: number } | null = null;

  private episodes: LiveEpisode[] = [];
  private current: LiveEpisode | null = null;
  private startedAtMs = 0;
  private firstFrameAtMs: number | null = null;
  private lastFrameAtMs: number | null = null;
  private acceptedFrames = 0;
  private totalDropped = 0;
  private consecutiveDrops = 0;
  private lastDropReason: string | null = null;

  constructor(opts: {
    hooks: RecorderHooks;
    robotType: RobotType;
    /** Where JPEGs are spilled while recording. Removed on stop. */
    scratchRoot: string;
    /** Where finished dataset trees are written, one directory per session. */
    datasetRoot: string;
  }) {
    this.hooks = opts.hooks;
    this.now = opts.hooks.now ?? Date.now;
    this.scratchRoot = opts.scratchRoot;
    this.datasetRoot = opts.datasetRoot;
    this.robotType = opts.robotType;
  }

  isRecording(): boolean {
    return this.timer !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin. Validates that the layout can actually be filled from this robot
   * BEFORE any frame is written — a dataset with a constant column is a trap
   * that only shows up hours into a training run.
   */
  async start(req: StartRecordingRequest): Promise<RecordingStatus> {
    if (this.timer) {
      throw new RecordingError(
        this.sessionId === req.sessionId
          ? `already recording session ${req.sessionId}`
          : `busy recording session ${this.sessionId}`,
        'RECORDING_REFUSED',
        409,
      );
    }

    const fps = Number.isFinite(req.fps) && (req.fps as number) > 0 ? Math.min(60, req.fps as number) : 30;
    const layout = layoutFor(this.robotType);

    const health = await this.hooks.describeSidecar().catch(() => ({
      scene: null,
      bootId: null,
      behindS: null,
    }));
    this.scene = health.scene;
    this.bootId = health.bootId;
    this.behindS = health.behindS;

    let wanted = req.cameras;
    if (wanted === undefined) {
      const available = await this.hooks.listCameras().catch(() => [] as string[]);
      wanted = available.includes('head_camera') ? ['head_camera'] : available.slice(0, 1);
    }
    this.cameras = mapCameras(this.scene, wanted);

    // The MEASURED side must be able to fill the layout before the first frame:
    // that is a property of the robot and the scene, and getting it wrong means
    // a dataset with a constant zero column that only fails hours into a
    // training run.
    //
    // The COMMANDED side is deliberately NOT checked here. An operator presses
    // Start and then puts the headset on, so teleop is normally not engaged yet;
    // refusing would make the recorder unusable in the order people actually
    // work. Ticks before teleop engages are dropped and counted, with a reason,
    // which is what the drop counter is for.
    const measured = await this.hooks.getMeasured();
    const missingMeasured = extractVector(layout.joints, measured).missing;
    if (missingMeasured.length > 0) {
      throw new RecordingError(
        `the sidecar does not report ${missingMeasured.length} of ${layout.joints.length} joints ` +
          `(${missingMeasured.slice(0, 3).join(', ')}…) — recording them would store zeros`,
        'RECORDING_REFUSED',
        409,
      );
    }

    this.sessionId = req.sessionId;
    this.fpsTarget = fps;
    this.task = req.task?.trim() || 'teleoperation';
    this.shadows = req.shadows === true;
    this.inputMode = req.inputMode ?? null;
    this.episodes = [];
    this.acceptedFrames = 0;
    this.totalDropped = 0;
    this.consecutiveDrops = 0;
    this.lastDropReason = null;
    this.stopping = false;
    this.startedAtMs = this.now();
    this.firstFrameAtMs = null;
    this.lastFrameAtMs = null;

    await discardScratch(this.scratchDir());
    await mkdir(this.scratchDir(), { recursive: true });
    this.current = this.openEpisode(0);
    await this.prepareEpisodeDirs(this.current);

    this.timer = setInterval(() => {
      void this.tick();
    }, Math.max(10, Math.round(1000 / fps)));
    this.timer.unref?.();

    return this.status();
  }

  /** Close the current episode and open the next. Cheap; no flush. */
  nextEpisode(): number {
    if (!this.current) {
      throw new RecordingError('not recording', 'RECORDING_REFUSED', 409);
    }
    const finished = this.current;
    finished.endedAtMs = this.now();
    this.episodes.push(finished);
    const next = this.openEpisode(finished.index + 1);
    this.current = next;
    void this.prepareEpisodeDirs(next);
    return next.index;
  }

  /**
   * Drop an episode's frames and its images.
   *
   * Images live in per-episode directories precisely so this can be a delete
   * rather than a renumber; the contiguous sequence the encoder needs is built
   * at stop time, from whatever survived.
   */
  async discardEpisode(index: number): Promise<boolean> {
    const all = this.current ? [...this.episodes, this.current] : [...this.episodes];
    const found = all.find((e) => e.index === index);
    // False, not a silent success: an operator UI cannot tell "deleted take 3"
    // from "there was no take 3" if both answer the same.
    if (!found) return false;
    this.acceptedFrames -= found.frames.length;
    found.frames = [];
    found.images = new Map();
    await rm(this.episodeDir(index), { recursive: true, force: true }).catch(() => {});
    return true;
  }

  /**
   * Stop, encode and write. Always tears the timer down, even when the write
   * fails — a recorder left ticking after a failed stop would keep filming into
   * a session that has ended.
   */
  async stop(): Promise<StopRecordingResult> {
    if (!this.timer && !this.current) {
      return this.emptyResult('not recording');
    }
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    // Let an in-flight tick finish rather than half-writing its images.
    for (let i = 0; i < 40 && this.tickInFlight; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }

    if (this.current) {
      this.current.endedAtMs = this.now();
      this.episodes.push(this.current);
      this.current = null;
    }

    const kept = this.episodes.filter((e) => e.frames.length > 0);
    const fpsActual = this.measuredFps();

    if (kept.length === 0) {
      await discardScratch(this.scratchDir());
      const result = this.emptyResult(
        this.lastDropReason
          ? `no frames recorded — ${this.lastDropReason}`
          : 'no frames recorded',
      );
      this.sessionId = null;
      return result;
    }

    const sessionId = this.sessionId ?? 'session';
    const root = join(this.datasetRoot, sessionId);
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await mkdir(root, { recursive: true });

    // Build one contiguous JPEG sequence per camera out of the surviving
    // episodes. Hardlinks where the filesystem allows it, copies where it does
    // not; either way the scratch tree stays the source of truth until the
    // encode has finished.
    const writerCameras: WriterCamera[] = [];
    for (const cam of this.cameras) {
      const seqDir = join(this.scratchDir(), 'seq', cam.key);
      await mkdir(seqDir, { recursive: true });
      let n = 0;
      for (const ep of kept) {
        for (const src of ep.images.get(cam.key) ?? []) {
          const dst = join(seqDir, `frame_${String(n).padStart(8, '0')}.jpg`);
          await link(src, dst).catch(async () => {
            await copyFile(src, dst);
          });
          n += 1;
        }
      }
      writerCameras.push({
        key: cam.key,
        framesDir: seqDir,
        width: this.imageSize?.width ?? 640,
        height: this.imageSize?.height ?? 480,
      });
    }

    const layout = layoutFor(this.robotType);
    const writerEpisodes: WriterEpisode[] = kept.map((ep) => ({
      episodeIndex: ep.index,
      task: this.task,
      frames: ep.frames,
      dropped: ep.dropped,
      wallDurationS:
        ep.firstFrameAtMs !== null && ep.lastFrameAtMs !== null
          ? (ep.lastFrameAtMs - ep.firstFrameAtMs) / 1000
          : 0,
    }));

    // fps has to be positive for the timestamps to mean anything; a session
    // that produced one frame in ten seconds still gets an honest number.
    const fpsForFile = Math.max(0.1, Math.round(fpsActual * 100) / 100);

    try {
      const written = await writeLeRobotV3({
        root,
        robotType: layout.robotType,
        jointNames: layout.joints,
        fps: fpsForFile,
        episodes: writerEpisodes,
        cameras: writerCameras,
        provenance: {
          source: 'neodem-sim-teleop',
          sessionId,
          scene: this.scene,
          simBootId: this.bootId,
          simulated: true,
          inputMode: this.inputMode,
          fpsTarget: this.fpsTarget,
          fpsActual: fpsForFile,
          droppedFrames: this.totalDropped,
          shadows: this.shadows,
          snapshotQuality: SNAPSHOT_QUALITY,
          recordedAt: new Date(this.startedAtMs).toISOString(),
        },
      });

      await writeFile(
        join(root, 'neodem-episodes.json'),
        JSON.stringify(this.episodeReports(kept), null, 2),
        'utf-8',
      );

      return {
        ok: true,
        datasetPath: root,
        robotType: layout.robotType,
        totalEpisodes: written.totalEpisodes,
        totalFrames: written.totalFrames,
        totalDropped: this.totalDropped,
        fpsActual: fpsForFile,
        episodes: this.episodeReports(kept),
        videoFeatures: written.videoFeatures,
        scene: this.scene,
        bootId: this.bootId,
      };
    } finally {
      await discardScratch(this.scratchDir());
      this.sessionId = null;
      this.episodes = [];
    }
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.stopping || !this.current) return;
    if (this.tickInFlight) {
      // The previous tick has not come back. Skipping is the whole design:
      // queueing would build a backlog that never drains and would stretch the
      // clock the dataset claims.
      this.drop('behind: the previous frame had not finished');
      return;
    }
    if (this.hooks.isEStopTriggered()) {
      this.drop('an emergency stop is latched');
      return;
    }
    if (!this.hooks.isTeleopActive()) {
      this.drop('teleop is not engaged');
      return;
    }

    this.tickInFlight = true;
    const episode = this.current;
    try {
      const layout = layoutFor(this.robotType);
      const commandedPose = this.hooks.getCommanded();
      const [measuredPose, ...shots] = await Promise.all([
        this.hooks.getMeasured(),
        ...this.cameras.map((c) =>
          this.hooks.snapshot(c.camera, { shadows: this.shadows, quality: SNAPSHOT_QUALITY })),
      ]);

      const action = extractVector(layout.joints, commandedPose);
      const state = extractVector(layout.joints, measuredPose);
      if (action.missing.length > 0) {
        this.drop(`commanded pose is missing ${action.missing.length} joints`);
        return;
      }
      if (state.missing.length > 0) {
        this.drop(`measured pose is missing ${state.missing.length} joints`);
        return;
      }

      // Everything is in hand — from here the frame is accepted, so the images
      // and the row are written together and cannot disagree.
      const frameNo = episode.frames.length;
      for (let i = 0; i < this.cameras.length; i++) {
        const cam = this.cameras[i]!;
        const jpeg = shots[i] as Buffer;
        if (!this.imageSize) this.imageSize = jpegSize(jpeg);
        const path = join(
          this.episodeDir(episode.index),
          cam.key,
          `f_${String(frameNo).padStart(6, '0')}.jpg`,
        );
        await writeFile(path, jpeg);
        const list = episode.images.get(cam.key) ?? [];
        list.push(path);
        episode.images.set(cam.key, list);
      }

      const at = this.now();
      episode.frames.push({ state: state.values, action: action.values });
      if (episode.firstFrameAtMs === null) episode.firstFrameAtMs = at;
      episode.lastFrameAtMs = at;
      if (this.firstFrameAtMs === null) this.firstFrameAtMs = at;
      this.lastFrameAtMs = at;
      this.acceptedFrames += 1;
      this.consecutiveDrops = 0;
    } catch (err) {
      this.drop(err instanceof Error ? err.message : String(err));
    } finally {
      this.tickInFlight = false;
    }
  }

  private drop(reason: string): void {
    if (this.current) this.current.dropped += 1;
    this.totalDropped += 1;
    this.consecutiveDrops += 1;
    this.lastDropReason = reason;
  }

  // -------------------------------------------------------------------------
  // Bookkeeping
  // -------------------------------------------------------------------------

  /**
   * The rate the accepted frames actually arrived at, from the first to the
   * last. `n - 1` because n frames span n-1 intervals; with fewer than two there
   * is no interval to measure and the target is the only honest answer left.
   */
  private measuredFps(): number {
    if (this.acceptedFrames < 2 || this.firstFrameAtMs === null || this.lastFrameAtMs === null) {
      return this.fpsTarget;
    }
    const spanS = (this.lastFrameAtMs - this.firstFrameAtMs) / 1000;
    if (spanS <= 0) return this.fpsTarget;
    return (this.acceptedFrames - 1) / spanS;
  }

  status(): RecordingStatus {
    const kept = this.current ? [...this.episodes, this.current] : [...this.episodes];
    return {
      recording: this.timer !== null,
      sessionId: this.sessionId,
      episodeIndex: this.current?.index ?? Math.max(0, this.episodes.length - 1),
      frames: this.current?.frames.length ?? 0,
      totalFrames: this.acceptedFrames,
      dropped: this.current?.dropped ?? 0,
      totalDropped: this.totalDropped,
      fpsTarget: this.fpsTarget,
      fpsActual: this.acceptedFrames === 0 ? 0 : Math.round(this.measuredFps() * 100) / 100,
      degraded: this.consecutiveDrops >= DEGRADED_AFTER_CONSECUTIVE_DROPS,
      lastDropReason: this.lastDropReason,
      cameras: this.cameras,
      scene: this.scene,
      behindS: this.behindS,
      episodes: this.episodeReports(kept),
    };
  }

  /** Refresh `behind_s` without blocking a tick. Called by the status route. */
  async refreshSidecarHealth(): Promise<void> {
    const health = await this.hooks.describeSidecar().catch(() => null);
    if (health) this.behindS = health.behindS;
  }

  private episodeReports(list: LiveEpisode[]): EpisodeReport[] {
    return list.map((ep) => {
      // Measured across the frames that exist, for the same reason the whole
      // session's rate is: dead time before the operator engaged is not
      // recording that happened slowly, it is recording that did not happen.
      const spanS =
        ep.firstFrameAtMs !== null && ep.lastFrameAtMs !== null
          ? (ep.lastFrameAtMs - ep.firstFrameAtMs) / 1000
          : 0;
      const fps = ep.frames.length > 1 && spanS > 0 ? (ep.frames.length - 1) / spanS : 0;
      return {
        episodeIndex: ep.index,
        frames: ep.frames.length,
        dropped: ep.dropped,
        durationS: Math.round(spanS * 100) / 100,
        fpsActual: Math.round(fps * 100) / 100,
      };
    });
  }

  private openEpisode(index: number): LiveEpisode {
    const ep: LiveEpisode = {
      index,
      frames: [],
      images: new Map(),
      dropped: 0,
      startedAtMs: this.now(),
      endedAtMs: null,
      firstFrameAtMs: null,
      lastFrameAtMs: null,
    };
    return ep;
  }

  private async prepareEpisodeDirs(ep: LiveEpisode): Promise<void> {
    for (const cam of this.cameras) {
      await mkdir(join(this.episodeDir(ep.index), cam.key), { recursive: true });
    }
    if (this.cameras.length === 0) {
      await mkdir(this.episodeDir(ep.index), { recursive: true });
    }
  }

  private scratchDir(): string {
    return join(this.scratchRoot, this.sessionId ?? 'pending');
  }

  private episodeDir(index: number): string {
    return join(this.scratchDir(), `ep_${String(index).padStart(3, '0')}`);
  }

  private emptyResult(error: string): StopRecordingResult {
    return {
      ok: false,
      datasetPath: null,
      robotType: layoutFor(this.robotType).robotType,
      totalEpisodes: 0,
      totalFrames: 0,
      totalDropped: this.totalDropped,
      fpsActual: 0,
      episodes: [],
      videoFeatures: [],
      scene: this.scene,
      bootId: this.bootId,
      error,
    };
  }

}
