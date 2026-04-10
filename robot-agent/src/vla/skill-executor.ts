/**
 * @file skill-executor.ts
 * @description Closed-loop skill executor — runs observe → predict → execute
 * against vla-server. Replaces the TASK-143 stub on
 * `POST /robots/:id/skills/execute`.
 *
 * Two execution paths:
 *
 * 1. **Hardware delegated**: when the SO-101 sidecar at localhost:8765 is
 *    reachable (`hardwareClient.isAvailable()`), the robot has real cameras
 *    and motors. We delegate to the existing `RobotStateManager.startVLAControl`
 *    path which boots VLARunner — the same loop teleop already uses, with
 *    real cameras and safety. We poll for completion or abort.
 *
 * 2. **Simulated**: in pure sim (no hardware sidecar), we run a TS-only loop
 *    that POSTs synthetic gray frames + the simulated joint state to
 *    vla-server `/predict`. This validates the whole pipeline end-to-end
 *    (server → robot-agent → vla-server → robot-agent) without moving
 *    anything. Sim actions are not applied to any robot.
 *
 * @feature vla
 */

import { EventEmitter } from 'events';
import type { RobotStateManager } from '../robot/state.js';
import { hardwareClient } from '../hardware/HardwareClient.js';

const VLA_SERVER_URL_DEFAULT = 'http://localhost:8000';

// 32×32 gray JPEG (Pillow-generated, quality=70). Used by the simulated loop
// only — real hardware sends real cameras via VLARunner. The model produces
// nonsense actions on this input but the loop still exercises the full
// vla-server round-trip end-to-end.
const SYNTHETIC_GRAY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKKACiiigAooooA/9k=';

export type SkillExecutionStatus = 'completed' | 'failed' | 'aborted' | 'timeout';

