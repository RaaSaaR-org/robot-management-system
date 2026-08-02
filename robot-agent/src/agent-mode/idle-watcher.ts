/**
 * @file idle-watcher.ts
 * @description While Agent Mode is on, the robot is idle and no E-Stop is
 *              latched: one cheap vision call every AGENT_IDLE_WATCH_INTERVAL_MS.
 *              A person who NEWLY appears triggers exactly one greet. No
 *              autonomous locomotion — only `speak` + `wave`. Time in which the
 *              watcher is not eligible to look does NOT count towards absence.
 *
 *              Also the ONE clock every other idle-time check rides on
 *              (TASK-199): a check registered here inherits `unref()`, the
 *              re-entrancy guard, the 60 s log throttle and the public `tick()`
 *              instead of re-implementing all four beside a second timer that
 *              `index.ts`'s shutdown would then have to know about. `checks[]`
 *              runs only while the robot is eligible to act; `alwaysChecks[]`
 *              runs on every tick, for work that matters most while it is not
 *              (TASK-200's mirror re-push).
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

/**
 * A cheap idle-time check that rides this watcher's clock (TASK-199).
 *
 * Runs BEFORE the vision call, so a check that starts a plan does not first
 * spend a VLM round-trip on a frame the robot will not act on. A check is
 * expected never to throw and never to block: it is on a 3 s loop, and anything
 * expensive belongs behind a predicate that fired.
 */
export interface IdleCheck {
  /** Short name, used only in the throttled error log. */
  name: string;
  run: () => void | Promise<void>;
}

export interface IdleWatcherDeps {
  /** One vision call. Should be the same VisionClient the blocks use. */
  observe: () => Promise<VisionObservation>;
  /** True only when mode is ON, nothing is running and no E-Stop is latched. */
  isEligible: () => boolean;
  /** Fired at most once per person appearance. */
  onPersonAppeared: (observation: VisionObservation) => void;
  /** Extra checks, run in order at the start of every eligible tick. */
  checks?: IdleCheck[];
  /**
   * Checks that run on EVERY tick, eligible or not, before the eligibility
   * gate (TASK-200).
   *
   * {@link IdleWatcherDeps.checks} is for things that may only happen when the
   * robot is free to act — the heartbeat starts a plan. This list is for things
   * that must happen precisely BECAUSE the robot is busy or latched: telling
   * the server "I am still here, and this is my state" matters most while a
   * plan runs or an E-Stop is held, which is exactly when the other list is
   * skipped. Same contract otherwise: never throw, never block, no actuation.
   *
   * They also run OUTSIDE the tick's re-entrancy guard, on a flag of their own
   * — a hung `observe()` must not be able to stop the one thing that bounds how
   * long a dead process's snapshot is served as current.
   */
  alwaysChecks?: IdleCheck[];
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
  /** In-flight flag for `alwaysChecks[]` only — see {@link runAlwaysChecks}. */
  private alwaysTicking = false;
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
    // Claimed SYNCHRONOUSLY, before the first await: two ticks that both got
    // as far as an await before either set the flag would both go on to take a
    // frame, which is the backlog this guard exists to prevent.
    const claimed = !this.ticking;
    if (claimed) this.ticking = true;
    try {
      // Run for EVERY tick, claimed or dropped, under a flag of their own.
      // `observe()` is a VLM call with no timeout anywhere in its stack; on a
      // box whose GPU is shared it can block for minutes, or forever. Under one
      // shared guard that single hung call would stop the state re-assertion
      // PERMANENTLY — the clock keeps firing, every tick returns at the guard,
      // and the server mirror goes on serving a dead process's snapshot as
      // current: the exact failure the re-push exists to bound, defeated by the
      // guard meant to protect it.
      await this.runAlwaysChecks();
      if (!claimed) return;

      if (!this.deps.isEligible()) {
        this.holdAbsenceClock();
        return;
      }
      await this.runChecks(this.deps.checks);
      // A check may have claimed control — the heartbeat's tier-1 plan starts
      // exactly here. Ask again before spending a VLM call on a frame the
      // watcher can no longer act on, and hold the absence clock for the same
      // reason the top of this method does.
      if (!this.deps.isEligible()) {
        this.holdAbsenceClock();
        return;
      }

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
      this.logThrottled(`observation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Only the tick that claimed the flag may clear it — a dropped one
      // releasing another tick's guard would let the backlog straight back in.
      if (claimed) this.ticking = false;
    }
  }

  /**
   * While a plan runs (or an E-Stop is latched) we take no frames, so we have
   * NO evidence about the person in front of the robot. Absence must be
   * observed, never inferred from a gap in observation: hold the clock forward
   * so a 20 s plan cannot make somebody who never left look newly arrived and
   * re-fire the greeting the moment the robot is free again. `null` (nobody
   * seen yet / after reset()) is left alone — the next person genuinely is new
   * — and so is an absence we DID observe before going busy: that person really
   * left, so their return is a new arrival.
   */
  private holdAbsenceClock(): void {
    if (this.personVisibleInLastFrame && this.lastPersonSeenAt !== null) {
      this.lastPersonSeenAt = this.now();
    }
  }

  /**
   * The always-checks, under their own re-entrancy flag.
   *
   * Separate from `ticking` so the vision call can never hold them: a check
   * here is cheap and synchronous by contract, and the one thing it must
   * guarantee is that it keeps happening. It is still not re-entered — a check
   * that somehow blocks skips its next turn rather than stacking up.
   */
  private async runAlwaysChecks(): Promise<void> {
    if (this.alwaysTicking) return;
    this.alwaysTicking = true;
    try {
      await this.runChecks(this.deps.alwaysChecks);
    } finally {
      this.alwaysTicking = false;
    }
  }

  /**
   * Every registered check, in order. Each is isolated: a check that throws is
   * logged and the rest of the tick — including the person watch — carries on.
   * The greeting must not stop working because a heartbeat predicate broke.
   */
  private async runChecks(checks: IdleCheck[] | undefined): Promise<void> {
    for (const check of checks ?? []) {
      try {
        await check.run();
      } catch (err) {
        this.logThrottled(
          `check "${check.name}" failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /** A missing camera (or a broken check) must not spam the log every 3 s. */
  private logThrottled(message: string): void {
    const now = this.now();
    if (now - this.lastErrorLoggedAt <= 60_000) return;
    this.lastErrorLoggedAt = now;
    console.warn(`[AgentMode/IdleWatcher] ${message}`);
  }
}
