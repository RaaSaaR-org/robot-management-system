/**
 * @file ProcessSchedulerService.test.ts
 * @description Unit tests for ProcessSchedulerService — the cron-based scheduler that
 *   creates ProcessInstances from scheduled ProcessDefinitions. Tests drive the public
 *   API (start/stop lifecycle, tick, validateCron) deterministically by passing an
 *   explicit `now` and using a real cron-parser (pure computation). All I/O boundaries
 *   (ProcessRepository, ProcessManager) are mocked; setInterval is guarded with fake timers.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessDefinition, ProcessInstance } from '../../types/process.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (DB repo + downstream service)
// ---------------------------------------------------------------------------

vi.mock('../../repositories/ProcessRepository.js', () => ({
  processRepository: {
    findSchedulableDefinitions: vi.fn(),
    recordScheduledRun: vi.fn(),
  },
}));

vi.mock('../ProcessManager.js', () => ({
  processManager: {
    startProcess: vi.fn(),
  },
}));

import { ProcessSchedulerService, processSchedulerService } from '../ProcessSchedulerService.js';
import { processRepository as _processRepository } from '../../repositories/ProcessRepository.js';
import { processManager as _processManager } from '../ProcessManager.js';

// Retype mocked singletons so .mock* helpers typecheck (runtime object unchanged).
const processRepository = vi.mocked(_processRepository, true);
const processManager = vi.mocked(_processManager, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDefinition(overrides: Partial<ProcessDefinition> = {}): ProcessDefinition {
  return {
    id: 'def-1',
    name: 'Nightly Sweep',
    version: 1,
    status: 'ready',
    stepTemplates: [],
    triggerType: 'scheduled',
    cronExpression: '0 0 * * *', // daily at midnight
    enabled: true,
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: 'inst-1',
    processDefinitionId: 'def-1',
    processName: 'Nightly Sweep',
    status: 'pending',
    priority: 'normal',
    steps: [],
    currentStepIndex: 0,
    progress: 0,
    assignedRobotIds: [],
    createdBy: 'scheduler',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  processRepository.findSchedulableDefinitions.mockResolvedValue([]);
  processRepository.recordScheduledRun.mockResolvedValue(undefined);
  processManager.startProcess.mockResolvedValue(makeInstance());
  // Silence the service's console logging during tests.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Ensure no interval/timer leaks across tests so the run terminates.
  processSchedulerService.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// validateCron (static, pure)
// ===========================================================================

describe('validateCron', () => {
  it('accepts a valid cron expression and returns the next run ISO timestamp', () => {
    const result = ProcessSchedulerService.validateCron('0 0 * * *');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(typeof result.nextRun).toBe('string');
    // nextRun must be a parseable ISO string in the future-ish
    expect(Number.isNaN(Date.parse(result.nextRun!))).toBe(false);
  });

  it('rejects an invalid cron expression with an error message', () => {
    const result = ProcessSchedulerService.validateCron('not a cron');
    expect(result.valid).toBe(false);
    expect(result.nextRun).toBeUndefined();
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// start / stop lifecycle
// ===========================================================================

describe('start/stop lifecycle', () => {
  it('is idempotent: a second start does not schedule a second interval', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    processSchedulerService.start();
    processSchedulerService.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('stop clears the interval and allows a subsequent start', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    processSchedulerService.start();
    processSchedulerService.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    processSchedulerService.start();
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('stop is safe to call when never started', () => {
    expect(() => processSchedulerService.stop()).not.toThrow();
  });

  it('ticks on the scheduled interval after start', async () => {
    vi.useFakeTimers();
    processSchedulerService.start();

    // Advance past the 30s tick interval and let the immediate + interval ticks run.
    await vi.advanceTimersByTimeAsync(31_000);

    expect(processRepository.findSchedulableDefinitions).toHaveBeenCalled();
  });
});

// ===========================================================================
// tick — loading definitions
// ===========================================================================

describe('tick: loading definitions', () => {
  it('returns without firing when the repository load fails', async () => {
    processRepository.findSchedulableDefinitions.mockRejectedValue(new Error('db down'));

    await expect(processSchedulerService.tick(new Date())).resolves.toBeUndefined();
    expect(processManager.startProcess).not.toHaveBeenCalled();
    expect(processRepository.recordScheduledRun).not.toHaveBeenCalled();
  });

  it('skips definitions without a cron expression', async () => {
    processRepository.findSchedulableDefinitions.mockResolvedValue([
      makeDefinition({ cronExpression: undefined }),
    ]);

    await processSchedulerService.tick(new Date('2026-06-01T12:00:00.000Z'));

    expect(processManager.startProcess).not.toHaveBeenCalled();
    expect(processRepository.recordScheduledRun).not.toHaveBeenCalled();
  });

  it('does nothing when there are no schedulable definitions', async () => {
    processRepository.findSchedulableDefinitions.mockResolvedValue([]);

    await processSchedulerService.tick(new Date());

    expect(processManager.startProcess).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// tick — first-time scheduling (nextRunAt unset)
// ===========================================================================

describe('tick: first-time scheduling', () => {
  it('initialises nextRunAt and does NOT fire when nextRunAt is unset', async () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const def = makeDefinition({ nextRunAt: undefined, cronExpression: '0 0 * * *' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);

    await processSchedulerService.tick(now);

    // No instance fired on the first observation.
    expect(processManager.startProcess).not.toHaveBeenCalled();
    // nextRunAt is computed and persisted; lastRun defaults to `now` (no prior run).
    expect(processRepository.recordScheduledRun).toHaveBeenCalledTimes(1);
    const [id, lastRun, nextRun] = processRepository.recordScheduledRun.mock.calls[0];
    expect(id).toBe('def-1');
    expect(lastRun).toEqual(now);
    // Daily-at-midnight cron => next run is strictly after `now` and within 24h.
    expect(nextRun).toBeInstanceOf(Date);
    const nextMs = (nextRun as Date).getTime();
    expect(nextMs).toBeGreaterThan(now.getTime());
    expect(nextMs - now.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    // Lands on a local midnight (matches the `0 0 * * *` schedule).
    expect((nextRun as Date).getHours()).toBe(0);
    expect((nextRun as Date).getMinutes()).toBe(0);
  });

  it('uses lastScheduledRunAt as the recorded lastRun when present on first-time init', async () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const def = makeDefinition({
      nextRunAt: undefined,
      lastScheduledRunAt: '2026-05-31T00:00:00.000Z',
    });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);

    await processSchedulerService.tick(now);

    const [, lastRun] = processRepository.recordScheduledRun.mock.calls[0];
    expect((lastRun as Date).toISOString()).toBe('2026-05-31T00:00:00.000Z');
    expect(processManager.startProcess).not.toHaveBeenCalled();
  });

  it('does not persist when the cron expression is invalid on first-time init', async () => {
    const def = makeDefinition({ nextRunAt: undefined, cronExpression: 'totally-invalid' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);

    await processSchedulerService.tick(new Date('2026-06-01T12:00:00.000Z'));

    expect(processRepository.recordScheduledRun).not.toHaveBeenCalled();
    expect(processManager.startProcess).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// tick — firing due definitions
// ===========================================================================

describe('tick: firing due definitions', () => {
  it('does not fire when nextRunAt is in the future', async () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const def = makeDefinition({ nextRunAt: '2026-06-01T13:00:00.000Z' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);

    await processSchedulerService.tick(now);

    expect(processManager.startProcess).not.toHaveBeenCalled();
    expect(processRepository.recordScheduledRun).not.toHaveBeenCalled();
  });

  it('fires an instance and advances nextRunAt when due (nextRunAt <= now)', async () => {
    const now = new Date('2026-06-02T00:00:05.000Z');
    const def = makeDefinition({ nextRunAt: '2026-06-02T00:00:00.000Z', cronExpression: '0 0 * * *' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);
    processManager.startProcess.mockResolvedValue(makeInstance({ id: 'fired-1' }));

    await processSchedulerService.tick(now);

    // Instance started via the process manager with scheduler attribution.
    expect(processManager.startProcess).toHaveBeenCalledTimes(1);
    expect(processManager.startProcess).toHaveBeenCalledWith(
      'def-1',
      { priority: 'normal' },
      'scheduler'
    );

    // Schedule advanced: lastRun = now, nextRun computed from cron after `now`.
    expect(processRepository.recordScheduledRun).toHaveBeenCalledTimes(1);
    const [id, lastRun, nextRun] = processRepository.recordScheduledRun.mock.calls[0];
    expect(id).toBe('def-1');
    expect(lastRun).toEqual(now);
    // Next run is the next local midnight strictly after `now` (within 24h).
    const nextMs = (nextRun as Date).getTime();
    expect(nextMs).toBeGreaterThan(now.getTime());
    expect(nextMs - now.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect((nextRun as Date).getHours()).toBe(0);
    expect((nextRun as Date).getMinutes()).toBe(0);
  });

  it('fires exactly at the boundary (nextRunAt === now)', async () => {
    const now = new Date('2026-06-02T00:00:00.000Z');
    const def = makeDefinition({ nextRunAt: '2026-06-02T00:00:00.000Z' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);

    await processSchedulerService.tick(now);

    expect(processManager.startProcess).toHaveBeenCalledTimes(1);
  });

  it('records a null nextRun when the cron expression is invalid at fire time', async () => {
    const now = new Date('2026-06-02T00:00:05.000Z');
    const def = makeDefinition({
      nextRunAt: '2026-06-02T00:00:00.000Z',
      cronExpression: 'still-invalid',
    });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);

    await processSchedulerService.tick(now);

    expect(processManager.startProcess).toHaveBeenCalledTimes(1);
    const [, , nextRun] = processRepository.recordScheduledRun.mock.calls[0];
    expect(nextRun).toBeNull();
  });

  it('still advances the schedule even when startProcess returns null', async () => {
    const now = new Date('2026-06-02T00:00:05.000Z');
    const def = makeDefinition({ nextRunAt: '2026-06-02T00:00:00.000Z' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([def]);
    processManager.startProcess.mockResolvedValue(null);

    await processSchedulerService.tick(now);

    expect(processManager.startProcess).toHaveBeenCalledTimes(1);
    expect(processRepository.recordScheduledRun).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// tick — error isolation across multiple definitions
// ===========================================================================

describe('tick: per-definition error isolation', () => {
  it('continues processing other definitions when one fire throws', async () => {
    const now = new Date('2026-06-02T00:00:05.000Z');
    const defA = makeDefinition({ id: 'A', name: 'A', nextRunAt: '2026-06-02T00:00:00.000Z' });
    const defB = makeDefinition({ id: 'B', name: 'B', nextRunAt: '2026-06-02T00:00:00.000Z' });
    processRepository.findSchedulableDefinitions.mockResolvedValue([defA, defB]);

    // First startProcess throws, second succeeds.
    processManager.startProcess
      .mockRejectedValueOnce(new Error('A blew up'))
      .mockResolvedValueOnce(makeInstance({ id: 'inst-B' }));

    await expect(processSchedulerService.tick(now)).resolves.toBeUndefined();

    // Both definitions were attempted despite the first throwing.
    expect(processManager.startProcess).toHaveBeenCalledTimes(2);
    // Only the successful one advanced its schedule.
    expect(processRepository.recordScheduledRun).toHaveBeenCalledTimes(1);
    const [id] = processRepository.recordScheduledRun.mock.calls[0];
    expect(id).toBe('B');
  });

  it('fires multiple due definitions in one tick', async () => {
    const now = new Date('2026-06-02T00:00:05.000Z');
    processRepository.findSchedulableDefinitions.mockResolvedValue([
      makeDefinition({ id: 'A', nextRunAt: '2026-06-02T00:00:00.000Z' }),
      makeDefinition({ id: 'B', nextRunAt: '2026-06-01T23:59:00.000Z' }),
    ]);

    await processSchedulerService.tick(now);

    expect(processManager.startProcess).toHaveBeenCalledTimes(2);
    expect(processRepository.recordScheduledRun).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// singleton / class export sanity
// ===========================================================================

describe('ProcessSchedulerService singleton', () => {
  it('getInstance returns the same shared instance as the exported singleton', () => {
    expect(ProcessSchedulerService.getInstance()).toBe(processSchedulerService);
  });

  it('the exported singleton is an instance of the class', () => {
    expect(processSchedulerService).toBeInstanceOf(ProcessSchedulerService);
  });
});