export interface SkillExecutionResult {
  status: SkillExecutionStatus;
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

/**
 * One closed-loop skill execution. Use the static `start` method to launch
 * an executor; the returned instance lets the abort handler stop it.
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
    const t0 = Date.now();
    const deadline = t0 + opts.timeoutMs;

    if (hardwareClient.isAvailable()) {
      return this.runHardware(opts, t0, deadline);
    }
    return this.runSimulated(opts, t0, deadline);
  }

  // ── Simulated path ──────────────────────────────────────────────

  /**
   * Pure-TS closed loop against vla-server. No hardware required.
   * Sends a synthetic gray frame + the simulated joint state, calls /predict,
   * and pretends to apply the resulting actions. Used in dev / CI / sim mode.
   */
  private async runSimulated(
    opts: SkillExecutorOptions,
    startedAt: number,
    deadline: number,
  ): Promise<SkillExecutionResult> {
    const baseUrl = process.env.VLA_SERVER_URL ?? VLA_SERVER_URL_DEFAULT;

    // Discover which cameras vla-server expects so we can build a payload it
    // will accept (otherwise it returns 422 "Missing camera(s)").
    let cameras: string[] = ['front'];
    let stateDim = 6;
    let chunkSize = 50;
    try {
      const cfgResp = await this.fetchImpl(`${baseUrl}/config`, { method: 'GET' });
      if (cfgResp.ok) {
        const cfg = (await cfgResp.json()) as {
          cameras: string[];
          state_dim: number;
          chunk_size: number;
        };
        cameras = cfg.cameras ?? cameras;
        stateDim = cfg.state_dim ?? stateDim;
        chunkSize = cfg.chunk_size ?? chunkSize;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'failed',
        steps: 0,
        durationMs: Date.now() - startedAt,
        error: `vla-server /config unreachable at ${baseUrl}: ${msg}`,
      };
    }

    // Reset policy state once per run.
    try {
      await this.fetchImpl(`${baseUrl}/reset`, { method: 'POST' });
    } catch {
      // best-effort
    }

    let actionsQueue: number[][] = [];
    let lastAction: number[] | undefined;
    let step = 0;

    while (step < opts.maxSteps) {
      if (this.aborted) {
        return {
          status: 'aborted',
          steps: step,
          durationMs: Date.now() - startedAt,
          lastAction,
          message: 'Aborted by user',
        };
      }
      if (Date.now() > deadline) {
        return {
          status: 'timeout',
          steps: step,
          durationMs: Date.now() - startedAt,
          lastAction,
          message: `Timeout after ${opts.timeoutMs}ms`,
        };
      }

      if (actionsQueue.length === 0) {
        // Build observation: synthetic gray frame for each expected camera +
        // current simulated joint positions padded to state_dim.
        const images: Record<string, string> = {};
        for (const cam of cameras) {
          images[cam] = SYNTHETIC_GRAY_JPEG_B64;
        }
        const telemetry = this.robotStateManager.getTelemetry();
        const joints = (telemetry.jointStates ?? []).map((j) => j.position);
        while (joints.length < stateDim) joints.push(0);
        const state = joints.slice(0, stateDim);

        let predictResp: Response;
        try {
          predictResp = await this.fetchImpl(`${baseUrl}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images, state, task: opts.taskPrompt }),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            status: 'failed',
            steps: step,
            durationMs: Date.now() - startedAt,
            error: `vla-server /predict failed: ${msg}`,
          };
        }
        if (!predictResp.ok) {
          let detail = `HTTP ${predictResp.status}`;
          try {
            const body = (await predictResp.json()) as { detail?: string };
            if (body.detail) detail = body.detail;
          } catch {
            /* ignore */
          }
          return {
            status: 'failed',
            steps: step,
            durationMs: Date.now() - startedAt,
            error: `vla-server /predict rejected: ${detail}`,
          };
        }
        const predictBody = (await predictResp.json()) as { actions: number[][] };
        actionsQueue = predictBody.actions ?? [];
        if (actionsQueue.length === 0) {
          return {
            status: 'failed',
            steps: step,
            durationMs: Date.now() - startedAt,
            error: 'vla-server returned empty action chunk',
          };
        }
      }

      const action = actionsQueue.shift()!;
      lastAction = action;
      step += 1;

      opts.emitter?.emit('skill:step', {
        skillId: opts.skillId,
        step,
        action,
        ts: Date.now(),
      });

      // Tiny pacing delay so the UI sees progress over the websocket and so
      // we don't burn CPU calling /predict in a tight loop.
      await new Promise((r) => setTimeout(r, 50));

      // Cap simulated runs at 2 chunks (chunkSize * 2) to avoid 50-step
      // pointless loops in dev. The skill is "complete" once the model has
      // produced one full chunk twice.
      if (step >= Math.min(opts.maxSteps, chunkSize * 2)) {
        break;
      }
    }

    return {
      status: 'completed',
      steps: step,
      durationMs: Date.now() - startedAt,
      lastAction,
      message: 'Simulated execution completed',
    };
  }

  // ── Hardware-delegated path ─────────────────────────────────────

  /**
   * On real hardware we delegate to VLARunner via the existing
   * `startVLAControl` path. VLARunner runs in the Python sidecar where
   * cameras and motor I/O live. We poll until it stops or until aborted.
   */
  private async runHardware(
    opts: SkillExecutorOptions,
    startedAt: number,
    deadline: number,
  ): Promise<SkillExecutionResult> {
    try {
      await this.robotStateManager.startVLAControl(opts.taskPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'failed',
        steps: 0,
        durationMs: Date.now() - startedAt,
        error: `Failed to start VLA control: ${msg}`,
      };
    }

    let step = 0;
    while (this.robotStateManager.isVLAActive()) {
      if (this.aborted) {
        await this.robotStateManager.stopVLAControl().catch(() => {});
        return {
          status: 'aborted',
          steps: step,
          durationMs: Date.now() - startedAt,
          message: 'Aborted by user',
        };
      }
      if (Date.now() > deadline) {
        await this.robotStateManager.stopVLAControl().catch(() => {});
        return {
          status: 'timeout',
          steps: step,
          durationMs: Date.now() - startedAt,
          message: `Timeout after ${opts.timeoutMs}ms`,
        };
      }
      step += 1;
      opts.emitter?.emit('skill:step', { skillId: opts.skillId, step, ts: Date.now() });
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      status: 'completed',
      steps: step,
      durationMs: Date.now() - startedAt,
      message: 'VLARunner finished',
    };
  }
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
}

export const skillExecutorRegistry = new SkillExecutorRegistry();
