/**
 * @file EpisodeRecorder.ts
 * @description Turns a teleoperation session into a LeRobot v3.0 dataset with
 *              camera video: one tick per frame, commanded and measured kept
 *              apart, images spilled to disk as they arrive.
 * @feature recording
 * @status live
 */

import { mkdir, writeFile, link, copyFile, rm, readFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import type { RobotType } from '../robot/types.js';
import {
  layoutFor,
  extractVector,
  reduceG1Layout,
  type G1RecordingMode,
  type RecordingLayout,
} from './dex3-layout.js';
import { mapCameras } from './camera-map.js';
import {
  writeLeRobotV3,
  discardScratch,
  type WriterCamera,
  type WriterEpisode,
  type WriterFrame,
} from './lerobot-writer.js';
import { takeTeleopModes, type TeleopMode } from '../teleop/teleop-mode.js';
import {
  summarizeEpisode,
  middleFrame,
  G1_MOTION_GROUPS,
  type EpisodeQuickCheck,
  type EpisodeWarning,
  type JointMoved,
  type MotionGroup,
} from './episode-quick-check.js';

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
   * The same read with the sidecar's sample clock (TASK-415). When given, the
   * tick uses it instead of `getMeasured`, and a frame whose `sampleTime`
   * equals the previous frame's is counted as a repeat: the tick came round,
   * the state did not. A null `sampleTime` means "no clock", never a repeat.
   */
  getMeasuredSample?: () => Promise<{ joints: Record<string, number>; sampleTime: number | null }>;
  /**
   * Raw JPEG for one scene camera. The render options come from the recorder
   * so the choice that shapes the picture is made in one place and recorded in
   * the dataset, not buried in whatever wired the hook up.
   */
  snapshot: (camera: string, opts: { shadows: boolean; quality: number }) => Promise<Buffer>;
  listCameras: () => Promise<string[]>;
  describeSidecar: () => Promise<{
    scene: string | null;
    bootId: string | null;
    behindS: number | null;
    /**
     * The sidecar's arm write path (TASK-393). Optional so a hook that predates
     * it still works — it is then treated as the simulation it always was.
     */
    arm?: { readOnly: boolean; sim: boolean; writeMode?: string | null };
  }>;
  now?: () => number;
}

export interface StartRecordingRequest {
  sessionId: string;
  /**
   * Target rate, rounded to an integer: it is the rate the dataset declares
   * (`info.json.fps`, every video's fps, `timestamp = i/fps`), and LeRobot
   * expects a whole number there. What is achieved is measured and kept as
   * provenance, never written as the dataset's rate.
   */
  fps?: number;
  /** Scene camera names. Empty records joints only — and says so. */
  cameras?: string[];
  task?: string;
  /** Keep MuJoCo's shadow pass. Costs ~5x per frame; off by default. */
  shadows?: boolean;
  /** How the operator is driving, for the episode metadata. */
  inputMode?: string;
  /**
   * Start between takes: the clock runs but no episode is open until
   * `beginEpisode()`. Without it episode 0 opens at once, as it always has —
   * the SO-101 and simulator paths rely on that (TASK-402 D1).
   */
  startBetweenTakes?: boolean;
  /**
   * End a take by itself after this many seconds (pauses excluded). Never
   * begins the next one: the operator resets the scene between takes. Null, 0
   * or absent: no limit.
   */
  episodeTimeS?: number | null;
}

/**
 * Why a take ended. `estop` is the recorder's own abort when an emergency stop
 * latches mid-take (TASK-416 D4): that take is discarded as it ends.
 */
export type EpisodeEndReason = 'operator' | 'time_limit' | 'next' | 'session_end' | 'estop';

export type RecorderPhase = 'between' | 'capturing';

export interface LastStop {
  episodeIndex: number;
  reason: EpisodeEndReason;
  atMs: number;
}

/** The middle picture of a take, served by the thumbnail route while the session lives. */
export interface EpisodeThumbnail {
  /** The camera's dataset key, e.g. `cam_right_high`. */
  camera: string;
  /** Frame number within the take. */
  frame: number;
}

export type BeginEpisodeResult =
  | { ok: true; episodeIndex: number; phase: 'capturing'; startedAtMs: number }
  | { ok: false; code: 'already_capturing' | 'not_recording' };

export type EndEpisodeResult =
  | { ok: true; episodeIndex: number; phase: 'between'; report: EpisodeReport }
  | { ok: false; code: 'not_capturing' | 'not_recording' };

/** A take number, and the episode it became in the written dataset (null: not kept). */
export interface EpisodeIndexMapEntry {
  take: number;
  datasetEpisode: number | null;
}

