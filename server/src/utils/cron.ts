/**
 * @file cron.ts
 * @description Cron helpers shared by every server-side scheduler (TASK-212).
 *              Extracted verbatim from `ProcessSchedulerService` so the patrol
 *              scheduler does not duplicate the parsing / due-check logic:
 *              `computeNextRun`, `isDue`, `validateCron`.
 * @feature processes
 */

import { CronExpressionParser } from 'cron-parser';

/** The bit of a schedule the due-check needs; ProcessDefinition and PatrolRoute both fit. */
export interface CronSchedule {
  cronExpression?: string | null;
  /** Next planned fire, ISO string or Date; unset = never initialised. */
  nextRunAt?: string | Date | null;
}

export interface CronValidation {
  valid: boolean;
  /** ISO of the first upcoming run (kept for the ProcessScheduler contract). */
  nextRun?: string;
  /** ISO of the next `count` runs (5 by default) — for previews in the UI. */
  nextRuns?: string[];
  error?: string;
}

/**
 * Parse a cron expression and return the next run timestamp strictly after
 * `from`. Returns null on invalid expressions (logged for visibility) — same
 * behaviour the process scheduler always had.
 */
export function computeNextRun(cronExpression: string, from: Date, tag = 'Cron'): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { currentDate: from });
    return interval.next().toDate();
  } catch (err) {
    console.error(`[${tag}] Invalid cron expression "${cronExpression}":`, err);
    return null;
  }
}

/**
 * The next `count` run timestamps strictly after `from`. Throws on an
 * invalid expression (callers that want a boolean use {@link validateCron}).
 */
export function computeNextRuns(cronExpression: string, from: Date, count: number): Date[] {
  const interval = CronExpressionParser.parse(cronExpression, { currentDate: from });
  const out: Date[] = [];
  for (let i = 0; i < count; i++) out.push(interval.next().toDate());
  return out;
}

/**
 * True when a schedule that HAS a cron expression has no `nextRunAt` yet —
 * the caller should initialise it (from `now`, no back-fill) and NOT fire.
 */
export function needsInitialNextRun(schedule: CronSchedule): boolean {
  return Boolean(schedule.cronExpression) && !schedule.nextRunAt;
}

/**
 * Decide whether a schedule is due at `now`: it has a cron expression, an
 * initialised `nextRunAt`, and `nextRunAt <= now`. A schedule without a
 * `nextRunAt` is never due (see {@link needsInitialNextRun}) — that is what
 * keeps a freshly saved schedule from back-filling on its first tick.
 */
export function isDue(schedule: CronSchedule, now: Date): boolean {
  if (!schedule.cronExpression) return false;
  if (!schedule.nextRunAt) return false;
  return new Date(schedule.nextRunAt) <= now;
}

/**
 * Validate a cron expression without scheduling. Used by routes to give user
 * feedback before saving. `count` upcoming runs are returned in `nextRuns`
 * (the first also as `nextRun`).
 */
export function validateCron(cronExpression: string, count = 5, from: Date = new Date()): CronValidation {
  try {
    const runs = computeNextRuns(cronExpression, from, Math.max(1, count));
    const iso = runs.map((d) => d.toISOString());
    return { valid: true, nextRun: iso[0], nextRuns: iso };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid cron expression' };
  }
}
