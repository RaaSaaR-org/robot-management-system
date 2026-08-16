/**
 * @file PatrolSchedulerService.ts
 * @description Cron-driven patrol scheduler (TASK-212). Every 30 s it walks
 *              the enabled routes that have a cron expression and a robot,
 *              fires each one ONCE per due slot (`nextRunAt` persisted on the
 *              route, advanced after the fire) through the same start path an
 *              operator uses — origin 'scheduled', mode 'patrol' — and, when
 *              the robot refused or was unreachable, retries ONCE after
 *              `PATROL_RETRY_MIN` (default 10) minutes. Every tick also asks
 *              PatrolService to close runs stuck at 'running' past
 *              `PATROL_RUN_STALE_MIN` (default 60). Enabled by default;
 *              `PATROL_SCHEDULER_ENABLED=false` turns it off.
 * @feature patrol
 */

import { patrolRepository as defaultRepo, type PatrolRepository, type PatrolRouteRecord } from '../repositories/PatrolRepository.js';
import { patrolService as defaultPatrolService, patrolRunStaleMs, type StartRunOutcome } from './PatrolService.js';
import { computeNextRun, isDue, needsInitialNextRun } from '../utils/cron.js';

const TICK_INTERVAL_MS = 30_000;
const DEFAULT_RETRY_MIN = 10;

export function patrolSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.PATROL_SCHEDULER_ENABLED ?? 'true').trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

export function patrolRetryMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PATROL_RETRY_MIN);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETRY_MIN;
}

interface PendingRetry {
  /** The slot the original fire belonged to (ISO) — one retry per slot. */
  slot: string;
  dueAt: number;
}

export interface PatrolSchedulerDeps {
  repo?: PatrolRepository;
  /** `startRun` drives the tick; the rest is optional so a test can pass a bare fake. */
  starter?: {
    startRun: typeof defaultPatrolService.startRun;
    recordFailedStart?: typeof defaultPatrolService.recordFailedStart;
    reconcileStaleRuns?: typeof defaultPatrolService.reconcileStaleRuns;
  };
  now?: () => number;
  retryMinutes?: () => number;
  /** How long a 'running' run may go quiet before it stops blocking retries. */
  staleRunMs?: () => number;
}

