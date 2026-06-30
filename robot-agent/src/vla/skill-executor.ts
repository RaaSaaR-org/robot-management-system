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
 * @feature vla
 * @status live
 */

import { EventEmitter } from 'events';
import type { RobotStateManager } from '../robot/state.js';
import { hardwareClient } from '../hardware/HardwareClient.js';

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

export interface SkillExecutionResult {
  status: SkillExecutionStatus;
  mode: SkillExecutionMode;
  steps: number;
  durationMs: number;
  message?: string;
  error?: string;
  lastAction?: number[];
}

export interface SkillExecutorOptions {
  skillId: string;
  taskPrompt: string;
  maxSteps: number;
  timeoutMs: number;
  /** WebSocket / event bus to push step events to. Optional. */
  emitter?: EventEmitter;
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
    const startedAt = Date.now();
    const deadline = startedAt + opts.timeoutMs;
    const mode: SkillExecutionMode = hardwareClient.isAvailable() ? 'hardware' : 'sim';
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
      const safe =
        mode === 'hardware'
          ? this.clipAction(raw, lastActionForClip!)
          : raw;

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

      opts.emitter?.emit('skill:step', {
        skillId: opts.skillId,
        step,
        mode,
        action: safe,
        ts: Date.now(),
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
