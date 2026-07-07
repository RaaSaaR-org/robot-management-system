/**
 * @file skill-executor.ts
 * @description Closed-loop skill executor — runs observe → predict → execute
 * against vla-server. Replaces the TASK-143 stub on
 * `POST /robots/:id/skills/execute`.
 *
 * ONE loop for sim and hardware (TASK-146 final 20%). The only difference
 * between modes is where frames and joint state come from, and whether
 * actions actually move anything:
 *
 *   mode=sim       — synthetic gray frames + sim telemetry, actions discarded
 *   mode=hardware  — real frames via sidecar `/cameras/:n/snapshot`, real
 *                    joint state via sidecar `/state/fast`, real actions
 *                    via sidecar `/action`, delta-clipped for motor safety
 *
 * The previous design delegated hardware mode to a Python thread
 * (VLARunner) which owned its own camera stack. That was fragile and
 * architecturally redundant — everything VLARunner did is now a small
 * set of sidecar HTTP endpoints driven by TS.
 *
 * TASK-179 adds LeRobot-0.6.0-style rollout strategies on top of the same
 * loop (see {@link RolloutStrategy}): `sentry` (sidecar dataset recording),
 * `highlight` (frame ring buffer → incident + clip on failure/abort), and
 * `dagger` (sim teleop pre-emption → InterventionEpisode). `default` keeps
 * the exact pre-TASK-179 behavior.
 *
 * @feature vla
 * @status live
 */

import { EventEmitter } from 'events';
import type { RobotStateManager } from '../robot/state.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import { config } from '../config/config.js';
import type { RolloutStrategy } from './types.js';

const VLA_SERVER_URL_DEFAULT = 'http://localhost:8000';

/**
 * Per-joint delta clip for real-arm safety. At 5 Hz this is a 25°/s max
 * slew rate — matches VLARunner's `max_delta = 5` default and prevents
 * servo stall from a sudden VLA action spike.
 */
const MAX_DELTA_DEGREES = 5;

/** Control loop frequency — 5 Hz matches VLARunner/teleop conventions. */
const LOOP_PERIOD_MS = 200;

/** Per-step vla-server /predict timeout. */
const PREDICT_TIMEOUT_MS = 3_000;

/** Max consecutive /predict failures before we bail with 'vla-server unreachable'. */
const MAX_PREDICT_FAILURES = 3;

// 32×32 gray JPEG (Pillow-generated, quality=70). Used only when a camera
// source isn't available (pure sim). The real hardware path replaces this
// with snapshots from the sidecar.
const SYNTHETIC_GRAY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKKACiiigAooooA/9k=';

export type SkillExecutionMode = 'sim' | 'hardware';
export type SkillExecutionStatus = 'completed' | 'failed' | 'aborted' | 'timeout';

/**
 * Highlight ring capacity: ~15 s of frames at the 5 Hz loop rate. In practice
 * hardware frames are captured once per action-chunk refill, so the buffer
 * usually spans more wall time — 75 is the hard memory bound either way.
 */
const HIGHLIGHT_MAX_FRAMES = 75;

/** Hard cap on collected dagger steps — maxSteps already bounds this in practice. */
const DAGGER_MAX_STEPS = 5_000;

/** One buffered camera frame for the `highlight` strategy. */
export interface HighlightFrame {
  /** Capture time, Unix epoch ms. */
  t: number;
  /** Sidecar/vla-server camera name the frame came from. */
  camera: string;
  /** Base64-encoded JPEG. */
  jpegB64: string;
}

/**
 * Bounded FIFO of the most recent camera frames. Only ONE camera is buffered
 * (the first configured one) to bound memory: 75 frames × ~20 KB JPEG ≈ 1.5 MB.
 */
export class HighlightRing {
  private buf: HighlightFrame[] = [];

  constructor(private readonly capacity: number = HIGHLIGHT_MAX_FRAMES) {}

  push(frame: HighlightFrame): void {
    this.buf.push(frame);
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }

  get frames(): readonly HighlightFrame[] {
    return this.buf;
  }

  get size(): number {
    return this.buf.length;
  }
}