export interface EpisodeReport {
  episodeIndex: number;
  frames: number;
  dropped: number;
  /**
   * Frames whose measured state repeated the previous frame's sample (TASK-415).
   * They stay in the episode — the camera picture may well be new, and a hole
   * would desynchronise the videos — but they are not new samples.
   */
  repeated: number;
  durationS: number;
  /** DISTINCT measured samples per second, not ticks (TASK-415). */
  fpsActual: number;
  /**
   * How the joint targets in THIS episode were produced, observed from the
   * teleop socket — see `teleop/teleop-mode.ts`.
   *
   * Per episode and not per session because an operator can change how they are
   * driving between takes, and a dataset that mixes orientation-mapped and
   * IK-solved demonstrations without saying which is which is a trap for
   * whoever trains on it.
   */
  retargetModes: TeleopMode[];
  /** Discarded takes stay listed, with no frames, so their number stays taken. */
  discarded: boolean;
  /** TASK-402 quick check: joints whose measured range exceeded 0.05 rad. */
  jointsMoved: JointMoved[];
  groupsMoved: MotionGroup[];
  /** The middle frame of the first camera, or null (no camera, no frames). */
  thumbnail: EpisodeThumbnail | null;
  warnings: EpisodeWarning[];
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
  /** Frames in the CURRENT episode whose measured sample repeated the last one. */
  repeated: number;
  totalRepeated: number;
  fpsTarget: number;
  /** DISTINCT measured samples per second across the takes (TASK-415). */
  fpsActual: number;
  degraded: boolean;
  /** Last reason a tick produced nothing, or null. */
  lastDropReason: string | null;
  cameras: { camera: string; key: string }[];
  scene: string | null;
  /** Sim seconds behind the wall clock, when the sidecar reports it. */
  behindS: number | null;
  episodes: EpisodeReport[];
  /**
   * TASK-393: `full`, or which reduced G1 layout this session records because a
   * Dex3 hand reports no state (`arms_only`, `arms+left_hand`, `arms+right_hand`).
   */
  recordingMode: G1RecordingMode | 'full';
  /** Joints left out of the dataset because the robot did not report them. */
  omittedJoints: string[];
  /** Null when not recording. */
  phase: RecorderPhase | null;
  /** When the open take began, or null between takes. */
  episodeStartedAtMs: number | null;
  episodeElapsedS: number | null;
  /** Seconds since `start()`, or null when not recording. */
  elapsedS: number | null;
  /** The per-take time limit, or null for none. */
  autoStopS: number | null;
  lastStop: LastStop | null;
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
  /** Whether the sidecar was the simulator (provenance; TASK-408 labels with it). */
  simulated: boolean;
  /** Every take of the session and the dataset episode it became. */
  indexMap: EpisodeIndexMapEntry[];
  /** Set when the session produced no dataset, with the reason. */
  error?: string;
  /** Machine-readable reason for `ok:false`. `no_episodes`: nothing was kept. */
  code?: 'no_episodes' | 'not_recording' | 'write_failed';
}

interface LiveEpisode {
  index: number;
  frames: WriterFrame[];
  /** Retargeting seen while this episode was open. Discarded with the take. */
  modes: Set<TeleopMode>;
  /** Per-camera JPEG paths, index-aligned with `frames`. */
  images: Map<string, string[]>;
  dropped: number;
  /** Accepted frames whose measured sample was the previous frame's (TASK-415). */
  repeated: number;
  /** The sample clock of the last accepted frame, or null (none yet, or no clock). */
  lastSampleTime: number | null;
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
  /**
   * Milliseconds this episode spent paused, between its first and last frame.
   * Subtracted from the span so a session parked for a minute does not report
   * itself as having recorded at one frame a minute.
   */
  pausedMs: number;
  /**
   * Bumped every time the episode is discarded. A tick that was already in
   * flight when the operator discarded the take carries the epoch it started
   * under, and drops rather than appending a frame the operator has just thrown
   * away — and whose image the discard deleted.
   */
  epoch: number;
  /** Discarded while not the open take; kept in the list so its number stays taken. */
  discarded: boolean;
  /** Last quick check, reused while the frames have not changed. */
  check: {
    frames: number;
    epoch: number;
    dropped: number;
    repeated: number;
    durationS: number;
    value: EpisodeQuickCheck;
  } | null;
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
 * - **The dataset's fps is the integer target; the measured rate is
 *   provenance** (TASK-402 D3). LeRobot expects a whole-number fps and derives
 *   every timestamp as `i/fps`, and a measured 30.21 written there broke both.
 *   The tick is a deadline scheduler, so what is achieved sits at the target;
 *   a tick the event loop could not serve on time is a counted drop, never a
 *   burst of catch-up frames. The measured rate goes to `_neodem.fpsActual`.
 * - **A session has takes, and time between them** (TASK-402). Started with
 *   `startBetweenTakes`, the clock runs with no episode open until
 *   `beginEpisode()`; ticks between takes are neither frames nor drops. Take
 *   numbers are never reused within a session — a discarded take keeps its
 *   number — and only `stop()` maps them onto the dense dataset indices.
 */
export class EpisodeRecorder {
  private readonly hooks: RecorderHooks;
  private readonly now: () => number;
  private readonly scratchRoot: string;
  private readonly datasetRoot: string;
  private readonly robotType: RobotType;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Between `start()` and `stop()`. The timer handle alone cannot say: it is null between two timeouts. */
  private running = false;
  /** The deadline scheduler's origin and the number of the last tick it served. */
  private clockT0Ms = 0;
  private tickNo = 0;
  private tickInFlight = false;
  private stopping = false;
  /**
   * A stop is past the timer and into the encode. `start()` refuses while this
   * is set: the encode can take tens of seconds, and the stop's own cleanup
   * would otherwise delete the scratch tree of whatever session started in the
   * meantime and null out its session id.
   */
  private encoding = false;
  private paused = false;

