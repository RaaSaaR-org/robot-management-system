/**
 * @file SimFrameRecorder.ts
 * @description Server-side frame recorder for simulation teleoperation sessions.
 *              When a session's robot has no hardware sidecar, this recorder
 *              samples the robot agent's telemetry at the session FPS, buffers
 *              frames, and persists them in batches as TeleoperationFrame rows.
 *              Supports pause/resume, multi-episode recording, and degrades
 *              gracefully (with retries) when the agent is unreachable.
 * @feature datacollection
 */

import { TakeLedger, type LedgerBegin, type LedgerEnd, type TakeRecord } from './teleoperation/takeLedger.js';
import type { EpisodeStopReason } from '../types/teleoperation.types.js';

// ============================================================================
// TYPES
// ============================================================================

/** Minimal telemetry shape the recorder needs from the robot agent */
export interface RecorderTelemetry {
  jointStates?: Array<{ name: string; position: number; velocity?: number }>;
}

/** A captured frame, ready to persist as a TeleoperationFrame row */
export interface RecordedFrame {
  frameIndex: number;
  episodeIndex: number;
  timestamp: number;
  jointPositions: number[];
  jointVelocities: number[] | null;
  action: number[];
  isIntervention: boolean;
}

/** Live progress snapshot emitted ~1x/second */
export interface RecorderProgress {
  frameCount: number;
  currentEpisode: number;
  elapsedS: number;
  fpsActual: number;
  running: boolean;
  degraded: boolean;
  /** TASK-408: between takes the recorder samples nothing. */
  phase: 'between' | 'capturing';
  /** Frames in the open take (0 between takes). */
  takeFrames: number;
  /** When the open take began (ms epoch), or null between takes. */
  takeStartedAtMs: number | null;
}

export interface SimFrameRecorderOptions {
  sessionId: string;
  /** Target sampling rate (frames per second) */
  fps: number;
  /** Frame index to start from (session.frameCount when resuming) */
  initialFrameIndex?: number;
  /**
   * Episode index to start recording into — or, with `startBetweenTakes`, the
   * number the first take gets.
   */
  initialEpisodeIndex?: number;
  /**
   * TASK-408 D3: open between takes; nothing is sampled until `begin()`.
   * Without it the first take opens on `start()`, as it always has.
   */
  startBetweenTakes?: boolean;
  /** Fetch the robot's current telemetry (joint states) */
  fetchTelemetry: () => Promise<RecorderTelemetry>;
  /** Persist a batch of frames (called ~1x/second) */
  persistFrames: (frames: RecordedFrame[]) => Promise<void>;
  /** Called ~1x/second with a live progress snapshot */
  onProgress?: (progress: RecorderProgress) => void;
  /** Called once each time the agent becomes unreachable */
  onDegraded?: (message: string) => void;
  /** Batch-persist interval override (tests) */
  flushIntervalMs?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_FLUSH_INTERVAL_MS = 1000;
/** Consecutive telemetry failures before the recorder reports degraded state */
const DEGRADED_THRESHOLD = 3;

// ============================================================================
// SIM FRAME RECORDER
// ============================================================================

/**
 * Polls robot-agent telemetry at the session FPS and turns it into
 * TeleoperationFrame rows. Action = jointPositions (teleop passthrough):
 * during teleoperation the agent's telemetry reflects the operator's
 * commanded pose, so observation and action coincide.
 */
export class SimFrameRecorder {
  private readonly options: SimFrameRecorderOptions;

  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private buffer: RecordedFrame[] = [];
  private flushing = false;
  private flushPromise: Promise<void> | null = null;
  private fetchInFlight = false;

  private frameIndex: number;
  /** Which take is open, which finished, and why (TASK-408). */
  readonly ledger: TakeLedger;
  private paused = false;
  private stopped = false;

  /** Recording clock: total active (non-paused) milliseconds */
  private startedAtMs = 0;
  private pausedAtMs: number | null = null;
  private pausedTotalMs = 0;

  private consecutiveFailures = 0;
  private degraded = false;

