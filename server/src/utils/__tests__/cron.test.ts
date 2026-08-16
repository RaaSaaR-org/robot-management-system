/**
 * @file cron.test.ts
 * @description The cron helpers extracted from ProcessSchedulerService (TASK-212)
 *              behave exactly as the scheduler did: next run strictly after
 *              `from`, null on garbage, no back-fill without a nextRunAt.
 * @feature processes
 */

import { describe, it, expect, vi } from 'vitest';
import { computeNextRun, computeNextRuns, isDue, needsInitialNextRun, validateCron } from '../cron.js';
import { ProcessSchedulerService } from '../../services/ProcessSchedulerService.js';

describe('utils/cron', () => {
  it('computeNextRun returns the next slot strictly after `from`', () => {
    const from = new Date('2026-08-16T10:00:00.000Z');
    const next = computeNextRun('*/5 * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    expect(next!.getTime() - from.getTime()).toBeLessThanOrEqual(5 * 60_000);
  });

  it('computeNextRun returns null (and logs) on an invalid expression', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(computeNextRun('not a cron', new Date())).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('computeNextRuns yields N increasing instants', () => {
    const from = new Date('2026-08-16T10:00:00.000Z');
    const runs = computeNextRuns('0 * * * *', from, 3);
    expect(runs).toHaveLength(3);
    expect(runs[0].getTime()).toBeGreaterThan(from.getTime());
    expect(runs[1].getTime() - runs[0].getTime()).toBe(3600_000);
    expect(runs[2].getTime() - runs[1].getTime()).toBe(3600_000);
  });

  it('isDue: never without a cron, never without nextRunAt, true once nextRunAt <= now', () => {
    const now = new Date('2026-08-16T10:00:00.000Z');
    expect(isDue({ cronExpression: null, nextRunAt: now }, now)).toBe(false);
    expect(isDue({ cronExpression: '* * * * *', nextRunAt: null }, now)).toBe(false);
    expect(isDue({ cronExpression: '* * * * *', nextRunAt: '2026-08-16T10:00:00.000Z' }, now)).toBe(true);
    expect(isDue({ cronExpression: '* * * * *', nextRunAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(isDue({ cronExpression: '* * * * *', nextRunAt: new Date(now.getTime() - 1) }, now)).toBe(true);
  });

  it('needsInitialNextRun only when a cron exists and nextRunAt does not', () => {
    expect(needsInitialNextRun({ cronExpression: '* * * * *' })).toBe(true);
    expect(needsInitialNextRun({ cronExpression: '* * * * *', nextRunAt: new Date() })).toBe(false);
    expect(needsInitialNextRun({ cronExpression: null })).toBe(false);
  });

  it('validateCron: valid → nextRun + 5 nextRuns; invalid → error', () => {
    const ok = validateCron('0 22,3 * * 1-5');
    expect(ok.valid).toBe(true);
    expect(ok.nextRuns).toHaveLength(5);
    expect(ok.nextRun).toBe(ok.nextRuns![0]);
    const bad = validateCron('* * * * 9');
    expect(bad.valid).toBe(false);
    expect(bad.error).toBeDefined();
    expect(validateCron('nope').valid).toBe(false);
  });

  it('ProcessSchedulerService.validateCron keeps its old {valid, nextRun, error} contract', () => {
    const ok = ProcessSchedulerService.validateCron('*/5 * * * *');
    expect(ok).toEqual({ valid: true, nextRun: expect.any(String) });
    expect(new Date(ok.nextRun!).getTime()).toBeGreaterThan(Date.now());
    const bad = ProcessSchedulerService.validateCron('garbage');
    expect(bad.valid).toBe(false);
    expect(bad.error).toBeDefined();
    expect('nextRun' in bad).toBe(false);
  });
});
