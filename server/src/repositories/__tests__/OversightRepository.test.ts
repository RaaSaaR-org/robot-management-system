/**
 * @file OversightRepository.test.ts
 * @description Unit tests for the OversightRepository classes (ManualControlSession, VerificationSchedule, VerificationCompletion, OversightLog, AnomalyRecord) — Prisma-backed data access with real db<->domain mapping
 * @feature oversight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma singleton (the I/O boundary).
// The repo imports { prisma } from '../../database/index.js'.
// The local mapper functions in OversightRepository.ts run for REAL.
// ---------------------------------------------------------------------------

type Fn = ReturnType<typeof vi.fn>;

const { mockPrisma } = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  });
  return {
    mockPrisma: {
      manualControlSession: model(),
      verificationSchedule: model(),
      verificationCompletion: model(),
      oversightLog: model(),
      anomalyRecord: model(),
    } as Record<
      | 'manualControlSession'
      | 'verificationSchedule'
      | 'verificationCompletion'
      | 'oversightLog'
      | 'anomalyRecord',
      {
        findUnique: Fn;
        findFirst: Fn;
        findMany: Fn;
        create: Fn;
        update: Fn;
        updateMany: Fn;
        delete: Fn;
        count: Fn;
        groupBy: Fn;
      }
    >,
  };
});

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import {
  ManualControlSessionRepository,
  VerificationScheduleRepository,
  VerificationCompletionRepository,
  OversightLogRepository,
  AnomalyRecordRepository,
  manualControlSessionRepository,
  verificationScheduleRepository,
  verificationCompletionRepository,
  oversightLogRepository,
  anomalyRecordRepository,
} from '../OversightRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — db-row shapes accepted by the real mappers.
// ---------------------------------------------------------------------------

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ses-1',
    robotId: 'robot-1',
    operatorId: 'op-1',
    reason: 'manual takeover',
    startedAt: new Date('2026-01-01T10:00:00Z'),
    endedAt: null,
    isActive: true,
    speedLimitMmPerSec: 250,
    forceLimitN: 140,
    ...overrides,
  };
}

function makeScheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch-1',
    name: 'Hourly Safety',
    description: 'check',
    intervalMinutes: 60,
    robotScope: 'all',
    scopeId: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    completions: [],
    ...overrides,
  };
}

function makeCompletionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmp-1',
    scheduleId: 'sch-1',
    operatorId: 'op-1',
    robotId: 'robot-1',
    status: 'completed',
    notes: 'ok',
    completedAt: new Date('2026-01-01T11:00:00Z'),
    ...overrides,
  };
}

function makeLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    actionType: 'manual_mode_activated',
    operatorId: 'op-1',
    robotId: 'robot-1',
    taskId: null,
    decisionId: null,
    reason: 'test',
    details: JSON.stringify({ foo: 'bar' }),
    timestamp: new Date('2026-01-01T12:00:00Z'),
    ...overrides,
  };
}

function makeAnomalyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ano-1',
    robotId: 'robot-1',
    anomalyType: 'confidence_drop',
    severity: 'high',
    description: 'low confidence',
    detectedAt: new Date('2026-01-01T09:00:00Z'),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolution: null,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// ManualControlSessionRepository
// ===========================================================================

describe('ManualControlSessionRepository', () => {
  const repo = new ManualControlSessionRepository();

  it('exports a singleton instance', () => {
    expect(manualControlSessionRepository).toBeInstanceOf(ManualControlSessionRepository);
  });

  describe('findById', () => {
    it('returns mapped session when found', async () => {
      mockPrisma.manualControlSession.findUnique.mockResolvedValue(makeSessionRow());
      const result = await repo.findById('ses-1');
      expect(mockPrisma.manualControlSession.findUnique).toHaveBeenCalledWith({
        where: { id: 'ses-1' },
      });
      expect(result).toEqual({
        id: 'ses-1',
        robotId: 'robot-1',
        operatorId: 'op-1',
        reason: 'manual takeover',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: null,
        isActive: true,
        speedLimitMmPerSec: 250,
        forceLimitN: 140,
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.manualControlSession.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findActiveByRobotId', () => {
    it('queries active session ordered by startedAt desc', async () => {
      mockPrisma.manualControlSession.findFirst.mockResolvedValue(makeSessionRow());
      const result = await repo.findActiveByRobotId('robot-1');
      expect(mockPrisma.manualControlSession.findFirst).toHaveBeenCalledWith({
        where: { robotId: 'robot-1', isActive: true },
        orderBy: { startedAt: 'desc' },
      });
      expect(result?.id).toBe('ses-1');
    });

    it('returns null when none active', async () => {
      mockPrisma.manualControlSession.findFirst.mockResolvedValue(null);
      expect(await repo.findActiveByRobotId('robot-1')).toBeNull();
    });
  });

  describe('findAllActive', () => {
    it('returns mapped list of active sessions', async () => {
      mockPrisma.manualControlSession.findMany.mockResolvedValue([
        makeSessionRow(),
        makeSessionRow({ id: 'ses-2' }),
      ]);
      const result = await repo.findAllActive();
      expect(mockPrisma.manualControlSession.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { startedAt: 'desc' },
      });
      expect(result.map((s) => s.id)).toEqual(['ses-1', 'ses-2']);
    });

    it('returns empty array when none', async () => {
      mockPrisma.manualControlSession.findMany.mockResolvedValue([]);
      expect(await repo.findAllActive()).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('builds empty where when no params', async () => {
      mockPrisma.manualControlSession.findMany.mockResolvedValue([]);
      await repo.findAll();
      expect(mockPrisma.manualControlSession.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { startedAt: 'desc' },
      });
    });

    it('builds where with all filters including date range', async () => {
      mockPrisma.manualControlSession.findMany.mockResolvedValue([makeSessionRow()]);
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-02T00:00:00Z');
      await repo.findAll({
        robotId: 'robot-1',
        operatorId: 'op-1',
        isActive: false,
        startDate: start,
        endDate: end,
      });
      expect(mockPrisma.manualControlSession.findMany).toHaveBeenCalledWith({
        where: {
          robotId: 'robot-1',
          operatorId: 'op-1',
          isActive: false,
          startedAt: { gte: start, lte: end },
        },
        orderBy: { startedAt: 'desc' },
      });
    });
  });

  describe('create', () => {
    it('ends existing active sessions then creates reduced-speed session by default', async () => {
      mockPrisma.manualControlSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.manualControlSession.create.mockResolvedValue(makeSessionRow());
      await repo.create({ robotId: 'robot-1', operatorId: 'op-1', reason: 'r' });

      expect(mockPrisma.manualControlSession.updateMany).toHaveBeenCalledWith({
        where: { robotId: 'robot-1', isActive: true },
        data: { isActive: false, endedAt: expect.any(Date) },
      });
      expect(mockPrisma.manualControlSession.create).toHaveBeenCalledWith({
        data: {
          robotId: 'robot-1',
          operatorId: 'op-1',
          reason: 'r',
          speedLimitMmPerSec: 250,
          forceLimitN: 140,
          isActive: true,
        },
      });
    });

    it('uses 1000 mm/s speed limit for full_speed mode', async () => {
      mockPrisma.manualControlSession.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.manualControlSession.create.mockResolvedValue(
        makeSessionRow({ speedLimitMmPerSec: 1000 })
      );
      const result = await repo.create({
        robotId: 'robot-1',
        operatorId: 'op-1',
        reason: 'r',
        mode: 'full_speed',
      });
      expect(mockPrisma.manualControlSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ speedLimitMmPerSec: 1000 }) })
      );
      expect(result.speedLimitMmPerSec).toBe(1000);
    });
  });

  describe('end', () => {
    it('updates session to inactive and returns mapped result', async () => {
      mockPrisma.manualControlSession.update.mockResolvedValue(
        makeSessionRow({ isActive: false, endedAt: new Date('2026-01-01T13:00:00Z') })
      );
      const result = await repo.end('ses-1');
      expect(mockPrisma.manualControlSession.update).toHaveBeenCalledWith({
        where: { id: 'ses-1' },
        data: { isActive: false, endedAt: expect.any(Date) },
      });
      expect(result?.isActive).toBe(false);
    });

    it('returns null when update throws', async () => {
      mockPrisma.manualControlSession.update.mockRejectedValue(new Error('not found'));
      expect(await repo.end('missing')).toBeNull();
    });
  });

  describe('endByRobotId', () => {
    it('returns the count of ended sessions', async () => {
      mockPrisma.manualControlSession.updateMany.mockResolvedValue({ count: 3 });
      const result = await repo.endByRobotId('robot-1');
      expect(mockPrisma.manualControlSession.updateMany).toHaveBeenCalledWith({
        where: { robotId: 'robot-1', isActive: true },
        data: { isActive: false, endedAt: expect.any(Date) },
      });
      expect(result).toBe(3);
    });
  });

  describe('countActive', () => {
    it('counts active sessions', async () => {
      mockPrisma.manualControlSession.count.mockResolvedValue(5);
      const result = await repo.countActive();
      expect(mockPrisma.manualControlSession.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
      expect(result).toBe(5);
    });
  });

  describe('countToday', () => {
    it('counts sessions started since midnight', async () => {
      mockPrisma.manualControlSession.count.mockResolvedValue(2);
      const result = await repo.countToday();
      expect(result).toBe(2);
      const arg = mockPrisma.manualControlSession.count.mock.calls[0][0];
      expect(arg.where.startedAt.gte).toBeInstanceOf(Date);
      expect((arg.where.startedAt.gte as Date).getHours()).toBe(0);
    });
  });
});

// ===========================================================================
// VerificationScheduleRepository
// ===========================================================================

describe('VerificationScheduleRepository', () => {
  const repo = new VerificationScheduleRepository();

  it('exports a singleton instance', () => {
    expect(verificationScheduleRepository).toBeInstanceOf(VerificationScheduleRepository);
  });

  describe('findById', () => {
    it('includes latest completion and maps nextDueAt from it', async () => {
      const completedAt = new Date('2026-01-01T11:00:00Z');
      mockPrisma.verificationSchedule.findUnique.mockResolvedValue(
        makeScheduleRow({ completions: [makeCompletionRow({ completedAt })] })
      );
      const result = await repo.findById('sch-1');
      expect(mockPrisma.verificationSchedule.findUnique).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        include: { completions: { orderBy: { completedAt: 'desc' }, take: 1 } },
      });
      expect(result?.lastCompletedAt).toEqual(completedAt);
      // nextDueAt = completedAt + 60min
      expect(result?.nextDueAt).toEqual(new Date(completedAt.getTime() + 60 * 60 * 1000));
    });

    it('marks never-completed schedule as due now with null lastCompletedAt', async () => {
      // When there are no completions the mapper sets nextDueAt = new Date() (now)
      // and isOverdue = nextDueAt < new Date(). The two Date() calls can land in the
      // same millisecond, so isOverdue is non-deterministic (true OR false) — we only
      // assert nextDueAt is ~now and lastCompletedAt is null. See bugsFound.
      const before = Date.now();
      mockPrisma.verificationSchedule.findUnique.mockResolvedValue(makeScheduleRow({ completions: [] }));
      const result = await repo.findById('sch-1');
      const after = Date.now();
      expect(result?.lastCompletedAt).toBeNull();
      expect(result?.nextDueAt).toBeInstanceOf(Date);
      const due = (result?.nextDueAt as Date).getTime();
      expect(due).toBeGreaterThanOrEqual(before);
      expect(due).toBeLessThanOrEqual(after);
      expect(typeof result?.isOverdue).toBe('boolean');
    });

    it('returns null when not found', async () => {
      mockPrisma.verificationSchedule.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findAll', () => {
    it('builds where with filters and orders by name asc', async () => {
      mockPrisma.verificationSchedule.findMany.mockResolvedValue([makeScheduleRow()]);
      await repo.findAll({ isActive: true, robotScope: 'zone', scopeId: 'zone-1' });
      expect(mockPrisma.verificationSchedule.findMany).toHaveBeenCalledWith({
        where: { isActive: true, robotScope: 'zone', scopeId: 'zone-1' },
        orderBy: { name: 'asc' },
        include: { completions: { orderBy: { completedAt: 'desc' }, take: 1 } },
      });
    });

    it('builds empty where with no params', async () => {
      mockPrisma.verificationSchedule.findMany.mockResolvedValue([]);
      await repo.findAll();
      expect(mockPrisma.verificationSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
    });
  });

  describe('findDue', () => {
    it('returns only overdue active schedules', async () => {
      const oldCompletion = makeCompletionRow({
        completedAt: new Date('2020-01-01T00:00:00Z'),
      });
      const futureCompletion = makeCompletionRow({
        completedAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in future, interval 60 -> due in 2h
      });
      mockPrisma.verificationSchedule.findMany.mockResolvedValue([
        makeScheduleRow({ id: 'overdue', completions: [oldCompletion] }),
        makeScheduleRow({ id: 'not-due', completions: [futureCompletion] }),
      ]);
      const result = await repo.findDue();
      expect(mockPrisma.verificationSchedule.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        include: { completions: { orderBy: { completedAt: 'desc' }, take: 1 } },
      });
      expect(result.map((s) => s.id)).toEqual(['overdue']);
    });
  });

  describe('create', () => {
    it('creates with defaults (robotScope=all) and maps result', async () => {
      mockPrisma.verificationSchedule.create.mockResolvedValue(makeScheduleRow());
      await repo.create({ name: 'Hourly Safety', intervalMinutes: 60 });
      expect(mockPrisma.verificationSchedule.create).toHaveBeenCalledWith({
        data: {
          name: 'Hourly Safety',
          description: undefined,
          intervalMinutes: 60,
          robotScope: 'all',
          scopeId: undefined,
          isActive: true,
        },
        include: { completions: { orderBy: { completedAt: 'desc' }, take: 1 } },
      });
    });
  });

  describe('update', () => {
    it('updates fields and returns mapped result', async () => {
      mockPrisma.verificationSchedule.update.mockResolvedValue(
        makeScheduleRow({ name: 'Renamed' })
      );
      const result = await repo.update('sch-1', { name: 'Renamed' });
      expect(mockPrisma.verificationSchedule.update).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        data: {
          name: 'Renamed',
          description: undefined,
          intervalMinutes: undefined,
          robotScope: undefined,
          scopeId: undefined,
        },
        include: { completions: { orderBy: { completedAt: 'desc' }, take: 1 } },
      });
      expect(result?.name).toBe('Renamed');
    });

    it('returns null when update throws', async () => {
      mockPrisma.verificationSchedule.update.mockRejectedValue(new Error('not found'));
      expect(await repo.update('missing', { name: 'x' })).toBeNull();
    });
  });

  describe('deactivate', () => {
    it('sets isActive=false and maps result', async () => {
      mockPrisma.verificationSchedule.update.mockResolvedValue(
        makeScheduleRow({ isActive: false })
      );
      const result = await repo.deactivate('sch-1');
      expect(mockPrisma.verificationSchedule.update).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
        data: { isActive: false },
        include: { completions: { orderBy: { completedAt: 'desc' }, take: 1 } },
      });
      expect(result?.isActive).toBe(false);
    });

    it('returns null when update throws', async () => {
      mockPrisma.verificationSchedule.update.mockRejectedValue(new Error('boom'));
      expect(await repo.deactivate('missing')).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true on success', async () => {
      mockPrisma.verificationSchedule.delete.mockResolvedValue(makeScheduleRow());
      expect(await repo.delete('sch-1')).toBe(true);
      expect(mockPrisma.verificationSchedule.delete).toHaveBeenCalledWith({
        where: { id: 'sch-1' },
      });
    });

    it('returns false when delete throws', async () => {
      mockPrisma.verificationSchedule.delete.mockRejectedValue(new Error('not found'));
      expect(await repo.delete('missing')).toBe(false);
    });
  });

  describe('countActive', () => {
    it('counts active schedules', async () => {
      mockPrisma.verificationSchedule.count.mockResolvedValue(4);
      expect(await repo.countActive()).toBe(4);
      expect(mockPrisma.verificationSchedule.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });
  });
});

// ===========================================================================
// VerificationCompletionRepository
// ===========================================================================

describe('VerificationCompletionRepository', () => {
  const repo = new VerificationCompletionRepository();

  it('exports a singleton instance', () => {
    expect(verificationCompletionRepository).toBeInstanceOf(VerificationCompletionRepository);
  });

  describe('findById', () => {
    it('returns mapped completion', async () => {
      mockPrisma.verificationCompletion.findUnique.mockResolvedValue(makeCompletionRow());
      const result = await repo.findById('cmp-1');
      expect(mockPrisma.verificationCompletion.findUnique).toHaveBeenCalledWith({
        where: { id: 'cmp-1' },
      });
      expect(result).toEqual({
        id: 'cmp-1',
        scheduleId: 'sch-1',
        operatorId: 'op-1',
        robotId: 'robot-1',
        status: 'completed',
        notes: 'ok',
        completedAt: new Date('2026-01-01T11:00:00Z'),
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.verificationCompletion.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByScheduleId', () => {
    it('queries with default limit 10', async () => {
      mockPrisma.verificationCompletion.findMany.mockResolvedValue([makeCompletionRow()]);
      await repo.findByScheduleId('sch-1');
      expect(mockPrisma.verificationCompletion.findMany).toHaveBeenCalledWith({
        where: { scheduleId: 'sch-1' },
        orderBy: { completedAt: 'desc' },
        take: 10,
      });
    });

    it('respects custom limit', async () => {
      mockPrisma.verificationCompletion.findMany.mockResolvedValue([]);
      await repo.findByScheduleId('sch-1', 3);
      expect(mockPrisma.verificationCompletion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      );
    });
  });

  describe('create', () => {
    it('creates and maps the completion', async () => {
      mockPrisma.verificationCompletion.create.mockResolvedValue(makeCompletionRow());
      await repo.create({
        scheduleId: 'sch-1',
        operatorId: 'op-1',
        robotId: 'robot-1',
        status: 'completed',
        notes: 'ok',
      });
      expect(mockPrisma.verificationCompletion.create).toHaveBeenCalledWith({
        data: {
          scheduleId: 'sch-1',
          operatorId: 'op-1',
          robotId: 'robot-1',
          status: 'completed',
          notes: 'ok',
        },
      });
    });
  });

  describe('countToday', () => {
    it('counts completions since midnight', async () => {
      mockPrisma.verificationCompletion.count.mockResolvedValue(7);
      const result = await repo.countToday();
      expect(result).toBe(7);
      const arg = mockPrisma.verificationCompletion.count.mock.calls[0][0];
      expect((arg.where.completedAt.gte as Date).getHours()).toBe(0);
    });
  });

  describe('getComplianceRate', () => {
    it('returns rounded percentage of completed vs total', async () => {
      mockPrisma.verificationCompletion.count
        .mockResolvedValueOnce(3) // completed
        .mockResolvedValueOnce(4); // total
      const result = await repo.getComplianceRate();
      expect(result).toBe(75);
    });

    it('returns 100 when no completions in period', async () => {
      mockPrisma.verificationCompletion.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      expect(await repo.getComplianceRate(7)).toBe(100);
    });
  });
});

// ===========================================================================
// OversightLogRepository
// ===========================================================================

describe('OversightLogRepository', () => {
  const repo = new OversightLogRepository();

  it('exports a singleton instance', () => {
    expect(oversightLogRepository).toBeInstanceOf(OversightLogRepository);
  });

  describe('findById', () => {
    it('returns mapped log with parsed details JSON', async () => {
      mockPrisma.oversightLog.findUnique.mockResolvedValue(makeLogRow());
      const result = await repo.findById('log-1');
      expect(mockPrisma.oversightLog.findUnique).toHaveBeenCalledWith({ where: { id: 'log-1' } });
      expect(result?.details).toEqual({ foo: 'bar' });
    });

    it('returns null when not found', async () => {
      mockPrisma.oversightLog.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findAll', () => {
    it('paginates with defaults and returns list response', async () => {
      mockPrisma.oversightLog.findMany.mockResolvedValue([makeLogRow()]);
      mockPrisma.oversightLog.count.mockResolvedValue(1);
      const result = await repo.findAll();
      expect(mockPrisma.oversightLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'desc' },
        skip: 0,
        take: 50,
      });
      expect(result).toMatchObject({ total: 1, page: 1, limit: 50, totalPages: 1 });
      expect(result.logs[0].details).toEqual({ foo: 'bar' });
    });

    it('builds where with array actionType (in), filters, date range and pagination', async () => {
      mockPrisma.oversightLog.findMany.mockResolvedValue([]);
      mockPrisma.oversightLog.count.mockResolvedValue(0);
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-02T00:00:00Z');
      const result = await repo.findAll({
        actionType: ['robot_stopped', 'fleet_stopped'],
        operatorId: 'op-1',
        robotId: 'robot-1',
        startDate: start,
        endDate: end,
        page: 2,
        limit: 10,
      });
      expect(mockPrisma.oversightLog.findMany).toHaveBeenCalledWith({
        where: {
          actionType: { in: ['robot_stopped', 'fleet_stopped'] },
          operatorId: 'op-1',
          robotId: 'robot-1',
          timestamp: { gte: start, lte: end },
        },
        orderBy: { timestamp: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(result.totalPages).toBe(0);
    });

    it('uses scalar actionType when not an array', async () => {
      mockPrisma.oversightLog.findMany.mockResolvedValue([]);
      mockPrisma.oversightLog.count.mockResolvedValue(0);
      await repo.findAll({ actionType: 'robot_stopped' });
      expect(mockPrisma.oversightLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { actionType: 'robot_stopped' } })
      );
    });
  });

  describe('findRecent', () => {
    it('returns recent logs with default limit 10', async () => {
      mockPrisma.oversightLog.findMany.mockResolvedValue([makeLogRow()]);
      await repo.findRecent();
      expect(mockPrisma.oversightLog.findMany).toHaveBeenCalledWith({
        orderBy: { timestamp: 'desc' },
        take: 10,
      });
    });
  });

  describe('create', () => {
    it('stringifies details and maps result', async () => {
      mockPrisma.oversightLog.create.mockResolvedValue(makeLogRow());
      await repo.create({
        actionType: 'manual_mode_activated',
        operatorId: 'op-1',
        robotId: 'robot-1',
        reason: 'test',
        details: { foo: 'bar' },
      });
      expect(mockPrisma.oversightLog.create).toHaveBeenCalledWith({
        data: {
          actionType: 'manual_mode_activated',
          operatorId: 'op-1',
          robotId: 'robot-1',
          taskId: undefined,
          decisionId: undefined,
          reason: 'test',
          details: JSON.stringify({ foo: 'bar' }),
        },
      });
    });

    it('defaults details to empty object string when omitted', async () => {
      mockPrisma.oversightLog.create.mockResolvedValue(makeLogRow({ details: '{}' }));
      const result = await repo.create({
        actionType: 'robot_stopped',
        operatorId: 'op-1',
        reason: 'stop',
      });
      expect(mockPrisma.oversightLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ details: '{}' }) })
      );
      expect(result.details).toEqual({});
    });
  });
});

// ===========================================================================
// AnomalyRecordRepository
// ===========================================================================

describe('AnomalyRecordRepository', () => {
  const repo = new AnomalyRecordRepository();

  it('exports a singleton instance', () => {
    expect(anomalyRecordRepository).toBeInstanceOf(AnomalyRecordRepository);
  });

  describe('findById', () => {
    it('returns mapped anomaly', async () => {
      mockPrisma.anomalyRecord.findUnique.mockResolvedValue(makeAnomalyRow());
      const result = await repo.findById('ano-1');
      expect(mockPrisma.anomalyRecord.findUnique).toHaveBeenCalledWith({ where: { id: 'ano-1' } });
      expect(result?.anomalyType).toBe('confidence_drop');
      expect(result?.severity).toBe('high');
    });

    it('returns null when not found', async () => {
      mockPrisma.anomalyRecord.findUnique.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findActiveByRobotId', () => {
    it('queries active anomalies and re-sorts by severity priority', async () => {
      mockPrisma.anomalyRecord.findMany.mockResolvedValue([
        makeAnomalyRow({ id: 'a-low', severity: 'low' }),
        makeAnomalyRow({ id: 'a-crit', severity: 'critical' }),
        makeAnomalyRow({ id: 'a-med', severity: 'medium' }),
      ]);
      const result = await repo.findActiveByRobotId('robot-1');
      expect(mockPrisma.anomalyRecord.findMany).toHaveBeenCalledWith({
        where: { robotId: 'robot-1', isActive: true },
        orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
      });
      expect(result.map((a) => a.id)).toEqual(['a-crit', 'a-med', 'a-low']);
    });
  });

  describe('findAllActive', () => {
    it('queries all active and sorts by severity priority', async () => {
      mockPrisma.anomalyRecord.findMany.mockResolvedValue([
        makeAnomalyRow({ id: 'a-high', severity: 'high' }),
        makeAnomalyRow({ id: 'a-crit', severity: 'critical' }),
      ]);
      const result = await repo.findAllActive();
      expect(mockPrisma.anomalyRecord.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
      });
      expect(result.map((a) => a.id)).toEqual(['a-crit', 'a-high']);
    });
  });

  describe('findAll', () => {
    it('paginates with defaults and returns response', async () => {
      mockPrisma.anomalyRecord.findMany.mockResolvedValue([makeAnomalyRow()]);
      mockPrisma.anomalyRecord.count.mockResolvedValue(1);
      const result = await repo.findAll();
      expect(mockPrisma.anomalyRecord.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ isActive: 'desc' }, { severity: 'asc' }, { detectedAt: 'desc' }],
        skip: 0,
        take: 50,
      });
      expect(result).toMatchObject({ total: 1, page: 1, limit: 50, totalPages: 1 });
    });

    it('builds where with array filters, scalar fallback, date range and pagination', async () => {
      mockPrisma.anomalyRecord.findMany.mockResolvedValue([]);
      mockPrisma.anomalyRecord.count.mockResolvedValue(0);
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-02T00:00:00Z');
      await repo.findAll({
        robotId: 'robot-1',
        isActive: true,
        anomalyType: ['confidence_drop', 'safety_warning'],
        severity: 'high',
        startDate: start,
        endDate: end,
        page: 3,
        limit: 20,
      });
      expect(mockPrisma.anomalyRecord.findMany).toHaveBeenCalledWith({
        where: {
          robotId: 'robot-1',
          isActive: true,
          anomalyType: { in: ['confidence_drop', 'safety_warning'] },
          severity: 'high',
          detectedAt: { gte: start, lte: end },
        },
        orderBy: [{ isActive: 'desc' }, { severity: 'asc' }, { detectedAt: 'desc' }],
        skip: 40,
        take: 20,
      });
    });
  });

  describe('findUnacknowledged', () => {
    it('queries active unacknowledged anomalies', async () => {
      mockPrisma.anomalyRecord.findMany.mockResolvedValue([makeAnomalyRow()]);
      await repo.findUnacknowledged();
      expect(mockPrisma.anomalyRecord.findMany).toHaveBeenCalledWith({
        where: { isActive: true, acknowledgedAt: null },
        orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
      });
    });
  });

  describe('create', () => {
    it('creates an active anomaly and maps result', async () => {
      mockPrisma.anomalyRecord.create.mockResolvedValue(makeAnomalyRow());
      await repo.create({
        robotId: 'robot-1',
        anomalyType: 'confidence_drop',
        severity: 'high',
        description: 'low confidence',
      });
      expect(mockPrisma.anomalyRecord.create).toHaveBeenCalledWith({
        data: {
          robotId: 'robot-1',
          anomalyType: 'confidence_drop',
          severity: 'high',
          description: 'low confidence',
          isActive: true,
        },
      });
    });
  });

  describe('acknowledge', () => {
    it('sets acknowledgedAt/By and maps result', async () => {
      mockPrisma.anomalyRecord.update.mockResolvedValue(
        makeAnomalyRow({ acknowledgedAt: new Date('2026-01-01T10:00:00Z'), acknowledgedBy: 'op-2' })
      );
      const result = await repo.acknowledge('ano-1', 'op-2');
      expect(mockPrisma.anomalyRecord.update).toHaveBeenCalledWith({
        where: { id: 'ano-1' },
        data: { acknowledgedAt: expect.any(Date), acknowledgedBy: 'op-2' },
      });
      expect(result?.acknowledgedBy).toBe('op-2');
    });

    it('returns null when update throws', async () => {
      mockPrisma.anomalyRecord.update.mockRejectedValue(new Error('not found'));
      expect(await repo.acknowledge('missing', 'op-2')).toBeNull();
    });
  });

  describe('resolve', () => {
    it('sets resolvedAt/resolution, deactivates, and maps result', async () => {
      mockPrisma.anomalyRecord.update.mockResolvedValue(
        makeAnomalyRow({
          resolvedAt: new Date('2026-01-01T14:00:00Z'),
          resolution: 'fixed',
          isActive: false,
        })
      );
      const result = await repo.resolve('ano-1', 'fixed');
      expect(mockPrisma.anomalyRecord.update).toHaveBeenCalledWith({
        where: { id: 'ano-1' },
        data: { resolvedAt: expect.any(Date), resolution: 'fixed', isActive: false },
      });
      expect(result?.resolution).toBe('fixed');
      expect(result?.isActive).toBe(false);
    });

    it('returns null when update throws', async () => {
      mockPrisma.anomalyRecord.update.mockRejectedValue(new Error('boom'));
      expect(await repo.resolve('missing', 'fixed')).toBeNull();
    });
  });

  describe('countActive', () => {
    it('counts active anomalies', async () => {
      mockPrisma.anomalyRecord.count.mockResolvedValue(9);
      expect(await repo.countActive()).toBe(9);
      expect(mockPrisma.anomalyRecord.count).toHaveBeenCalledWith({ where: { isActive: true } });
    });
  });

  describe('countUnacknowledged', () => {
    it('counts active unacknowledged anomalies', async () => {
      mockPrisma.anomalyRecord.count.mockResolvedValue(2);
      expect(await repo.countUnacknowledged()).toBe(2);
      expect(mockPrisma.anomalyRecord.count).toHaveBeenCalledWith({
        where: { isActive: true, acknowledgedAt: null },
      });
    });
  });

  describe('getCountsBySeverity', () => {
    it('maps groupBy results into severity record, defaulting missing to 0', async () => {
      mockPrisma.anomalyRecord.groupBy.mockResolvedValue([
        { severity: 'high', _count: { id: 3 } },
        { severity: 'critical', _count: { id: 1 } },
      ]);
      const result = await repo.getCountsBySeverity();
      expect(mockPrisma.anomalyRecord.groupBy).toHaveBeenCalledWith({
        by: ['severity'],
        where: { isActive: true },
        _count: { id: true },
      });
      expect(result).toEqual({ low: 0, medium: 0, high: 3, critical: 1 });
    });
  });

  describe('getCountsByType', () => {
    it('maps groupBy results into type record, defaulting missing to 0', async () => {
      mockPrisma.anomalyRecord.groupBy.mockResolvedValue([
        { anomalyType: 'confidence_drop', _count: { id: 2 } },
        { anomalyType: 'sensor_malfunction', _count: { id: 5 } },
      ]);
      const result = await repo.getCountsByType();
      expect(mockPrisma.anomalyRecord.groupBy).toHaveBeenCalledWith({
        by: ['anomalyType'],
        where: { isActive: true },
        _count: { id: true },
      });
      expect(result).toEqual({
        confidence_drop: 2,
        behavior_drift: 0,
        performance_degradation: 0,
        safety_warning: 0,
        communication_loss: 0,
        sensor_malfunction: 5,
      });
    });
  });
});
