/**
 * @file idle-watcher.ts
 * @description While Agent Mode is on, the robot is idle and no E-Stop is
 *              latched: one cheap vision call every AGENT_IDLE_WATCH_INTERVAL_MS.
 *              A person who NEWLY appears triggers exactly one greet. No
 *              autonomous locomotion — only `speak` + `wave`. Time in which the
 *              watcher is not eligible to look does NOT count towards absence.
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import type { VisionObservation } from './vision.js';

/**
 * A person must have been out of frame for at least this long before their
 * reappearance counts as "new". Without it, one blink of the detector would
 * re-fire the greeting at somebody who never left.
 */
const DEFAULT_PERSON_ABSENT_MS = 10_000;

export interface IdleWatcherDeps {
  /** One vision call. Should be the same VisionClient the blocks use. */
  observe: () => Promise<VisionObservation>;
  /** True only when mode is ON, nothing is running and no E-Stop is latched. */
  isEligible: () => boolean;
  /** Fired at most once per person appearance. */
  onPersonAppeared: (observation: VisionObservation) => void;
  intervalMs?: number;
  personAbsentMs?: number;
  now?: () => number;
}

export class IdleWatcher {
  private readonly deps: IdleWatcherDeps;
  private readonly intervalMs: number;
  private readonly personAbsentMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** Wall clock of the most recent frame a person was visible in. */
  private lastPersonSeenAt: number | null = null;
  /**
   * Whether the most recent frame we actually took showed a person. Only that
   * — an OBSERVATION — may start an absence; a stretch in which the watcher
   * took no frames at all says nothing about who is standing there.
   */
  private personVisibleInLastFrame = false;
  private lastErrorLoggedAt = 0;

  constructor(deps: IdleWatcherDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? config.agentMode.idleWatchIntervalMs;
    this.personAbsentMs = deps.personAbsentMs ?? DEFAULT_PERSON_ABSENT_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Never hold the process open just to watch for a passer-by.
    this.timer.unref?.();
    console.log(`[AgentMode/IdleWatcher] started (every ${this.intervalMs}ms)`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    console.log('[AgentMode/IdleWatcher] stopped');
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Forget who was seen, so the next person in frame counts as new. Called when
   * the mode is toggled off/on — a fresh session should greet again.
   */
  reset(): void {
    this.lastPersonSeenAt = null;
    this.personVisibleInLastFrame = false;
  }

  /**
   * One watch cycle. Public so tests can drive it deterministically instead of
   * waiting on timers. Re-entrant calls are dropped — a slow VLM must not queue
   * up a backlog of frames.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.deps.isEligible()) {
      // While a plan runs (or an E-Stop is latched) we take no frames, so we
      // have NO evidence about the person in front of the robot. Absence must
      // be observed, never inferred from a gap in observation: hold the clock
      // forward so a 20 s plan cannot make somebody who never left look newly
      // arrived and re-fire the greeting the moment the robot is free again.
      // `null` (nobody seen yet / after reset()) is left alone — the next
      // person genuinely is new — and so is an absence we DID observe before
      // going busy: that person really left, so their return is a new arrival.
      if (this.personVisibleInLastFrame && this.lastPersonSeenAt !== null) {
        this.lastPersonSeenAt = this.now();
      }
      return;
    }
    this.ticking = true;
    try {
      const observation = await this.deps.observe();
      const now = this.now();
      this.personVisibleInLastFrame = observation.personVisible;

      if (!observation.personVisible) return;

      const isNew =
        this.lastPersonSeenAt === null || now - this.lastPersonSeenAt > this.personAbsentMs;

      // Refresh BEFORE firing: while the same person stands there, every tick
      // keeps pushing lastPersonSeenAt forward, so `isNew` stays false and the
      // greeting cannot repeat.
      this.lastPersonSeenAt = now;

      if (isNew) {
        this.deps.onPersonAppeared(observation);
      }
    } catch (err) {
      // A missing camera must not spam the log every 3 s.
      const now = this.now();
      if (now - this.lastErrorLoggedAt > 60_000) {
        this.lastErrorLoggedAt = now;
        console.warn(
          `[AgentMode/IdleWatcher] observation failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      this.ticking = false;
    }
  }
}