  private sessionId: string | null = null;
  private task = 'teleoperation';
  private fpsTarget = 30;
  private shadows = false;
  private inputMode: string | null = null;
  private cameras: { camera: string; key: string }[] = [];
  private scene: string | null = null;
  private bootId: string | null = null;
  private behindS: number | null = null;
  /**
   * The joints this session records (TASK-393). The embodiment's full layout,
   * or — on a G1 EDU whose Dex3 hand reports nothing — the arms and the hands
   * that are there. Fixed at `start()`: every episode of a dataset has to be
   * the same width.
   */
  private layout: RecordingLayout | null = null;
  /** Which reduced layout, or null for the full one. */
  private layoutMode: G1RecordingMode | null = null;
  /** Full-layout joints left out because the robot did not report them. */
  private omittedJoints: string[] = [];
  /** Whether the sidecar is the MuJoCo sim (provenance). */
  private simulated = true;
  /** The sidecar's write mode as reported at start, for provenance. */
  private writeMode: string | null = null;
  private imageSize: { width: number; height: number } | null = null;

  private episodes: LiveEpisode[] = [];
  private current: LiveEpisode | null = null;
  /** The number the next take gets. Monotonic for the session (TASK-402 D2). */
  private nextTakeIndex = 0;
  /** `beginEpisode()` is preparing directories; a second begin is refused. */
  private beginning = false;
  /** Whether this session was started between takes. */
  private betweenTakes = false;
  private autoStopS: number | null = null;
  private lastStop: LastStop | null = null;
  private startedAtMs = 0;
  private pausedAtMs: number | null = null;
  private firstFrameAtMs: number | null = null;
  private lastFrameAtMs: number | null = null;
  private acceptedFrames = 0;
  private totalDropped = 0;
  private totalRepeated = 0;
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
    return this.running;
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
    if (this.encoding) {
      throw new RecordingError(
        'the previous recording is still being written — try again in a moment',
        'RECORDING_UNAVAILABLE',
        503,
      );
    }
    if (this.running) {
      throw new RecordingError(
        this.sessionId === req.sessionId
          ? `already recording session ${req.sessionId}`
          : `busy recording session ${this.sessionId}`,
        'RECORDING_REFUSED',
        409,
      );
    }

    // An integer: it becomes the dataset's declared rate (TASK-402 D3).
    const fps =
      Number.isFinite(req.fps) && (req.fps as number) > 0
        ? Math.max(1, Math.round(Math.min(60, req.fps as number)))
        : 30;
    const autoStopS =
      typeof req.episodeTimeS === 'number' && Number.isFinite(req.episodeTimeS) && req.episodeTimeS > 0
        ? req.episodeTimeS
        : null;
    let layout: RecordingLayout = layoutFor(this.robotType);

    const health = await this.hooks.describeSidecar().catch(() => ({
      scene: null,
      bootId: null,
      behindS: null,
    }));
    this.scene = health.scene;
    this.bootId = health.bootId;
    this.behindS = health.behindS;

    // A REAL robot behind a read-only sidecar (TASK-393). Every teleop command
    // is refused there, so `action` would be what the operator wanted and not
    // what the robot did — a dataset of intentions. Refused up front, in words
    // that say how to fix it, rather than discovered as a column of drops.
    const arm = 'arm' in health ? health.arm : undefined;
    if (arm && arm.readOnly && !arm.sim) {
      throw new RecordingError(
        'the robot\'s sidecar is read-only, so teleop cannot move the robot and nothing it records would be a ' +
          'real demonstration — restart g1_sidecar.py with G1_WRITE_MODE=arm_sdk',
        'RECORDING_REFUSED',
        409,
      );
    }
    this.simulated = arm ? arm.sim : true;
    this.writeMode = arm?.writeMode ?? null;

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
    // A whole Dex3 hand that reports nothing is a peripheral that is missing,
    // not a broken robot: record the arms and whatever hand is there, and say
    // so (TASK-393). Anything else missing is still a refusal.
    const reduced = reduceG1Layout(layout, missingMeasured);
    this.layoutMode = reduced?.mode ?? null;
    this.omittedJoints = reduced?.omitted ?? [];
    if (reduced) {
      console.warn(
        `[EpisodeRecorder] recording ${reduced.mode}: the robot reports no state for ${reduced.omitted.length} ` +
          `Dex3 joints, which are left out of the dataset (robot_type ${reduced.robotType})`,
      );
      layout = reduced;
    } else if (missingMeasured.length > 0) {
      throw new RecordingError(
        `the sidecar does not report ${missingMeasured.length} of ${layout.joints.length} joints ` +
          `(${missingMeasured.slice(0, 3).join(', ')}…) — recording them would store zeros`,
        'RECORDING_REFUSED',
        409,
      );
    }

    this.layout = { robotType: layout.robotType, joints: layout.joints };
    this.sessionId = req.sessionId;
    this.fpsTarget = fps;
    this.task = req.task?.trim() || 'teleoperation';
    this.shadows = req.shadows === true;
    this.inputMode = req.inputMode ?? null;
    this.episodes = [];
    this.acceptedFrames = 0;
    this.totalDropped = 0;
    this.totalRepeated = 0;
    this.consecutiveDrops = 0;
    this.lastDropReason = null;
    this.stopping = false;
    this.paused = false;
    this.pausedAtMs = null;
    this.startedAtMs = this.now();
    this.firstFrameAtMs = null;
    this.lastFrameAtMs = null;
    this.betweenTakes = req.startBetweenTakes === true;
    this.autoStopS = autoStopS;
    this.lastStop = null;
    this.nextTakeIndex = 0;
    this.current = null;
    this.beginning = false;

