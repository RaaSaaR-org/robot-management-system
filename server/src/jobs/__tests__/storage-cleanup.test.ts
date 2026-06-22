/**
 * @file storage-cleanup.test.ts
 * @description Unit tests for the StorageCleanupJob scheduled job. The storage
 *   boundary (`isRustFSInitialized` + `modelStorage.cleanupTempUploads`) is the
 *   only thing mocked; all stats bookkeeping, branch logic, formatting and the
 *   timer-based scheduling run for real (with fake timers so the run terminates).
 * @feature storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CleanupResult } from '../../storage/index.js';

// ---------------------------------------------------------------------------
// Mock the storage boundary. `isRustFSInitialized` gates the whole job and
// `modelStorage.cleanupTempUploads` is the I/O call; everything else in the
// barrel is left out because the job under test never touches it.
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => ({
  isRustFSInitialized: vi.fn<() => boolean>(),
  cleanupTempUploads: vi.fn<(maxAgeHours?: number) => Promise<CleanupResult>>(),
}));

vi.mock('../../storage/index.js', () => ({
  isRustFSInitialized: hoisted.isRustFSInitialized,
  modelStorage: {
    cleanupTempUploads: hoisted.cleanupTempUploads,
  },
}));

import { StorageCleanupJob, storageCleanupJob } from '../storage-cleanup.js';

const isRustFSInitialized = hoisted.isRustFSInitialized;
const cleanupTempUploads = hoisted.cleanupTempUploads;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeResult(overrides: Partial<CleanupResult> = {}): CleanupResult {
  return {
    deletedCount: 3,
    deletedSize: 1024,
    errors: [],
    ...overrides,
  };
}

describe('StorageCleanupJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence the job's console noise without losing assertion ability.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    isRustFSInitialized.mockReturnValue(true);
    cleanupTempUploads.mockResolvedValue(makeResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // runCleanup
  // -------------------------------------------------------------------------
  describe('runCleanup', () => {
    it('skips and returns an "not initialized" result when storage is down', async () => {
      isRustFSInitialized.mockReturnValue(false);
      const job = new StorageCleanupJob();

      const result = await job.runCleanup();

      expect(result).toEqual({
        deletedCount: 0,
        deletedSize: 0,
        errors: ['Storage not initialized'],
      });
      expect(cleanupTempUploads).not.toHaveBeenCalled();
      // Stats untouched on a skip.
      expect(job.getCleanupStats().runCount).toBe(0);
    });

    it('runs the cleanup and updates stats on success', async () => {
      cleanupTempUploads.mockResolvedValue(
        makeResult({ deletedCount: 5, deletedSize: 2048 })
      );
      const job = new StorageCleanupJob();

      const result = await job.runCleanup(12);

      expect(cleanupTempUploads).toHaveBeenCalledWith(12);
      expect(result).toEqual({ deletedCount: 5, deletedSize: 2048, errors: [] });

      const stats = job.getCleanupStats();
      expect(stats.runCount).toBe(1);
      expect(stats.totalDeleted).toBe(5);
      expect(stats.totalSizeDeleted).toBe(2048);
      expect(stats.lastResult).toEqual(result);
      expect(stats.lastRunAt).toBeInstanceOf(Date);
    });

    it('defaults maxAgeHours to 24', async () => {
      const job = new StorageCleanupJob();
      await job.runCleanup();
      expect(cleanupTempUploads).toHaveBeenCalledWith(24);
    });

    it('accumulates totals across multiple runs', async () => {
      const job = new StorageCleanupJob();

      cleanupTempUploads.mockResolvedValueOnce(makeResult({ deletedCount: 2, deletedSize: 100 }));
      await job.runCleanup();
      cleanupTempUploads.mockResolvedValueOnce(makeResult({ deletedCount: 3, deletedSize: 200 }));
      await job.runCleanup();

      const stats = job.getCleanupStats();
      expect(stats.runCount).toBe(2);
      expect(stats.totalDeleted).toBe(5);
      expect(stats.totalSizeDeleted).toBe(300);
    });

    it('still returns and counts a result that carries cleanup errors', async () => {
      cleanupTempUploads.mockResolvedValue(
        makeResult({ deletedCount: 1, deletedSize: 10, errors: ['boom'] })
      );
      const job = new StorageCleanupJob();

      const result = await job.runCleanup();

      expect(result.errors).toEqual(['boom']);
      expect(job.getCleanupStats().runCount).toBe(1);
    });

    it('returns an error result (without updating stats) when the storage call throws', async () => {
      cleanupTempUploads.mockRejectedValue(new Error('disk exploded'));
      const job = new StorageCleanupJob();

      const result = await job.runCleanup();

      expect(result).toEqual({
        deletedCount: 0,
        deletedSize: 0,
        errors: ['disk exploded'],
      });
      // The catch path bails before stats bookkeeping.
      expect(job.getCleanupStats().runCount).toBe(0);
      // isRunning reset in finally.
      expect(job.isJobRunning()).toBe(false);
    });

    it('handles a non-Error rejection with an "Unknown error" message', async () => {
      cleanupTempUploads.mockRejectedValue('string failure');
      const job = new StorageCleanupJob();

      const result = await job.runCleanup();

      expect(result.errors).toEqual(['Unknown error']);
    });

    it('skips a concurrent run while one is already in progress', async () => {
      let resolveCleanup!: (r: CleanupResult) => void;
      cleanupTempUploads.mockReturnValue(
        new Promise<CleanupResult>((resolve) => {
          resolveCleanup = resolve;
        })
      );
      const job = new StorageCleanupJob();

      const firstPromise = job.runCleanup();
      // While the first is still pending, isRunning is true.
      expect(job.isJobRunning()).toBe(true);

      const secondResult = await job.runCleanup();
      expect(secondResult).toEqual({
        deletedCount: 0,
        deletedSize: 0,
        errors: ['Cleanup already in progress'],
      });

      // Only one real cleanup invocation despite two runCleanup calls.
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);

      resolveCleanup(makeResult());
      await firstPromise;
      expect(job.isJobRunning()).toBe(false);
    });

    it('resets isRunning to false after a successful run', async () => {
      const job = new StorageCleanupJob();
      await job.runCleanup();
      expect(job.isJobRunning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getCleanupStats
  // -------------------------------------------------------------------------
  describe('getCleanupStats', () => {
    it('returns the initial zeroed stats for a fresh job', () => {
      const job = new StorageCleanupJob();
      expect(job.getCleanupStats()).toEqual({
        lastRunAt: null,
        lastResult: null,
        totalDeleted: 0,
        totalSizeDeleted: 0,
        runCount: 0,
      });
    });

    it('returns a copy, not the internal stats object', async () => {
      const job = new StorageCleanupJob();
      const snapshot = job.getCleanupStats();
      snapshot.runCount = 999;
      // Mutating the snapshot must not affect the job's real state.
      expect(job.getCleanupStats().runCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // isJobRunning
  // -------------------------------------------------------------------------
  describe('isJobRunning', () => {
    it('is false on a fresh job', () => {
      expect(new StorageCleanupJob().isJobRunning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // startSchedule / stopSchedule (timer-driven)
  // -------------------------------------------------------------------------
  describe('startSchedule / stopSchedule', () => {
    it('runs cleanup at the first 3 AM boundary and then on the recurring interval', async () => {
      vi.useFakeTimers();
      // 1 AM local — next 3 AM is 2 hours away (same day).
      vi.setSystemTime(new Date(2026, 5, 22, 1, 0, 0));
      const job = new StorageCleanupJob();

      job.startSchedule(24);
      expect(cleanupTempUploads).not.toHaveBeenCalled();

      // Advance to 3 AM (initial delay). The setTimeout fires runCleanup.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);

      // Advance one full 24h interval — recurring interval fires again.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(cleanupTempUploads).toHaveBeenCalledTimes(2);

      job.stopSchedule();
    });

    it('schedules the first run for the NEXT day when current time is past 3 AM', async () => {
      vi.useFakeTimers();
      // 4 AM — already past 3 AM, so first run is ~23h away.
      vi.setSystemTime(new Date(2026, 5, 22, 4, 0, 0));
      const job = new StorageCleanupJob();

      job.startSchedule(24);

      // 22h later: still before next 3 AM.
      await vi.advanceTimersByTimeAsync(22 * 60 * 60 * 1000);
      expect(cleanupTempUploads).not.toHaveBeenCalled();

      // One more hour reaches the next-day 3 AM.
      await vi.advanceTimersByTimeAsync(1 * 60 * 60 * 1000);
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);

      job.stopSchedule();
    });

    it('does not start a second schedule when one is already running', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 22, 1, 0, 0));
      const job = new StorageCleanupJob();

      job.startSchedule(24);
      // Second call should be a no-op (guarded by intervalId). Note the guard
      // only checks intervalId, which is set after the first setTimeout fires.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000); // reach first run, sets intervalId
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);

      job.startSchedule(24); // now intervalId is set -> warns and returns
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      // Only the original interval contributes -> one extra run, not two.
      expect(cleanupTempUploads).toHaveBeenCalledTimes(2);

      job.stopSchedule();
    });

    it('stopSchedule clears the interval so no further runs occur', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 22, 1, 0, 0));
      const job = new StorageCleanupJob();

      job.startSchedule(24);
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000); // first run + interval set
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);

      job.stopSchedule();
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
      // No additional runs after stop.
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);
    });

    it('stopSchedule is a safe no-op when no schedule is active', () => {
      const job = new StorageCleanupJob();
      expect(() => job.stopSchedule()).not.toThrow();
    });

    it('swallows scheduled-run failures without throwing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 22, 1, 0, 0));
      cleanupTempUploads.mockRejectedValue(new Error('scheduled boom'));
      const job = new StorageCleanupJob();

      job.startSchedule(24);
      // The scheduled run rejects internally; the .catch handler must swallow
      // it so advancing the timers resolves cleanly rather than rejecting.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(cleanupTempUploads).toHaveBeenCalledTimes(1);

      job.stopSchedule();
    });
  });

  // -------------------------------------------------------------------------
  // formatBytes (exercised indirectly via the success log path)
  // -------------------------------------------------------------------------
  describe('byte formatting (via runCleanup logging)', () => {
    it('logs human-readable sizes including the 0 B case', async () => {
      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      const job = new StorageCleanupJob();

      cleanupTempUploads.mockResolvedValue(makeResult({ deletedCount: 0, deletedSize: 0 }));
      await job.runCleanup();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('0 B'));

      logSpy.mockClear();
      cleanupTempUploads.mockResolvedValue(makeResult({ deletedCount: 1, deletedSize: 1536 }));
      await job.runCleanup();
      // 1536 bytes = 1.5 KB
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1.5 KB'));
    });
  });

  // -------------------------------------------------------------------------
  // Singleton export
  // -------------------------------------------------------------------------
  describe('storageCleanupJob singleton', () => {
    it('is a StorageCleanupJob instance', () => {
      expect(storageCleanupJob).toBeInstanceOf(StorageCleanupJob);
    });
  });
});
