/**
 * @file RetentionCleanupJob.test.ts
 * @description Unit tests for the RetentionCleanupJob — the background job that
 *   deletes compliance logs past their retention period while respecting legal
 *   holds. All I/O boundaries (prisma, legalHoldService, the dynamically
 *   imported complianceLogService) are mocked; the job's branching/aggregation
 *   logic runs for real. Timers are faked so the scheduling tests terminate.
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the external boundaries before importing the job under test.
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    complianceLog: {
      findMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../services/LegalHoldService.js', () => ({
  legalHoldService: {
    getLogsUnderHold: vi.fn(),
  },
}));

// The job dynamically imports ComplianceLogService inside logCleanupActivity.
vi.mock('../../services/ComplianceLogService.js', () => ({
  complianceLogService: {
    logSystemEvent: vi.fn(),
  },
}));

import { prisma as _prisma } from '../../database/index.js';
import { legalHoldService as _legalHoldService } from '../../services/LegalHoldService.js';
import { complianceLogService as _complianceLogService } from '../../services/ComplianceLogService.js';
import { RetentionCleanupJob, retentionCleanupJob } from '../RetentionCleanupJob.js';

const prisma = vi.mocked(_prisma, true);
const legalHoldService = vi.mocked(_legalHoldService, true);
const complianceLogService = vi.mocked(_complianceLogService, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ExpiredLogRow {
  id: string;
  legalHoldId: string | null;
  eventType: string;
}

function makeLog(overrides: Partial<ExpiredLogRow> = {}): ExpiredLogRow {
  return {
    id: 'log-1',
    legalHoldId: null,
    eventType: 'system_event',
    ...overrides,
  };
}

let job: RetentionCleanupJob;

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so the dynamic import path doesn't throw.
  legalHoldService.getLogsUnderHold.mockResolvedValue([]);
  complianceLogService.logSystemEvent.mockResolvedValue({} as never);
  job = new RetentionCleanupJob();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// runCleanup — happy path
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob.runCleanup', () => {
  it('queries only expired, immutable logs with the expected selection', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([] as never);

    await job.runCleanup();

    expect(prisma.complianceLog.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.complianceLog.findMany.mock.calls[0][0];
    expect(arg?.where).toMatchObject({
      retentionExpiresAt: { lt: expect.any(Date) },
      immutable: true,
    });
    expect(arg?.select).toEqual({ id: true, legalHoldId: true, eventType: true });
  });

  it('deletes every expired log not under hold and reports the counts', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([
      makeLog({ id: 'a' }),
      makeLog({ id: 'b' }),
    ] as never);
    prisma.complianceLog.delete.mockResolvedValue({} as never);

    const result = await job.runCleanup();

    expect(prisma.complianceLog.delete).toHaveBeenCalledTimes(2);
    expect(prisma.complianceLog.delete).toHaveBeenCalledWith({ where: { id: 'a' } });
    expect(prisma.complianceLog.delete).toHaveBeenCalledWith({ where: { id: 'b' } });
    expect(result.logsScanned).toBe(2);
    expect(result.logsDeleted).toBe(2);
    expect(result.logsSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('returns a no-op result without querying when nothing has expired', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([] as never);

    const result = await job.runCleanup();

    expect(prisma.complianceLog.delete).not.toHaveBeenCalled();
    expect(result.logsScanned).toBe(0);
    expect(result.logsDeleted).toBe(0);
    // No logs processed -> no cleanup activity logged.
    expect(complianceLogService.logSystemEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runCleanup — legal hold handling
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob.runCleanup legal holds', () => {
  it('skips logs that carry a legalHoldId', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([
      makeLog({ id: 'held', legalHoldId: 'hold-1' }),
      makeLog({ id: 'free' }),
    ] as never);
    prisma.complianceLog.delete.mockResolvedValue({} as never);

    const result = await job.runCleanup();

    expect(prisma.complianceLog.delete).toHaveBeenCalledTimes(1);
    expect(prisma.complianceLog.delete).toHaveBeenCalledWith({ where: { id: 'free' } });
    expect(result.logsDeleted).toBe(1);
    expect(result.logsSkipped).toBe(1);
  });

  it('skips logs returned by legalHoldService.getLogsUnderHold even without a legalHoldId', async () => {
    legalHoldService.getLogsUnderHold.mockResolvedValue(['under-hold']);
    prisma.complianceLog.findMany.mockResolvedValue([
      makeLog({ id: 'under-hold' }),
      makeLog({ id: 'free' }),
    ] as never);
    prisma.complianceLog.delete.mockResolvedValue({} as never);

    const result = await job.runCleanup();

    expect(prisma.complianceLog.delete).toHaveBeenCalledTimes(1);
    expect(prisma.complianceLog.delete).toHaveBeenCalledWith({ where: { id: 'free' } });
    expect(result.logsSkipped).toBe(1);
    expect(result.logsDeleted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runCleanup — error handling per-log
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob.runCleanup errors', () => {
  it('records a delete failure and continues with the remaining logs', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([
      makeLog({ id: 'boom' }),
      makeLog({ id: 'ok' }),
    ] as never);
    prisma.complianceLog.delete
      .mockRejectedValueOnce(new Error('FK constraint'))
      .mockResolvedValueOnce({} as never);

    const result = await job.runCleanup();

    expect(result.logsDeleted).toBe(1);
    expect(result.errors).toEqual([{ logId: 'boom', error: 'FK constraint' }]);
  });

  it('captures a non-Error rejection as "Unknown error"', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([makeLog({ id: 'weird' })] as never);
    prisma.complianceLog.delete.mockRejectedValue('string failure' as never);

    const result = await job.runCleanup();

    expect(result.logsDeleted).toBe(0);
    expect(result.errors).toEqual([{ logId: 'weird', error: 'Unknown error' }]);
  });
});

// ---------------------------------------------------------------------------
// runCleanup — cleanup activity logging (dynamic import boundary)
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob.runCleanup activity logging', () => {
  it('logs a system event with info severity when there are no errors', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([makeLog({ id: 'a' })] as never);
    prisma.complianceLog.delete.mockResolvedValue({} as never);

    await job.runCleanup();

    expect(complianceLogService.logSystemEvent).toHaveBeenCalledTimes(1);
    const arg = complianceLogService.logSystemEvent.mock.calls[0][0];
    expect(arg.sessionId).toBe('system-retention-cleanup');
    expect(arg.robotId).toBe('system');
    expect(arg.severity).toBe('info');
    expect(arg.payload.eventName).toBe('retention_cleanup');
    expect(arg.payload.metadata).toMatchObject({
      logsScanned: 1,
      logsDeleted: 1,
      logsSkipped: 0,
      errorCount: 0,
    });
    expect(typeof (arg.payload.metadata as { duration: number }).duration).toBe('number');
  });

  it('logs with warning severity when there were delete errors', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([makeLog({ id: 'a' })] as never);
    prisma.complianceLog.delete.mockRejectedValue(new Error('nope') as never);

    await job.runCleanup();

    const arg = complianceLogService.logSystemEvent.mock.calls[0][0];
    expect(arg.severity).toBe('warning');
    expect((arg.payload.metadata as { errorCount: number }).errorCount).toBe(1);
  });

  it('does not throw when activity logging itself fails', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([makeLog({ id: 'a' })] as never);
    prisma.complianceLog.delete.mockResolvedValue({} as never);
    complianceLogService.logSystemEvent.mockRejectedValue(new Error('log down') as never);

    const result = await job.runCleanup();

    // Result is still returned despite the logging failure.
    expect(result.logsDeleted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runCleanup — re-entrancy guard
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob.runCleanup re-entrancy', () => {
  it('skips when a cleanup is already in progress', async () => {
    let release!: () => void;
    prisma.complianceLog.findMany.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([] as never);
      }) as never,
    );

    const first = job.runCleanup();
    // Second call while the first is mid-flight -> guarded no-op.
    const second = await job.runCleanup();

    expect(second.logsScanned).toBe(0);
    expect(second.logsDeleted).toBe(0);
    expect(prisma.complianceLog.findMany).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('resets the running flag so a later run executes normally', async () => {
    prisma.complianceLog.findMany.mockResolvedValue([] as never);

    await job.runCleanup();
    await job.runCleanup();

    expect(prisma.complianceLog.findMany).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getRetentionStats
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob.getRetentionStats', () => {
  it('aggregates the five counts into the stats shape', async () => {
    prisma.complianceLog.count
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(10) // expiring 30
      .mockResolvedValueOnce(25) // expiring 90
      .mockResolvedValueOnce(3) // under hold
      .mockResolvedValueOnce(7); // no expiry

    const stats = await job.getRetentionStats();

    expect(stats).toEqual({
      totalLogs: 100,
      expiringWithin30Days: 10,
      expiringWithin90Days: 25,
      underLegalHold: 3,
      withoutExpiry: 7,
    });
    expect(prisma.complianceLog.count).toHaveBeenCalledTimes(5);
  });

  it('builds the expected where clauses for each scoped count', async () => {
    prisma.complianceLog.count.mockResolvedValue(0);

    await job.getRetentionStats();

    const calls = prisma.complianceLog.count.mock.calls;
    // First call is the unscoped total.
    expect(calls[0][0]).toBeUndefined();
    // 30-day window.
    expect(calls[1][0]?.where).toMatchObject({
      retentionExpiresAt: { lte: expect.any(Date), gt: expect.any(Date) },
    });
    // 90-day window.
    expect(calls[2][0]?.where).toMatchObject({
      retentionExpiresAt: { lte: expect.any(Date), gt: expect.any(Date) },
    });
    // Legal hold.
    expect(calls[3][0]?.where).toEqual({ legalHoldId: { not: null } });
    // No expiry.
    expect(calls[4][0]?.where).toEqual({ retentionExpiresAt: null });
  });
});

// ---------------------------------------------------------------------------
// startSchedule / stopSchedule (timer boundary)
// ---------------------------------------------------------------------------

describe('RetentionCleanupJob scheduling', () => {
  it('runs the first cleanup after the initial delay then on each interval', async () => {
    vi.useFakeTimers();
    // Fix "now" to a deterministic point well before 2 AM the next reckoning.
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
    prisma.complianceLog.findMany.mockResolvedValue([] as never);

    const spy = vi.spyOn(job, 'runCleanup');
    job.startSchedule(24);

    // Nothing has fired yet.
    expect(spy).not.toHaveBeenCalled();

    // Advance past the initial setTimeout (initial delay is < 26h).
    await vi.advanceTimersByTimeAsync(26 * 60 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(1);

    // Advance one full interval -> recurring run.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(2);

    job.stopSchedule();
  });

  it('does not start a second schedule if one is already running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
    prisma.complianceLog.findMany.mockResolvedValue([] as never);

    const spy = vi.spyOn(job, 'runCleanup');

    // Fire the first schedule's setTimeout so intervalId is set.
    job.startSchedule(24);
    await vi.advanceTimersByTimeAsync(26 * 60 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(1);

    // A second startSchedule should be a guarded no-op (interval already set).
    job.startSchedule(24);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    // Only the single existing interval fires -> exactly one more run.
    expect(spy).toHaveBeenCalledTimes(2);

    job.stopSchedule();
  });

  it('stopSchedule clears the interval so no further runs occur', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
    prisma.complianceLog.findMany.mockResolvedValue([] as never);

    const spy = vi.spyOn(job, 'runCleanup');
    job.startSchedule(24);
    await vi.advanceTimersByTimeAsync(26 * 60 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(1);

    job.stopSchedule();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    // No additional runs after stopping.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stopSchedule is a harmless no-op when nothing is scheduled', () => {
    expect(() => job.stopSchedule()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('retentionCleanupJob singleton', () => {
  it('is a RetentionCleanupJob instance', () => {
    expect(retentionCleanupJob).toBeInstanceOf(RetentionCleanupJob);
  });
});