    await discardScratch(this.scratchDir());
    await mkdir(this.scratchDir(), { recursive: true });
    // Between takes: the clock runs, nothing is open. The operator is still
    // putting the headset on, and that is not an episode (TASK-402).
    if (!this.betweenTakes) {
      this.current = this.openEpisode(this.nextTakeIndex++);
      await this.prepareEpisodeDirs(this.current);
    }
    // Discard whatever the socket saw BEFORE the operator pressed Start. The
    // tracker is module-level and is only emptied by a recorder tick, so
    // without this the first episode inherits every mode used while the
    // operator was lining the robot up — a take driven purely by IK came out
    // labelled `ik+orientation` because somebody had nudged a joint by hand
    // minutes earlier. An episode is labelled with what drove it, not with what
    // the session has ever done.
    takeTeleopModes();

    this.running = true;
    this.clockT0Ms = this.now();
    this.tickNo = 0;
    this.scheduleTick();

    return this.status();
  }

  /**
   * Open a take. Refused while one is open: two "begin" presses must not
   * silently end the first take. AWAITS its directories before the take
   * becomes current — a tick that lands before they exist would drop with an
   * ENOENT nobody asked for.
   */
  async beginEpisode(): Promise<BeginEpisodeResult> {
    if (!this.running || this.stopping) return { ok: false, code: 'not_recording' };
    if (this.current || this.beginning) return { ok: false, code: 'already_capturing' };
    this.beginning = true;
    try {
      const ep = this.openEpisode(this.nextTakeIndex++);
      await this.prepareEpisodeDirs(ep);
      if (!this.running || this.stopping) return { ok: false, code: 'not_recording' };
      // Whatever drove the robot between takes is not this take's provenance.
      takeTeleopModes();
      // A pause that spans the boundary counts toward this take only from now.
      if (this.paused) this.pausedAtMs = this.now();
      ep.startedAtMs = this.now();
      this.current = ep;
      return { ok: true, episodeIndex: ep.index, phase: 'capturing', startedAtMs: ep.startedAtMs };
    } finally {
      this.beginning = false;
    }
  }

  /**
   * Close the open take and go between takes. Synchronous: nothing is flushed,
   * the frames stay in memory and the images on disk until `stop()`.
   */
  endEpisode(reason: EpisodeEndReason = 'operator'): EndEpisodeResult {
    if (!this.running && !this.current) return { ok: false, code: 'not_recording' };
    const finished = this.current;
    if (!finished) return { ok: false, code: 'not_capturing' };
    const at = this.now();
    if (this.paused && this.pausedAtMs !== null) {
      finished.pausedMs += at - this.pausedAtMs;
      this.pausedAtMs = at;
    }
    finished.endedAtMs = at;
    // Marks since the last tick belong to the take that was open while they
    // happened.
    for (const mode of takeTeleopModes()) finished.modes.add(mode);
    this.episodes.push(finished);
    this.current = null;
    this.lastStop = { episodeIndex: finished.index, reason, atMs: at };
    return {
      ok: true,
      episodeIndex: finished.index,
      phase: 'between',
      report: this.episodeReports([finished])[0]!,
    };
  }

  /**
   * Close the current take and open the next — or, between takes, just open
   * one. Kept for the callers that predate `beginEpisode`/`endEpisode`.
   */
  async nextEpisode(): Promise<number> {
    if (!this.running) {
      throw new RecordingError('not recording', 'RECORDING_REFUSED', 409);
    }
    if (this.current) this.endEpisode('next');
    const begun = await this.beginEpisode();
    if (!begun.ok) {
      throw new RecordingError(
        begun.code === 'already_capturing' ? 'a take is already being opened' : 'not recording',
        'RECORDING_REFUSED',
        409,
      );
    }
    return begun.episodeIndex;
  }