/** One step of a dagger rollout trace (contract §7). */
export interface InterventionStep {
  /** Milliseconds since rollout start. */
  t: number;
  /** Who produced the applied action for this step. */
  source: 'human' | 'policy';
  /** The applied joint-target vector. */
  action: number[];
}

export interface RolloutRecordingMeta {
  repoId: string;
  status: 'recording' | 'recorded' | 'skipped' | 'failed';
}

/** Optional per-strategy metadata attached to a rollout result (TASK-179). */
export interface RolloutMetadata {
  strategy: RolloutStrategy;
  /** sentry: sidecar recording outcome. */
  recording?: RolloutRecordingMeta;
  /** highlight: server incident created on failure/abort. */
  incidentId?: string;
  /** dagger: number of human-sourced (teleop pre-empted) steps. */
  interventionSteps?: number;
  /** Human-readable notes (sim no-ops, best-effort upload failures, …). */
  notes?: string[];
}

export interface SkillExecutionResult {
  status: SkillExecutionStatus;
  mode: SkillExecutionMode;
  steps: number;
  durationMs: number;
  message?: string;
  error?: string;
  lastAction?: number[];
  /** Present only when a non-default rollout strategy was requested. */
  rollout?: RolloutMetadata;
}

export interface SkillExecutorOptions {
  skillId: string;
  taskPrompt: string;
  maxSteps: number;
  timeoutMs: number;
  /** WebSocket / event bus to push step events to. Optional. */
  emitter?: EventEmitter;
  /** Rollout strategy (TASK-179). Defaults to 'default' — zero behavior change. */
  rolloutStrategy?: RolloutStrategy;
  /** Robot ID for server-side reporting (incidents/interventions). Defaults to config.robotId. */
  robotId?: string;
  /** NeoDEM server base URL override (tests). Defaults to NEODEM_SERVER_URL / SERVER_URL. */
  serverBaseUrl?: string;
}

/** Mutable per-run state shared between the loop and the strategy hooks. */
interface RolloutContext {
  strategy: RolloutStrategy;
  mode: SkillExecutionMode;
  /** ISO timestamp taken before the loop starts (intervention episode start). */
  startedAtIso: string;
  notes: string[];
  /** sentry */
  recording: RolloutRecordingMeta | null;
  /** highlight (hardware): recent camera frames. */
  highlight: HighlightRing;
  /** highlight (sim): lightweight step log instead of frames. */
  simStepLog: Array<{ t: number; action: number[] }>;
  /** dagger: full human/policy step trace. */
  interventionSteps: InterventionStep[];
  /** dagger: count of human-sourced steps. */
  humanSteps: number;
}

interface VlaConfig {
  cameras: string[];
  stateDim: number;
  chunkSize: number;
}

/**
 * One closed-loop skill execution. The route handler creates one per
 * call and registers it with `skillExecutorRegistry` so abort can find it.
 */
export class SkillExecutor {
  private aborted = false;
  private fetchImpl: typeof fetch;