  /** Frames sampled since the last progress emit (for fpsActual) */
  private framesSinceProgress = 0;
  private lastProgressAtMs = 0;

  constructor(options: SimFrameRecorderOptions) {
    this.options = options;
    this.frameIndex = options.initialFrameIndex ?? 0;
    this.ledger = new TakeLedger({ nextTake: options.initialEpisodeIndex ?? 0 });
    if (!options.startBetweenTakes) this.ledger.begin();
  }

  // --------------------------------------------------------------------------
  // LIFECYCLE
  // --------------------------------------------------------------------------

  /** Begin sampling + batching. Idempotent. */
  start(): void {
    if (this.sampleTimer || this.stopped) return;

    this.startedAtMs = Date.now();
    this.lastProgressAtMs = this.startedAtMs;

    const sampleIntervalMs = Math.max(10, Math.round(1000 / Math.max(1, this.options.fps)));
    this.sampleTimer = setInterval(() => {
      void this.sample();
    }, sampleIntervalMs);

    const flushIntervalMs = this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.flushTimer = setInterval(() => {
      void this.flush();
      this.emitProgress();
    }, flushIntervalMs);
  }

  /** Stop sampling while a session is paused (no frames while paused). */
  pause(): void {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.pausedAtMs = Date.now();
  }

  /** Resume sampling after a pause. */
  resume(): void {
    if (!this.paused || this.stopped) return;
    if (this.pausedAtMs !== null) {
      this.pausedTotalMs += Date.now() - this.pausedAtMs;
      this.pausedAtMs = null;
    }
    this.paused = false;
  }

  /**
   * Stop the recorder and flush any remaining buffered frames.
   * Safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Wait for any in-flight flush so the final flush sees the full buffer
    if (this.flushPromise) {
      await this.flushPromise.catch(() => {});
    }
    await this.flush();
  }

  // --------------------------------------------------------------------------
  // EPISODES
  // --------------------------------------------------------------------------

  /** Advance to the next episode. Returns the new episode index. */
  nextEpisode(): number {
    return this.ledger.next();
  }

  /** Open a take (TASK-408). Refused while one is open. */
  begin(): LedgerBegin {
    return this.ledger.begin();
  }

  /** Close the open take (TASK-408). Refused between takes. */
  end(reason: EpisodeStopReason = 'operator'): LedgerEnd {
    return this.ledger.end(reason);
  }

  get phase(): 'between' | 'capturing' {
    return this.ledger.phase;
  }

  /** Every take so far (TASK-408). */
  takes(): TakeRecord[] {
    return this.ledger.all();
  }

  /** Current episode index frames are being recorded into (the last one between takes). */
  getCurrentEpisode(): number {
    return this.ledger.latest()?.take ?? 0;
  }

  /**
   * Drop still-buffered frames of a discarded episode so they are never
   * persisted (the caller deletes already-persisted rows from the DB).
   */
  discardBufferedEpisode(episodeIndex: number): void {
    this.buffer = this.buffer.filter((f) => f.episodeIndex !== episodeIndex);
  }

  /**
   * Discard an episode safely with respect to the flush pipeline: drops
   * buffered frames, then waits for any in-flight persist batch so frames of
   * the discarded episode cannot land in the DB *after* the caller's delete.
   * (A failed flush re-buffers its batch, hence the second filter.)
   */
  async discardEpisode(episodeIndex: number): Promise<void> {
    this.ledger.discard(episodeIndex);
    this.discardBufferedEpisode(episodeIndex);
    if (this.flushPromise) {
      await this.flushPromise.catch(() => {});
      this.discardBufferedEpisode(episodeIndex);
    }
  }

  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------

  /** Total frames sampled so far (persisted + buffered). */
  getFrameCount(): number {
    return this.frameIndex - (this.options.initialFrameIndex ?? 0);
  }

