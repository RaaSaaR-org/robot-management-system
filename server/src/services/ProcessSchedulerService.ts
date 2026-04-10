/**
 * @file ProcessSchedulerService.ts
 * @description Cron-based scheduler that creates ProcessInstances from scheduled
 * ProcessDefinitions. Added by TASK-143 to back the "Automations → Scheduled" UX.
 * @feature processes
 */

import { CronExpressionParser } from 'cron-parser';
import { processRepository } from '../repositories/ProcessRepository.js';
import { processManager } from './ProcessManager.js';
import type { ProcessDefinition } from '../types/process.types.js';

const TICK_INTERVAL_MS = 30_000; // 30s — fine-grained enough for minute-level cron

/**
 * Background service that polls ProcessDefinitions with triggerType='scheduled'
 * and creates ProcessInstances when their nextRunAt is due.
 *
 * Design:
 * - Pure poll-based (no in-memory cron jobs) — survives restarts trivially.
 * - Each tick recomputes nextRunAt from the cron expression to absorb drift.
 * - The ProcessManager handles the actual instance lifecycle.
 */
export class ProcessSchedulerService {
  private static instance: ProcessSchedulerService;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private constructor() {}

  static getInstance(): ProcessSchedulerService {
    if (!ProcessSchedulerService.instance) {
      ProcessSchedulerService.instance = new ProcessSchedulerService();
    }
    return ProcessSchedulerService.instance;
  }

  /**
   * Start the polling loop. Idempotent.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[ProcessScheduler] Started (tick interval: 30s)');

    // First tick on the next event loop turn so app boot completes.
    setImmediate(() => {
      void this.tick();
    });

    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
  }

  /**
   * Stop the polling loop (for tests / graceful shutdown).
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log('[ProcessScheduler] Stopped');
  }

  /**
   * One scheduler tick: find due definitions, start instances, advance nextRunAt.
   * Public so tests can drive it deterministically.
   */
  async tick(now: Date = new Date()): Promise<void> {
    let definitions: ProcessDefinition[];
    try {
      definitions = await processRepository.findSchedulableDefinitions();
    } catch (err) {
      console.error('[ProcessScheduler] Failed to load schedulable definitions:', err);
      return;
    }

    for (const def of definitions) {
      if (!def.cronExpression) continue;

      try {
        const due = this.isDue(def, now);
        if (!due) continue;

        await this.fire(def, now);
      } catch (err) {
        console.error(`[ProcessScheduler] Error processing definition ${def.id}:`, err);
      }
    }
  }

  /**
   * Decide whether a definition is due to fire at `now`.
   *
   * - If nextRunAt is unset (just created or just enabled), compute it from
   *   the cron expression and persist; the instance will fire on the next tick.
   *   This avoids surprise back-fills on first save.
   * - Otherwise, fire if nextRunAt <= now.
   */
  private isDue(def: ProcessDefinition, now: Date): boolean {
    if (!def.cronExpression) return false;

    if (!def.nextRunAt) {
      // First-time scheduling — initialise nextRunAt and skip this tick.
      const next = this.computeNextRun(def.cronExpression, now);
      if (next) {
        void processRepository.recordScheduledRun(
          def.id,
          def.lastScheduledRunAt ? new Date(def.lastScheduledRunAt) : now,
          next
        );
      }
      return false;
    }

    return new Date(def.nextRunAt) <= now;
  }

  /**
   * Fire a scheduled instance and advance the schedule.
   */
  private async fire(def: ProcessDefinition, now: Date): Promise<void> {
    console.log(`[ProcessScheduler] Firing scheduled run for "${def.name}" (${def.id})`);

    const instance = await processManager.startProcess(
      def.id,
      { priority: 'normal' },
      'scheduler',
    );

    const next = def.cronExpression ? this.computeNextRun(def.cronExpression, now) : null;
    await processRepository.recordScheduledRun(def.id, now, next);

    if (instance) {
      console.log(
        `[ProcessScheduler] Started instance ${instance.id} for "${def.name}". Next run: ${next?.toISOString() ?? 'none'}`
      );
    }
  }

  /**
   * Parse a cron expression and return the next run timestamp after `from`.
   * Returns null on invalid expressions (logged for visibility).
   */
  private computeNextRun(cronExpression: string, from: Date): Date | null {
    try {
      const interval = CronExpressionParser.parse(cronExpression, { currentDate: from });
      return interval.next().toDate();
    } catch (err) {
      console.error(`[ProcessScheduler] Invalid cron expression "${cronExpression}":`, err);
      return null;
    }
  }

  /**
   * Validate a cron expression without scheduling. Used by routes to give
   * user feedback before saving.
   */
  static validateCron(cronExpression: string): { valid: boolean; nextRun?: string; error?: string } {
    try {
      const interval = CronExpressionParser.parse(cronExpression, { currentDate: new Date() });
      return { valid: true, nextRun: interval.next().toDate().toISOString() };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Invalid cron expression' };
    }
  }
}

export const processSchedulerService = ProcessSchedulerService.getInstance();