  /**
   * Stop capturing without ending the session.
   *
   * Ticks return early and are NOT counted as drops — the operator asked for
   * this, and a drop counter that ticks up while a session is deliberately
   * parked would report a recorder that is failing rather than one that is
   * waiting.
   */
  pause(): void {
    if (this.paused || !this.running) return;
    this.paused = true;
    this.pausedAtMs = this.now();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.pausedAtMs !== null && this.current) {
      this.current.pausedMs += this.now() - this.pausedAtMs;
    }
    this.pausedAtMs = null;
  }

  isPaused(): boolean {
    return this.paused;
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
    // The live take is restarted, not retired: the panel's discard on the live
    // row means "do this take again". Any other take is gone, but stays listed
    // so its number is never handed out twice (TASK-402 D2).
    if (found !== this.current) found.discarded = true;
    this.acceptedFrames -= found.frames.length;
    this.totalRepeated -= found.repeated;
    found.repeated = 0;
    found.lastSampleTime = null;
    found.frames = [];
    found.images = new Map();
    found.firstFrameAtMs = null;
    found.lastFrameAtMs = null;
    found.pausedMs = 0;
    found.epoch += 1;
    // The modes go with the frames. Leaving them behind on the LIVE episode
    // makes the re-recorded take claim provenance it does not have — record a
    // bad take with the controller mapping, discard it, re-do it purely on IK,
    // and the dataset says `ik+orientation` with not one orientation-driven
    // frame in it. That mixed-provenance claim is the exact thing this column
    // exists to prevent.
    found.modes = new Set();
    await rm(this.episodeDir(index), { recursive: true, force: true }).catch(() => {});
    // Discarding the episode that is STILL RECORDING is a first-class action —
    // the panel offers it on the live row. Without re-creating the directories
    // the rm just removed, every remaining tick of that take fails with ENOENT
    // and is counted as a drop, and the operator records nothing until they
    // press Next episode.
    if (this.current && this.current.index === index) {
      // Drain what was marked since the last tick too, for the same reason —
      // otherwise the first tick of the re-recorded take picks it straight
      // back up. `start()` does this at the other boundary.
      takeTeleopModes();
      await this.prepareEpisodeDirs(this.current);
    }
    return true;
  }

  /**
   * Stop, encode and write. Always tears the timer down, even when the write
   * fails — a recorder left ticking after a failed stop would keep filming into
   * a session that has ended.
   */
  async stop(): Promise<StopRecordingResult> {
    if (!this.running && !this.current) {
      return { ...this.emptyResult('not recording'), code: 'not_recording' };
    }
    this.stopping = true;
    this.encoding = true;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    // Let an in-flight tick finish rather than half-writing its images.
    for (let i = 0; i < 40 && this.tickInFlight; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }

    if (this.current) this.endEpisode('session_end');

    const kept = this.episodes.filter((e) => !e.discarded && e.frames.length > 0);
    const fpsActual = this.measuredFps();
    // Take number -> dataset episode. The writer re-indexes densely, in order.
    const indexMap: EpisodeIndexMapEntry[] = this.episodes.map((e) => {
      const i = kept.indexOf(e);
      return { take: e.index, datasetEpisode: i >= 0 ? i : null };
    });

    if (kept.length === 0) {
      await discardScratch(this.scratchDir());
      this.encoding = false;
      // A refusal with a code, not an exception: a between-takes session the
      // operator ended without keeping a take is a normal outcome.
      const why =
        this.betweenTakes && this.episodes.length === 0
          ? 'no episodes recorded — no take was begun'
          : this.lastDropReason
            ? `no frames recorded — ${this.lastDropReason}`
            : 'no frames recorded';
      const result = { ...this.emptyResult(why), code: 'no_episodes' as const, indexMap };
      this.sessionId = null;
      this.episodes = [];
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

    const layout = this.activeLayout();
    const writerEpisodes: WriterEpisode[] = kept.map((ep) => ({
      episodeIndex: ep.index,
      task: this.task,
      frames: ep.frames,
      dropped: ep.dropped,
      wallDurationS:
        ep.firstFrameAtMs !== null && ep.lastFrameAtMs !== null
          ? Math.max(0, ep.lastFrameAtMs - ep.firstFrameAtMs - ep.pausedMs) / 1000
          : 0,
      // Carried on the episode OBJECT, never as a parallel array indexed by the
      // recorder's episode number: the writer re-indexes densely after a
      // discard, and one discarded take would shift every subsequent label by
      // one — a dataset that is wrong in a way nothing would ever flag.
      retargetModes: [...ep.modes].sort(),
    }));

    // The dataset declares the integer TARGET (TASK-402 D3): `info.json.fps`,
    // every `video.fps`, ffmpeg's `-framerate` and `timestamp = i/fps` all come
    // from this one value. What was achieved is provenance, below.
    const fpsForFile = Math.round(this.fpsTarget);
    const fpsMeasured = Math.round(fpsActual * 100) / 100;

    try {
      const written = await writeLeRobotV3({
        root,
        robotType: layout.robotType,
        jointNames: layout.joints,
        fps: fpsForFile,
        episodes: writerEpisodes,
        cameras: writerCameras,
        provenance: {
          source: this.simulated ? 'neodem-sim-teleop' : 'neodem-real-teleop',
          sessionId,
          scene: this.scene,
          simBootId: this.simulated ? this.bootId : null,
          sidecarBootId: this.bootId,
          simulated: this.simulated,
          sidecarWriteMode: this.writeMode,
          // TASK-393: which part of the layout this dataset covers, and what
          // was left out because the robot did not report it.
          recordingMode: this.layoutMode ?? 'full',
          omittedJoints: this.omittedJoints,
          inputMode: this.inputMode,
          // Session-level union, for a glance. The authority is per episode,
          // in `meta/episodes`.
          retargetModes: [...new Set(kept.flatMap((ep) => [...ep.modes]))].sort(),
          fpsTarget: this.fpsTarget,
          fpsActual: fpsMeasured,
          droppedFrames: this.totalDropped,
          // Kept frames that re-read the previous sample (TASK-415).
          repeatedFrames: this.totalRepeated,
          shadows: this.shadows,
          snapshotQuality: SNAPSHOT_QUALITY,
          recordedAt: new Date(this.startedAtMs).toISOString(),
        },
      });

      // The dataset is on disk, so the JPEGs it was built from are no longer
      // the only copy. Until this line they were: a missing ffmpeg or a full
      // disk used to delete them anyway, taking the whole session with it.
      await discardScratch(this.scratchDir());

      // Report the indices the DATASET ended up with. The writer re-indexes
      // densely, so an operator who discarded take 1 of three leaves episodes
      // 0 and 2 here and 0 and 1 in the file. Reporting the recorder's own
      // numbering would give the platform episode ids that address nothing.
      const reports = this.episodeReports(kept).map((r, i) => ({ ...r, episodeIndex: i }));

      await writeFile(
        join(root, 'neodem-episodes.json'),
        JSON.stringify(reports, null, 2),
        'utf-8',
      );

      return {
        ok: true,
        datasetPath: root,
        robotType: layout.robotType,
        totalEpisodes: written.totalEpisodes,
        totalFrames: written.totalFrames,
        totalDropped: this.totalDropped,
        fpsActual: fpsMeasured,
        episodes: reports,
        videoFeatures: written.videoFeatures,
        scene: this.scene,
        bootId: this.bootId,
        simulated: this.simulated,
        indexMap,
      };
    } catch (err) {
      // The frames are still on disk. Say so, and say where — a session that
      // died at the encode is recoverable by hand, and a 500 with no path is
      // the difference between "re-run ffmpeg" and "re-record everything".
      const why = err instanceof Error ? err.message : String(err);
      const result = this.emptyResult(
        `the dataset could not be written: ${why}. The captured frames are still ` +
          `at ${this.scratchDir()}`,
      );
      return { ...result, totalFrames: this.acceptedFrames, code: 'write_failed', indexMap };
    } finally {
      this.encoding = false;
      this.sessionId = null;
      this.episodes = [];
    }
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  /**
   * Arm the timer for the next deadline, `t0 + n·1000/fps` on the recorder's
   * clock. A `setInterval` of `round(1000/fps)` ticks at 33 ms for 30 fps —
   * 30.30 Hz, every session, forever — and fires a burst of catch-up ticks
   * after a stall. Deadlines do neither.
   */
  private scheduleTick(): void {
    if (!this.running) return;
    const period = 1000 / this.fpsTarget;
    const now = this.now();
    // The wall clock stepped BACKWARDS (an NTP correction): the next deadline
    // is further away than one period, and waiting for it would stall the
    // recorder for however far the clock jumped. Re-anchor the grid instead.
    if (this.clockT0Ms + (this.tickNo + 1) * period - now > period) {
      this.clockT0Ms = now - this.tickNo * period;
    }
    const due = this.clockT0Ms + (this.tickNo + 1) * period;
    const delay = Math.max(0, Math.ceil(due - now));
    this.timer = setTimeout(() => this.onTimer(), delay);
    this.timer.unref?.();
  }

  private onTimer(): void {
    this.timer = null;
    if (!this.running) return;
    const period = 1000 / this.fpsTarget;
    // Which tick is due now. A small epsilon so a deadline met to the
    // millisecond is not read as one tick early by float rounding.
    const due = Math.floor((this.now() - this.clockT0Ms) / period + 1e-6);
    if (due <= this.tickNo) {
      // Woke early (timer granularity): wait for the deadline, do not tick.
      this.scheduleTick();
      return;
    }
    const missed = due - this.tickNo - 1;
    this.tickNo = due;
    // More than a period late: the ticks in between were never served. They
    // are counted as drops and skipped — never replayed as a burst, which
    // would put frames milliseconds apart under timestamps 33 ms apart.
    if (missed > 0) this.missTicks(missed);
    this.scheduleTick();
    void this.tick();
  }

  /** Ticks the event loop could not serve. Drops only while a take is capturing. */
  private missTicks(n: number): void {
    if (!this.current || this.paused || this.stopping) return;
    this.current.dropped += n;
    this.totalDropped += n;
    this.consecutiveDrops += n;
    this.lastDropReason = `late: ${n} tick(s) missed while the agent was busy`;
  }

  private async tick(): Promise<void> {
    if (this.stopping || !this.current) return; // between takes: not a frame, not a drop
    // Auto-stop (TASK-402): the tick that crosses the limit ends the take and
    // captures nothing. It never begins the next one (D5).
    if (this.autoStopS !== null) {
      const at = this.now();
      const ep = this.current;
      const pausedMs = ep.pausedMs + (this.paused && this.pausedAtMs !== null ? at - this.pausedAtMs : 0);
      if (at >= ep.startedAtMs + this.autoStopS * 1000 + pausedMs) {
        this.endEpisode('time_limit');
        return;
      }
    }
    // E-stop (TASK-416 D4): every frame after the latch would be dropped, so
    // the take is truncated by definition. The first tick that sees the latch
    // ends the take (`estop`, the same path as `time_limit`) and discards it —
    // a silently kept aborted attempt is worse than one re-recorded take. It
    // never begins a new take, and it does nothing to the robot: what the
    // E-stop does to the motors is not the recorder's business.
    if (this.hooks.isEStopTriggered()) {
      const ended = this.endEpisode('estop');
      if (ended.ok) await this.discardEpisode(ended.episodeIndex);
      return;
    }
    // Before the pause and drop checks: the marks describe what has ALREADY
    // driven the robot, and they belong to the episode that was open when it
    // happened whether or not this particular tick produces a frame.
    for (const mode of takeTeleopModes()) this.current.modes.add(mode);
    if (this.paused) return; // deliberate; not a drop
    if (this.tickInFlight) {
      // The previous tick has not come back. Skipping is the whole design:
      // queueing would build a backlog that never drains and would stretch the
      // clock the dataset claims.
      this.drop('behind: the previous frame had not finished');
      return;
    }
    if (!this.hooks.isTeleopActive()) {
      this.drop('teleop is not engaged');
      return;
    }

    this.tickInFlight = true;
    const episode = this.current;
    const epoch = episode.epoch;
    try {
      const layout = this.activeLayout();
      const commandedPose = this.hooks.getCommanded();
      const [measured, ...shots] = await Promise.all([
        this.readMeasured(),
        ...this.cameras.map((c) =>
          this.hooks.snapshot(c.camera, { shadows: this.shadows, quality: SNAPSHOT_QUALITY })),
      ]);

      const action = extractVector(layout.joints, commandedPose);
      const state = extractVector(layout.joints, measured.joints);
      if (action.missing.length > 0) {
        this.drop(
          action.missing.length === layout.joints.length
            ? 'no command reached the robot (arms not armed yet, or the sidecar refused the pose)'
            : `commanded pose is missing ${action.missing.length} joints`,
        );
        return;
      }
      if (state.missing.length > 0) {
        this.drop(`measured pose is missing ${state.missing.length} joints`);
        return;
      }

      // The session may have ended, or this episode been closed or discarded,
      // while the snapshots were in flight. Appending now would put frames in an
      // episode the writer already owns, or images in a directory that has been
      // removed.
      if (this.stopping || this.current !== episode || episode.epoch !== epoch) {
        this.drop('the episode ended while the frame was still being captured', episode);
        return;
      }

      // Everything is in hand, so from here the frame is accepted — but the
      // WRITES can still fail, and a failure on the second of two cameras would
      // otherwise leave the first camera's JPEG on disk with no row behind it.
      // That is not a cosmetic leak: the sequence is what the encoder counts, so
      // one orphan makes that camera's video one frame longer than the parquet
      // and every frame after it a frame out of step with the joints.
      const frameNo = episode.frames.length;
      const written: string[] = [];
      try {
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
          written.push(path);
        }
      } catch (err) {
        await Promise.all(written.map((f) => rm(f, { force: true }).catch(() => {})));
        this.drop(
          `could not write frame ${frameNo}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      // Re-checked AFTER the writes, not only before them: writing the images
      // is itself two or three awaits, and a discard landing in that window
      // would otherwise put a frame the operator threw away into an episode
      // that has already been emptied.
      if (this.stopping || this.current !== episode || episode.epoch !== epoch) {
        await Promise.all(written.map((f) => rm(f, { force: true }).catch(() => {})));
        this.drop('the episode ended while the frame was still being written', episode);
        return;
      }

      for (let i = 0; i < this.cameras.length; i++) {
        const cam = this.cameras[i]!;
        const list = episode.images.get(cam.key) ?? [];
        list.push(written[i]!);
        episode.images.set(cam.key, list);
      }

      const at = this.now();
      episode.frames.push({ state: state.values, action: action.values });
      // The tick came round but the state did not move on: physics had not
      // stepped since the last read. Kept (the frame is still whole and the
      // picture may be new), but counted, so the rate reported is the rate of
      // new samples and not of ticks (TASK-415).
      if (measured.sampleTime !== null && measured.sampleTime === episode.lastSampleTime) {
        episode.repeated += 1;
        this.totalRepeated += 1;
      }
      episode.lastSampleTime = measured.sampleTime;
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

  /** The measured pose, with the sidecar's sample clock when the hook has one. */
  private async readMeasured(): Promise<{ joints: Record<string, number>; sampleTime: number | null }> {
    if (this.hooks.getMeasuredSample) return this.hooks.getMeasuredSample();
    return { joints: await this.hooks.getMeasured(), sampleTime: null };
  }

  /** The episode defaults to the open one; a straggler names the take it belonged to. */
  private drop(reason: string, episode: LiveEpisode | null = this.current): void {
    if (episode) episode.dropped += 1;
    this.totalDropped += 1;
    this.consecutiveDrops += 1;
    this.lastDropReason = reason;
  }

  // -------------------------------------------------------------------------
  // Bookkeeping
  // -------------------------------------------------------------------------

  /**
   * The rate NEW measured samples arrived at, from the first frame to the last.
   * `n - 1` because n frames span n-1 intervals; with fewer than two there is
   * no interval to measure and the target is the only honest answer left.
   *
   * A repeated frame is an interval in which nothing new was sampled, so it is
   * taken off the count (TASK-415). Counting ticks instead let a recorder that
   * stored the same state twice report the rate it ticked at.
   */
  private measuredFps(): number {
    // Summed over the EPISODES, not taken from the session's first frame to its
    // last. The gap between one take and the next — the operator walking back
    // to the start, a pause, a discarded take that left no frames — is not
    // recording that happened slowly. Averaged across it, a session with two
    // brisk takes ten minutes apart would declare about 1 fps, and every
    // timestamp in the file plus the mp4's own framerate would inherit that.
    const live = this.current ? [...this.episodes, this.current] : this.episodes;
    let frames = 0;
    let spanS = 0;
    for (const ep of live) {
      if (ep.frames.length < 2 || ep.firstFrameAtMs === null || ep.lastFrameAtMs === null) continue;
      const span = (ep.lastFrameAtMs - ep.firstFrameAtMs - ep.pausedMs) / 1000;
      if (span <= 0) continue;
      frames += Math.max(0, ep.frames.length - 1 - ep.repeated); // n frames span n-1 intervals
      spanS += span;
    }
    if (frames === 0 || spanS <= 0) return this.fpsTarget;
    return frames / spanS;
  }

  status(): RecordingStatus {
    const kept = this.current ? [...this.episodes, this.current] : [...this.episodes];
    const now = this.now();
    const live = this.current;
    return {
      recording: this.running,
      sessionId: this.sessionId,
      episodeIndex: live?.index ?? this.episodes[this.episodes.length - 1]?.index ?? 0,
      frames: this.current?.frames.length ?? 0,
      totalFrames: this.acceptedFrames,
      dropped: this.current?.dropped ?? 0,
      totalDropped: this.totalDropped,
      repeated: this.current?.repeated ?? 0,
      totalRepeated: this.totalRepeated,
      fpsTarget: this.fpsTarget,
      fpsActual: this.acceptedFrames === 0 ? 0 : Math.round(this.measuredFps() * 100) / 100,
      degraded: this.consecutiveDrops >= DEGRADED_AFTER_CONSECUTIVE_DROPS,
      lastDropReason: this.lastDropReason,
      cameras: this.cameras,
      scene: this.scene,
      behindS: this.behindS,
      episodes: this.episodeReports(kept),
      recordingMode: this.layoutMode ?? 'full',
      omittedJoints: [...this.omittedJoints],
      phase: this.running ? (live ? 'capturing' : 'between') : null,
      episodeStartedAtMs: live?.startedAtMs ?? null,
      episodeElapsedS: live ? Math.round((now - live.startedAtMs) / 10) / 100 : null,
      elapsedS: this.running ? Math.round((now - this.startedAtMs) / 10) / 100 : null,
      autoStopS: this.autoStopS,
      lastStop: this.lastStop,
    };
  }

  /**
   * The thumbnail JPEG of take `index`, from scratch — so only while the
   * session lives. The path is the one the recorder wrote, never built from
   * the caller's input, and is still checked to sit inside the take's own
   * directory before it is read.
   */
  async episodeThumbnail(index: number): Promise<Buffer | null> {
    if (!Number.isSafeInteger(index) || index < 0 || !this.sessionId || this.encoding) return null;
    const all = this.current ? [...this.episodes, this.current] : this.episodes;
    const ep = all.find((e) => e.index === index);
    if (!ep || ep.discarded) return null;
    const thumb = this.thumbnailOf(ep);
    if (!thumb) return null;
    const path = ep.images.get(thumb.camera)?.[thumb.frame];
    if (!path) return null;
    const dir = resolve(this.episodeDir(index));
    const file = resolve(path);
    if (!file.startsWith(dir + sep)) return null;
    return readFile(file).catch(() => null);
  }

  private thumbnailOf(ep: LiveEpisode): EpisodeThumbnail | null {
    const cam = this.cameras[0];
    if (!cam) return null;
    const frame = middleFrame(Math.min(ep.frames.length, ep.images.get(cam.key)?.length ?? 0));
    return frame === null ? null : { camera: cam.key, frame };
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
          ? Math.max(0, ep.lastFrameAtMs - ep.firstFrameAtMs - ep.pausedMs) / 1000
          : 0;
      const fps =
        ep.frames.length > 1 && spanS > 0 ? Math.max(0, ep.frames.length - 1 - ep.repeated) / spanS : 0;
      const durationS = Math.round(spanS * 100) / 100;
      return {
        episodeIndex: ep.index,
        frames: ep.frames.length,
        dropped: ep.dropped,
        repeated: ep.repeated,
        durationS,
        fpsActual: Math.round(fps * 100) / 100,
        retargetModes: [...ep.modes].sort(),
        discarded: ep.discarded,
        ...this.quickCheck(ep, durationS),
        thumbnail: ep.discarded ? null : this.thumbnailOf(ep),
      };
    });
  }

  /** The quick check, recomputed only when the take's frames or drops changed. */
  private quickCheck(ep: LiveEpisode, durationS: number): EpisodeQuickCheck {
    const c = ep.check;
    if (
      c &&
      c.frames === ep.frames.length &&
      c.epoch === ep.epoch &&
      c.dropped === ep.dropped &&
      c.repeated === ep.repeated &&
      c.durationS === durationS
    ) {
      return c.value;
    }
    const value = summarizeEpisode(ep.frames, this.activeLayout().joints, G1_MOTION_GROUPS, {
      durationS,
      dropped: ep.dropped,
      repeated: ep.repeated,
    });
    ep.check = {
      frames: ep.frames.length,
      epoch: ep.epoch,
      dropped: ep.dropped,
      repeated: ep.repeated,
      durationS,
      value,
    };
    return value;
  }

  /** The layout this session records — fixed at `start()`. */
  private activeLayout(): RecordingLayout {
    return this.layout ?? layoutFor(this.robotType);
  }

  private openEpisode(index: number): LiveEpisode {
    const ep: LiveEpisode = {
      index,
      frames: [],
      images: new Map(),
      dropped: 0,
      repeated: 0,
      lastSampleTime: null,
      startedAtMs: this.now(),
      endedAtMs: null,
      firstFrameAtMs: null,
      lastFrameAtMs: null,
      pausedMs: 0,
      epoch: 0,
      modes: new Set(),
      discarded: false,
      check: null,
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
      robotType: this.activeLayout().robotType,
      totalEpisodes: 0,
      totalFrames: 0,
      totalDropped: this.totalDropped,
      fpsActual: 0,
      episodes: [],
      videoFeatures: [],
      scene: this.scene,
      bootId: this.bootId,
      simulated: this.simulated,
      indexMap: [],
      error,
    };
  }

}