export class PatrolSchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private readonly repo: PatrolRepository;
  private readonly starter: NonNullable<PatrolSchedulerDeps['starter']>;
  private readonly now: () => number;
  private readonly retryMinutes: () => number;
  private readonly staleRunMs: () => number;
  /** routeId → pending retry (in memory: a restart forgets it, which is fine). */
  private readonly retries = new Map<string, PendingRetry>();

  constructor(deps: PatrolSchedulerDeps = {}) {
    this.repo = deps.repo ?? defaultRepo;
    this.starter = deps.starter ?? defaultPatrolService;
    this.now = deps.now ?? (() => Date.now());
    this.retryMinutes = deps.retryMinutes ?? (() => patrolRetryMinutes());
    this.staleRunMs = deps.staleRunMs ?? (() => patrolRunStaleMs());
  }

  /** Start the polling loop. Idempotent; a no-op when disabled by env. */
  start(): void {
    if (this.running) return;
    if (!patrolSchedulerEnabled()) {
      console.log('[PatrolScheduler] Disabled (PATROL_SCHEDULER_ENABLED=false)');
      return;
    }
    this.running = true;
    console.log('[PatrolScheduler] Started (tick interval: 30s)');
    setImmediate(() => {
      void this.tick();
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.running) console.log('[PatrolScheduler] Stopped');
    this.running = false;
  }

  /** Pending retries (for tests / diagnostics). */
  pendingRetries(): Array<{ routeId: string; slot: string; dueAt: string }> {
    return [...this.retries.entries()].map(([routeId, r]) => ({ routeId, slot: r.slot, dueAt: new Date(r.dueAt).toISOString() }));
  }

  /**
   * One tick. Public so tests can drive it deterministically. Overlapping
   * ticks are skipped (a slow robot must not double-fire a slot).
   */
  async tick(now: Date = new Date(this.now())): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      let routes: PatrolRouteRecord[];
      try {
        routes = await this.repo.listSchedulableRoutes();
      } catch (err) {
        console.error('[PatrolScheduler] Failed to load routes:', err);
        return;
      }
      const seen = new Set<string>();
      for (const route of routes) {
        seen.add(route.id);
        try {
          await this.processRoute(route, now);
        } catch (err) {
          console.error(`[PatrolScheduler] Error processing route ${route.id}:`, err);
        }
      }
      // A route that was disabled / lost its cron in the meantime loses its retry.
      for (const routeId of [...this.retries.keys()]) {
        if (!seen.has(routeId)) this.retries.delete(routeId);
      }
      // A lost `agent:patrol:finished` (agent restart, dropped push) leaves a
      // run at 'running' forever — a live banner that never ends for the
      // operator and, here, a `hasRunningRun` guard that would drop every
      // future retry for that route. Ask the robot and close what it no
      // longer knows.
      try {
        await this.starter.reconcileStaleRuns?.();
      } catch (err) {
        console.error('[PatrolScheduler] Stale-run reconciliation failed:', err);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async processRoute(route: PatrolRouteRecord, now: Date): Promise<void> {
    if (!route.cronExpression || !route.robotId) return;

    // Retry first: it belongs to an older slot. One start per route per tick —
    // firing the retry AND a due slot in the same call would have the second
    // start refused ('running') and raise a spurious skipped-run alert.
    const retry = this.retries.get(route.id);
    if (retry && retry.dueAt <= now.getTime()) {
      this.retries.delete(route.id);
      if (await this.hasRunningRun(route.id)) {
        console.log(`[PatrolScheduler] Retry for "${route.name}" (slot ${retry.slot}) dropped — a run is already in progress`);
        return;
      }
      console.log(`[PatrolScheduler] Retrying "${route.name}" (slot ${retry.slot})`);
      await this.fire(route, retry.slot, /* isRetry */ true);
      return;
    }

    if (needsInitialNextRun(route)) {
      // First sight of a schedule: plan the next slot from now, never back-fill.
      const next = computeNextRun(route.cronExpression, now, 'PatrolScheduler');
      await this.repo.updateRoute(route.id, { nextRunAt: next });
      return;
    }
    if (!isDue(route, now)) return;

    const slot = new Date(route.nextRunAt as string).toISOString();
    // A newer slot supersedes any retry still pending for an older one.
    this.retries.delete(route.id);
    // Advance the slot BEFORE firing so a slow/failed start cannot re-fire it.
    const next = computeNextRun(route.cronExpression, now, 'PatrolScheduler');
    await this.repo.recordScheduledRun(route.id, now, next);
    console.log(`[PatrolScheduler] Firing "${route.name}" (${route.id}) for slot ${slot}; next ${next?.toISOString() ?? 'none'}`);
    await this.fire(route, slot, false);
  }

  /**
   * True when the server holds a run for this route that is plausibly still in
   * progress. Bounded on purpose: an unbounded "any row says running" answer
   * meant a single stale row (a `finished` event that never arrived) silently
   * dropped EVERY retry for that route for the rest of the process lifetime,
   * with only a console.log. A run that has gone quiet past the stale bound no
   * longer blocks the retry — reconciliation closes it, and even if that could
   * not run, the route keeps being patrolled.
   */
  private async hasRunningRun(routeId: string): Promise<boolean> {
    try {
      const runs = await this.repo.listRuns({ routeId, status: 'running', limit: 5 });
      const bound = this.staleRunMs();
      const now = this.now();
      return runs.some((r) => {
        const started = Date.parse(r.startedAt);
        // An unparseable stamp is treated as in progress: never double-start a robot on a parse failure.
        return !Number.isFinite(started) || now - started < bound;
      });
    } catch (err) {
      console.warn(`[PatrolScheduler] running-run lookup for ${routeId} failed:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async fire(route: PatrolRouteRecord, slot: string, isRetry: boolean): Promise<void> {
    let outcome: StartRunOutcome | null = null;
    let failed = false;
    try {
      outcome = await this.starter.startRun(route.id, { robotId: route.robotId, mode: 'patrol', origin: 'scheduled' });
    } catch (err) {
      failed = true;
      const why = err instanceof Error ? err.message : String(err);
      console.error(`[PatrolScheduler] start "${route.name}" threw:`, why);
      // The robot answered 4xx (id mismatch, agent too old) or the lookup
      // failed: startRun re-throws those instead of minting a phantom
      // 'unreachable' run. Nobody is watching a scheduled slot, so record the
      // skip here — otherwise the nightly round would silently not happen.
      await this.starter.recordFailedStart?.(route.id, route.robotId, 'patrol', 'scheduled', why);
    }
    const refused = outcome ? !outcome.result.accepted : true;
    if (!refused) {
      console.log(`[PatrolScheduler] "${route.name}" accepted (run ${outcome?.result.runId ?? '?'})`);
      return;
    }
    const why = outcome?.result.reason ?? (failed ? 'error' : 'unknown');
    if (isRetry) {
      console.warn(`[PatrolScheduler] "${route.name}" refused again on retry (${why}) — giving up for slot ${slot}`);
      return;
    }
    // Refused or unreachable: retry ONCE per slot after PATROL_RETRY_MIN —
    // a busy robot, a battery on the charger or a rebooting agent may well
    // be ready in ten minutes; a second refusal is final for this slot.
    const dueAt = this.now() + this.retryMinutes() * 60_000;
    this.retries.set(route.id, { slot, dueAt });
    console.warn(`[PatrolScheduler] "${route.name}" refused (${why}) — retry once at ${new Date(dueAt).toISOString()}`);
  }
}

export const patrolSchedulerService = new PatrolSchedulerService();