  constructor(
    private readonly robotStateManager: RobotStateManager,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  abort(): void {
    this.aborted = true;
  }

  isAborted(): boolean {
    return this.aborted;
  }

  async run(opts: SkillExecutorOptions): Promise<SkillExecutionResult> {
    const strategy: RolloutStrategy = opts.rolloutStrategy ?? 'default';
    const mode: SkillExecutionMode = hardwareClient.isAvailable() ? 'hardware' : 'sim';
    const ctx: RolloutContext = {
      strategy,
      mode,
      startedAtIso: new Date().toISOString(),
      notes: [],
      recording: null,
      highlight: new HighlightRing(),
      simStepLog: [],
      interventionSteps: [],
      humanSteps: 0,
    };

    // Hardware dagger (leader-arm pre-emption during a real rollout) is OUT OF
    // SCOPE for TASK-179 — during a real rollout the sidecar owns the leader
    // arm (teleop/recording take the serial port exclusively), so pre-emption
    // is sim-teleop only. In hardware mode every step is tagged 'policy'.
    if (strategy === 'dagger' && mode === 'hardware') {
      ctx.notes.push(
        'dagger: hardware mode — teleop pre-emption is sim-only (leader-arm pre-emption out of scope); all steps tagged policy',
      );
    }

    await this.startSentryRecording(ctx, opts);
    let result: SkillExecutionResult;
    try {
      result = await this.runLoop(opts, mode, ctx);
    } finally {
      // Finally-safe: stop the sidecar recorder even if the loop threw, so a
      // crashed rollout never leaves lerobot-record holding the cameras/port.
      await this.stopSentryRecording(ctx);
    }
    await this.finalizeRollout(ctx, opts, result);
    return result;
  }

  /**
   * The TASK-146 closed loop — unchanged behavior for strategy 'default'.
   * Strategy hooks (highlight frame buffering, dagger pre-emption/tagging)
   * are no-ops unless the matching strategy is active.
   */
  private async runLoop(
    opts: SkillExecutorOptions,
    mode: SkillExecutionMode,
    ctx: RolloutContext,
  ): Promise<SkillExecutionResult> {
    const startedAt = Date.now();
    const deadline = startedAt + opts.timeoutMs;
    const baseUrl = process.env.VLA_SERVER_URL ?? VLA_SERVER_URL_DEFAULT;

    // ── Discover vla-server capabilities (cameras + dims) ───────────
    let vlaConfig: VlaConfig;
    try {
      vlaConfig = await this.fetchVlaConfig(baseUrl);
    } catch (err) {
      return {
        status: 'failed',
        mode,
        steps: 0,
        durationMs: Date.now() - startedAt,
        error: `vla-server /config unreachable at ${baseUrl}: ${this.errMsg(err)}`,
      };
    }

    // Reset policy state once per run (best-effort).
    try {
      await this.fetchImpl(`${baseUrl}/reset`, { method: 'POST' });
    } catch {
      // ignore
    }

    // ── Seed delta clipping with the current joint state ───────────
    // The first VLA action should be rate-limited relative to where the
    // arm actually IS, not relative to zero (which would let it jump).
    let lastActionForClip: number[] | null = null;
    if (mode === 'hardware') {
      try {
        lastActionForClip = await hardwareClient.getStateNow();
      } catch (err) {
        return {
          status: 'failed',
          mode,
          steps: 0,
          durationMs: Date.now() - startedAt,
          error: `Failed to seed initial state: ${this.errMsg(err)}`,
        };
      }
      console.log(
        `[SkillExecutor] Seeded delta clip from arm pose: [${lastActionForClip.map((v) => v.toFixed(1)).join(', ')}]`,
      );
    }

    // ── Main loop ──────────────────────────────────────────────────
    let actionsQueue: number[][] = [];
    let lastApplied: number[] | undefined;
    let step = 0;
    let predictFailures = 0;

    console.log(
      `[SkillExecutor] Running skill=${opts.skillId} mode=${mode} maxSteps=${opts.maxSteps} timeoutMs=${opts.timeoutMs}`,
    );

    while (step < opts.maxSteps) {
      if (this.aborted) {
        return this.abortedResult(mode, step, startedAt, lastApplied);
      }
      if (Date.now() > deadline) {
        return {
          status: 'timeout',
          mode,
          steps: step,
          durationMs: Date.now() - startedAt,
          lastAction: lastApplied,
          message: `Timeout after ${opts.timeoutMs}ms`,
        };
      }

      // ── Refill action queue if empty ─────────────────────────────
      if (actionsQueue.length === 0) {
        let images: Record<string, string>;
        let state: number[];

        try {
          if (mode === 'hardware') {
            [images, state] = await this.captureHardware(vlaConfig);
            // highlight: buffer the first camera's frame (one camera only, to
            // bound memory). Frames arrive at chunk-refill rate; the ring
            // caps at HIGHLIGHT_MAX_FRAMES regardless.
            if (ctx.strategy === 'highlight') {
              const cam = vlaConfig.cameras[0];
              const jpeg = cam ? images[cam] : undefined;
              if (cam && jpeg) {
                ctx.highlight.push({ t: Date.now(), camera: cam, jpegB64: jpeg });
              }
            }
          } else {
            images = this.buildSyntheticFrames(vlaConfig.cameras);
            state = this.buildSimState(vlaConfig.stateDim);
          }
        } catch (err) {
          return {
            status: 'failed',
            mode,
            steps: step,
            durationMs: Date.now() - startedAt,
            error: `Capture failed: ${this.errMsg(err)}`,
          };
        }

        // Call vla-server /predict with a hard timeout.
        const predictResult = await this.predict(baseUrl, images, state, opts.taskPrompt);
        if (!predictResult.ok) {
          // Client errors (4xx) are deterministic — fail immediately.
          if (!predictResult.retryable) {
            return {
              status: 'failed',
              mode,
              steps: step,
              durationMs: Date.now() - startedAt,
              error: predictResult.error,
            };
          }
          // Transient failure: retry up to MAX_PREDICT_FAILURES times.
          predictFailures += 1;
          if (predictFailures >= MAX_PREDICT_FAILURES) {
            return {
              status: 'failed',
              mode,
              steps: step,
              durationMs: Date.now() - startedAt,
              error: `vla-server /predict failed ${predictFailures}x: ${predictResult.error}`,
            };
          }
          await sleep(LOOP_PERIOD_MS);
          continue;
        }
        predictFailures = 0;
        actionsQueue = predictResult.actions;
        if (actionsQueue.length === 0) {
          return {
            status: 'failed',
            mode,
            steps: step,
            durationMs: Date.now() - startedAt,
            error: 'vla-server returned empty action chunk',
          };
        }
      }

      // ── Pop next action, clip, apply ─────────────────────────────
      const raw = actionsQueue.shift()!;

      // dagger: while the sim teleop override is active, the human joint
      // targets pre-empt the VLA action for this step (tagged 'human').
      // Sim-mode only — see the hardware-dagger scope note in run().
      let source: 'human' | 'policy' = 'policy';
      let chosen = raw;
      if (ctx.strategy === 'dagger' && mode === 'sim' && this.robotStateManager.isTeleopActive()) {
        chosen = this.teleopActionVector(raw.length);
        source = 'human';
      }

      const safe =
        mode === 'hardware'
          ? this.clipAction(chosen, lastActionForClip!)
          : chosen;

      if (mode === 'hardware') {
        // Re-check abort right before commanding hardware: a protective stop
        // (e.g. fall detection via the safety loop's abortAll) can fire during
        // the VLA predict await above, after the top-of-loop check.
        if (this.aborted) {
          return this.abortedResult(mode, step, startedAt, lastApplied);
        }
        try {
          await hardwareClient.sendActionVector(safe);
        } catch (err) {
          return {
            status: 'failed',
            mode,
            steps: step,
            durationMs: Date.now() - startedAt,
            error: `Send action failed: ${this.errMsg(err)}`,
          };
        }
        lastActionForClip = safe;
      }

      lastApplied = safe;
      step += 1;

      // dagger: collect the applied step, tagged by its source.
      if (ctx.strategy === 'dagger') {
        if (source === 'human') ctx.humanSteps += 1;
        if (ctx.interventionSteps.length < DAGGER_MAX_STEPS) {
          ctx.interventionSteps.push({ t: Date.now() - startedAt, source, action: safe });
        }
      }
      // highlight (sim): no frames to buffer — keep a lightweight step log.
      if (ctx.strategy === 'highlight' && mode === 'sim') {
        ctx.simStepLog.push({ t: Date.now() - startedAt, action: safe });
        if (ctx.simStepLog.length > HIGHLIGHT_MAX_FRAMES) ctx.simStepLog.shift();
      }

      opts.emitter?.emit('skill:step', {
        skillId: opts.skillId,
        step,
        mode,
        action: safe,
        ts: Date.now(),
        ...(ctx.strategy !== 'default' ? { strategy: ctx.strategy } : {}),
        ...(ctx.strategy === 'dagger' ? { source } : {}),
      });

      // In sim mode we cap at 2 chunks to keep dev runs bounded; hardware
      // mode runs the full maxSteps so real-arm executions aren't cut short.
      if (mode === 'sim' && step >= Math.min(opts.maxSteps, vlaConfig.chunkSize * 2)) {
        break;
      }

      await sleep(LOOP_PERIOD_MS);
    }

    return {
      status: 'completed',
      mode,
      steps: step,
      durationMs: Date.now() - startedAt,
      lastAction: lastApplied,
      message: mode === 'hardware' ? 'Hardware execution completed' : 'Simulated execution completed',
    };
  }

  // ── Rollout strategy helpers (TASK-179) ───────────────────────

  /** NeoDEM server base URL for best-effort reporting POSTs. */
  private serverBaseUrl(opts: SkillExecutorOptions): string {
    return opts.serverBaseUrl ?? process.env.NEODEM_SERVER_URL ?? config.serverUrl;
  }

  /**
   * sentry: start a sidecar `lerobot-record` session covering the rollout.
   * Never fails the rollout — an unavailable/read-only sidecar (G1 stage-1)
   * just logs a warning and the rollout continues un-recorded.
   *
   * Known sidecar-level limitation (SO-101): lerobot-record takes exclusive
   * ownership of the cameras and follower serial port, so the sidecar
   * re-opens them on demand for the loop's snapshot/state/action calls.
   * Resolving that contention lives in the sidecar, not here.
   */
  private async startSentryRecording(ctx: RolloutContext, opts: SkillExecutorOptions): Promise<void> {
    if (ctx.strategy !== 'sentry') return;
    if (ctx.mode !== 'hardware') {
      ctx.notes.push('sentry: sim mode — sidecar dataset recording skipped (no-op)');
      return;
    }
    const repoId = `sentry/${opts.skillId}-${Date.now()}`;
    const res = await hardwareClient.startRecording({
      repoId,
      task: opts.taskPrompt,
      numEpisodes: 1,
      // One long episode covering the whole rollout budget.
      episodeTimeS: Math.max(30, Math.ceil(opts.timeoutMs / 1000)),
      fps: 30,
      resetTimeS: 1,
    });
    if (res.ok) {
      ctx.recording = { repoId, status: 'recording' };
      console.log(`[SkillExecutor] sentry: sidecar recording started (repo_id=${repoId})`);
    } else {
      ctx.recording = { repoId, status: res.readOnly ? 'skipped' : 'failed' };
      ctx.notes.push(
        `sentry: sidecar recording unavailable (${res.error ?? 'unknown'}) — rollout continues un-recorded`,
      );
      console.warn(`[SkillExecutor] sentry: recording start failed: ${res.error ?? 'unknown'}`);
    }
  }

  /** sentry: stop the sidecar recorder (finally-safe, never throws). */
  private async stopSentryRecording(ctx: RolloutContext): Promise<void> {
    if (ctx.recording?.status !== 'recording') return;
    try {
      const res = await hardwareClient.stopRecording();
      ctx.recording.status = res.ok ? 'recorded' : 'failed';
      if (res.ok) {
        console.log(
          `[SkillExecutor] sentry: recording stopped (episodes=${res.episodesRecorded ?? 0}, path=${res.datasetPath ?? 'n/a'})`,
        );
      } else {
        ctx.notes.push(`sentry: recording stop failed (${res.error ?? 'unknown'})`);
        console.warn(`[SkillExecutor] sentry: recording stop failed: ${res.error ?? 'unknown'}`);
      }
    } catch (err) {
      ctx.recording.status = 'failed';
      ctx.notes.push(`sentry: recording stop failed (${this.errMsg(err)})`);
    }
  }

  /**
   * Post-rollout strategy work: attach rollout metadata to the result and run
   * the best-effort server reports (highlight incident + clip, dagger
   * intervention episode). Never throws — reporting failures are logged and
   * noted, the rollout result is returned regardless.
   */
  private async finalizeRollout(
    ctx: RolloutContext,
    opts: SkillExecutorOptions,
    result: SkillExecutionResult,
  ): Promise<void> {
    if (ctx.strategy === 'default') return;

    const meta: RolloutMetadata = { strategy: ctx.strategy };
    if (ctx.recording) meta.recording = ctx.recording;

    if (
      ctx.strategy === 'highlight' &&
      (result.status === 'failed' || result.status === 'aborted' || result.status === 'timeout')
    ) {
      const incidentId = await this.reportHighlightIncident(ctx, opts, result);
      if (incidentId) meta.incidentId = incidentId;
    }

    if (ctx.strategy === 'dagger') {
      meta.interventionSteps = ctx.humanSteps;
      await this.postInterventionEpisode(ctx, opts);
    }

    if (ctx.notes.length > 0) meta.notes = ctx.notes;
    result.rollout = meta;
  }

  /**
   * highlight: create an incident on the NeoDEM server (contract §6) and, when
   * hardware frames were buffered, PUT the clip as raw-body JSON. Sim rollouts
   * create the incident without a clip. Returns the incident id or null.
   */
  private async reportHighlightIncident(
    ctx: RolloutContext,
    opts: SkillExecutorOptions,
    result: SkillExecutionResult,
  ): Promise<string | null> {
    const base = this.serverBaseUrl(opts);
    const robotId = opts.robotId ?? config.robotId;
    let incidentId: string | null = null;
    try {
      const resp = await this.fetchImpl(`${base}/api/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ai_malfunction',
          severity: 'medium',
          title: `VLA rollout ${result.status}: ${opts.skillId}`,
          description:
            `VLA skill rollout ${result.status} after ${result.steps} steps ` +
            `(${result.durationMs}ms, ${ctx.mode} mode, strategy=highlight). ` +
            `Task: "${opts.taskPrompt}".` +
            (result.error ? ` Error: ${result.error}` : '') +
            (ctx.mode === 'sim' ? ` Sim step log: ${ctx.simStepLog.length} steps (no frames).` : ''),
          robotId,
          detectedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) {
        ctx.notes.push(`highlight: incident POST failed (HTTP ${resp.status})`);
        console.warn(`[SkillExecutor] highlight: incident POST failed: HTTP ${resp.status}`);
        return null;
      }
      const body = (await resp.json()) as { id?: string };
      if (!body.id) {
        ctx.notes.push('highlight: incident POST returned no id');
        return null;
      }
      incidentId = body.id;
      console.log(`[SkillExecutor] highlight: incident created (${incidentId})`);
    } catch (err) {
      ctx.notes.push(`highlight: incident POST failed (${this.errMsg(err)})`);
      console.warn(`[SkillExecutor] highlight: incident POST failed: ${this.errMsg(err)}`);
      return null;
    }

    if (ctx.highlight.size > 0) {
      await this.uploadIncidentClip(base, incidentId, ctx);
    } else {
      ctx.notes.push('highlight: no hardware frames buffered — incident created without clip');
    }
    return incidentId;
  }

  /** highlight: PUT the frame ring as raw-body JSON to /api/incidents/:id/clip. */
  private async uploadIncidentClip(base: string, incidentId: string, ctx: RolloutContext): Promise<void> {
    const frames = ctx.highlight.frames;
    const payload = {
      format: 'jpeg-frames' as const,
      fps: this.estimateClipFps(frames),
      capturedAt: new Date(frames[0].t).toISOString(),
      frames: frames.map((f) => f.jpegB64),
    };
    try {
      const resp = await this.fetchImpl(`${base}/api/incidents/${incidentId}/clip`, {
        method: 'PUT',
        // Raw-body upload (server reads the bytes, not express.json) — the
        // bytes are UTF-8 JSON per contract §6. MUST be octet-stream: an
        // application/json body would be consumed by the server's global
        // express.json parser, whose 10mb limit rejects large clips before
        // the route's raw 32MB path can run.
        headers: { 'Content-Type': 'application/octet-stream' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        ctx.notes.push(`highlight: clip upload failed (HTTP ${resp.status})`);
        console.warn(`[SkillExecutor] highlight: clip upload failed: HTTP ${resp.status}`);
      } else {
        console.log(`[SkillExecutor] highlight: clip uploaded (${frames.length} frames)`);
      }
    } catch (err) {
      ctx.notes.push(`highlight: clip upload failed (${this.errMsg(err)})`);
      console.warn(`[SkillExecutor] highlight: clip upload failed: ${this.errMsg(err)}`);
    }
  }

  /** Effective capture rate of the buffered frames; nominal 5 Hz fallback. */
  private estimateClipFps(frames: readonly HighlightFrame[]): number {
    if (frames.length >= 2) {
      const spanS = (frames[frames.length - 1].t - frames[0].t) / 1000;
      if (spanS > 0) return Math.round(((frames.length - 1) / spanS) * 100) / 100;
    }
    return 1000 / LOOP_PERIOD_MS;
  }

  /** dagger: POST the human/policy step trace as an InterventionEpisode (contract §7). */
  private async postInterventionEpisode(ctx: RolloutContext, opts: SkillExecutorOptions): Promise<void> {
    if (ctx.interventionSteps.length === 0) return;
    const base = this.serverBaseUrl(opts);
    try {
      const resp = await this.fetchImpl(`${base}/api/datasets/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robotId: opts.robotId ?? config.robotId,
          skillId: opts.skillId,
          taskPrompt: opts.taskPrompt,
          strategy: 'dagger',
          startedAt: ctx.startedAtIso,
          endedAt: new Date().toISOString(),
          steps: ctx.interventionSteps,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        ctx.notes.push(`dagger: intervention POST failed (HTTP ${resp.status})`);
        console.warn(`[SkillExecutor] dagger: intervention POST failed: HTTP ${resp.status}`);
      } else {
        console.log(
          `[SkillExecutor] dagger: intervention episode posted (${ctx.interventionSteps.length} steps, ${ctx.humanSteps} human)`,
        );
      }
    } catch (err) {
      ctx.notes.push(`dagger: intervention POST failed (${this.errMsg(err)})`);
      console.warn(`[SkillExecutor] dagger: intervention POST failed: ${this.errMsg(err)}`);
    }
  }

  /**
   * dagger: current sim-teleop joint targets as an action vector in the active
   * embodiment's joint-config order, padded/truncated to the policy's action
   * dim (mirrors buildSimState's convention).
   */
  private teleopActionVector(dim: number): number[] {
    const positions = this.robotStateManager.getTeleopPositions();
    const joints = this.robotStateManager.getActiveJointConfig();
    const vec = joints.map((j) => positions[j.name] ?? j.defaultPosition);
    const out = vec.slice(0, dim);
    while (out.length < dim) out.push(0);
    return out;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private async fetchVlaConfig(baseUrl: string): Promise<VlaConfig> {
    const resp = await this.fetchImpl(`${baseUrl}/config`, { method: 'GET' });
    if (!resp.ok) {
      throw new Error(`/config returned HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      cameras?: string[];
      state_dim?: number;
      chunk_size?: number;
    };
    return {
      cameras: data.cameras ?? ['front'],
      stateDim: data.state_dim ?? 6,
      chunkSize: data.chunk_size ?? 50,
    };
  }

  /**
   * Hardware capture: fetch joint state + one snapshot per expected camera,
   * map the sidecar's physical cameras onto the names vla-server expects.
   *
   * vla-server's /config returns the camera names the model was trained
   * on (e.g. ['up', 'side'] for SmolVLA). The sidecar exposes physical
   * cameras by their local names (e.g. ['wrist', 'top']). We map by
   * position: the k-th vla-server camera gets filled with the k-th
   * sidecar camera's snapshot. Matches the sim path's behavior.
   */
  private async captureHardware(
    vlaConfig: VlaConfig,
  ): Promise<[Record<string, string>, number[]]> {
    const sidecarCameras = await hardwareClient.getCameras();
    const physicalCount = sidecarCameras.length;

    // Parallel fetch all snapshots + joint state.
    const needed = vlaConfig.cameras.length;
    const physicalToUse = sidecarCameras.slice(0, Math.max(needed, 1));

    const [snapshots, state] = await Promise.all([
      Promise.all(
        physicalToUse.map((name) =>
          hardwareClient.snapshot(name).then((b64) => ({ name, b64 })),
        ),
      ),
      hardwareClient.getStateNow(),
    ]);

    // Map snapshots onto the vla-server camera names by position. If there
    // are more expected cameras than physical cameras, reuse the last
    // physical frame so the model still gets a valid JPEG for every name.
    const images: Record<string, string> = {};
    for (let i = 0; i < vlaConfig.cameras.length; i++) {
      const vlaName = vlaConfig.cameras[i];
      const snap = snapshots[Math.min(i, snapshots.length - 1)];
      images[vlaName] = snap ? snap.b64 : SYNTHETIC_GRAY_JPEG_B64;
    }

    // Pad/truncate state to vla-server's expected dim.
    const padded = state.slice(0, vlaConfig.stateDim);
    while (padded.length < vlaConfig.stateDim) padded.push(0);

    void physicalCount;
    return [images, padded];
  }

  private buildSyntheticFrames(cameras: string[]): Record<string, string> {
    const images: Record<string, string> = {};
    for (const cam of cameras) {
      images[cam] = SYNTHETIC_GRAY_JPEG_B64;
    }
    return images;
  }

  private buildSimState(stateDim: number): number[] {
    const telemetry = this.robotStateManager.getTelemetry();
    const joints = (telemetry.jointStates ?? []).map((j) => j.position);
    while (joints.length < stateDim) joints.push(0);
    return joints.slice(0, stateDim);
  }

  private async predict(
    baseUrl: string,
    images: Record<string, string>,
    state: number[],
    task: string,
  ): Promise<
    | { ok: true; actions: number[][] }
    | { ok: false; error: string; retryable: boolean }
  > {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PREDICT_TIMEOUT_MS);
    try {
      const resp = await this.fetchImpl(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, state, task }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const body = (await resp.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          /* ignore */
        }
        // 4xx are client-side / deterministic — don't retry.
        // 5xx / other are likely transient — allow retry.
        const retryable = resp.status >= 500;
        return { ok: false, error: `vla-server /predict rejected: ${detail}`, retryable };
      }
      const body = (await resp.json()) as { actions?: number[][] };
      return { ok: true, actions: body.actions ?? [] };
    } catch (err) {
      // Network errors and AbortController timeouts are transient.
      return {
        ok: false,
        error: `vla-server /predict failed: ${this.errMsg(err)}`,
        retryable: true,
      };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Delta-clip an action so no joint moves more than MAX_DELTA_DEGREES
   * from its last applied value. Prevents servo stalls from bad VLA
   * predictions.
   */
  private clipAction(action: number[], last: number[]): number[] {
    const clipped = new Array(action.length);
    for (let i = 0; i < action.length; i++) {
      const lastVal = last[i] ?? 0;
      const delta = action[i] - lastVal;
      const limited = Math.max(-MAX_DELTA_DEGREES, Math.min(MAX_DELTA_DEGREES, delta));
      clipped[i] = lastVal + limited;
    }
    return clipped;
  }

  private abortedResult(
    mode: SkillExecutionMode,
    step: number,
    startedAt: number,
    lastAction?: number[],
  ): SkillExecutionResult {
    return {
      status: 'aborted',
      mode,
      steps: step,
      durationMs: Date.now() - startedAt,
      lastAction,
      message: 'Aborted by user',
    };
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Registry ────────────────────────────────────────────────────

/**
 * Tracks active executors so the abort route can find them by skillId.
 * One executor per (robotId, skillId) — there's only one robot per agent
 * process, so skillId alone is sufficient.
 */
class SkillExecutorRegistry {
  private active = new Map<string, SkillExecutor>();

  register(skillId: string, exec: SkillExecutor): void {
    this.active.set(skillId, exec);
  }

  get(skillId: string): SkillExecutor | undefined {
    return this.active.get(skillId);
  }

  unregister(skillId: string): void {
    this.active.delete(skillId);
  }

  abort(skillId: string): boolean {
    const exec = this.active.get(skillId);
    if (!exec) return false;
    exec.abort();
    return true;
  }

  /**
   * Abort every active executor. Called by the safety loop on a protective stop
   * so a detected fall actually halts the VLA command path. Returns the count.
   */
  abortAll(): number {
    let n = 0;
    for (const exec of this.active.values()) {
      exec.abort();
      n += 1;
    }
    return n;
  }
}

export const skillExecutorRegistry = new SkillExecutorRegistry();