  /** Next frame index that will be assigned (== session frame count). */
  getNextFrameIndex(): number {
    return this.frameIndex;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  getProgress(): RecorderProgress {
    return {
      frameCount: this.frameIndex,
      currentEpisode: this.getCurrentEpisode(),
      elapsedS: this.getElapsedS(),
      fpsActual: this.computeFpsActual(),
      running: !this.stopped && !this.paused,
      degraded: this.degraded,
      phase: this.ledger.phase,
      takeFrames: this.ledger.current()?.frames ?? 0,
      takeStartedAtMs: this.ledger.current()?.startedAtMs ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // INTERNALS
  // --------------------------------------------------------------------------

  private getElapsedS(): number {
    if (this.startedAtMs === 0) return 0;
    const pausedNow = this.pausedAtMs !== null ? Date.now() - this.pausedAtMs : 0;
    return Math.max(0, (Date.now() - this.startedAtMs - this.pausedTotalMs - pausedNow) / 1000);
  }

  private computeFpsActual(): number {
    const windowMs = Date.now() - this.lastProgressAtMs;
    if (windowMs <= 0) return 0;
    return Math.round((this.framesSinceProgress / windowMs) * 1000 * 10) / 10;
  }

  private emitProgress(): void {
    const progress = this.getProgress();
    this.framesSinceProgress = 0;
    this.lastProgressAtMs = Date.now();
    try {
      this.options.onProgress?.(progress);
    } catch {
      /* progress listeners must never break the recorder */
    }
  }

  /** One sampling tick: fetch telemetry, buffer a frame. Never throws. */
  private async sample(): Promise<void> {
    // Between takes nothing is a frame (TASK-408 D3).
    if (this.paused || this.stopped || this.fetchInFlight || !this.ledger.current()) return;
    this.fetchInFlight = true;
    try {
      const telemetry = await this.options.fetchTelemetry();
      // The recorder may have been stopped/paused while the fetch was in
      // flight — do not buffer a frame that would never be flushed (stop's
      // final flush has already run by now).
      const take = this.ledger.current();
      if (this.paused || this.stopped || !take) return;
      const joints = telemetry.jointStates ?? [];
      if (joints.length === 0) {
        this.registerFailure('Robot agent returned no joint states');
        return;
      }

      const jointPositions = joints.map((j) => j.position);
      const hasVelocities = joints.some((j) => typeof j.velocity === 'number');
      const jointVelocities = hasVelocities ? joints.map((j) => j.velocity ?? 0) : null;

      this.buffer.push({
        frameIndex: this.frameIndex,
        episodeIndex: take.take,
        timestamp: this.getElapsedS(),
        jointPositions,
        jointVelocities,
        // Teleop passthrough: the commanded action is the observed pose.
        action: jointPositions,
        isIntervention: false,
      });
      this.frameIndex += 1;
      this.ledger.countFrame();
      this.framesSinceProgress += 1;

      // Recovered from a degraded stretch
      this.consecutiveFailures = 0;
      this.degraded = false;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Telemetry fetch failed';
      this.registerFailure(message);
    } finally {
      this.fetchInFlight = false;
    }
  }

  private registerFailure(message: string): void {
    this.consecutiveFailures += 1;
    if (!this.degraded && this.consecutiveFailures >= DEGRADED_THRESHOLD) {
      this.degraded = true;
      try {
        this.options.onDegraded?.(
          `Robot agent unreachable — frames are being missed (${message}). Retrying...`
        );
      } catch {
        /* listeners must never break the recorder */
      }
    }
  }

  /** Persist buffered frames. On failure, re-buffers and retries next tick. */
  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];
    this.flushPromise = (async () => {
      try {
        await this.options.persistFrames(batch);
      } catch (err) {
        // Put the batch back (in order) so nothing is lost; retry on next flush.
        this.buffer = [...batch, ...this.buffer];
        console.error(
          `[SimFrameRecorder] Failed to persist ${batch.length} frames for session ${this.options.sessionId}:`,
          err instanceof Error ? err.message : err
        );
      } finally {
        this.flushing = false;
        this.flushPromise = null;
      }
    })();
    await this.flushPromise;
  }
}
