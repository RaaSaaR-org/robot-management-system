/**
 * @file RobotTaskRepository.test.ts
 * @description Unit tests for RobotTaskRepository — verifies the Prisma query
 *   shapes (where/orderBy/data/pagination) it builds, error-swallowing paths
 *   that return null/false, queue-stat aggregation via groupBy, and that the
 *   real dbRobotTaskToDomain mapper is exercised on returned rows.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  CreateRobotTaskRequest,
  RobotTaskResult,
} from '../../types/robotTask.types.js';

// ---------------------------------------------------------------------------
// Hoisted mock for the singleton Prisma client imported by the repository.
// Only the I/O boundary (prisma.robotTask.*) is mocked; the domain mapper
// dbRobotTaskToDomain runs for real.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    robotTask: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { RobotTaskRepository, robotTaskRepository } from '../RobotTaskRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — a valid DbRobotTask row shape that dbRobotTaskToDomain accepts.
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string;
  processInstanceId: string | null;
  stepInstanceId: string | null;
  source: string;
  robotId: string | null;
  priority: string;
  status: string;
  actionType: string;
  actionConfig: string;
  instruction: string;
  a2aTaskId: string | null;
  a2aContextId: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  timeoutMs: number | null;
  result: string | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
};

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    processInstanceId: null,
    stepInstanceId: null,
    source: 'manual',
    robotId: null,
    priority: 'normal',
    status: 'pending',
    actionType: 'navigate',
    actionConfig: '{"target":"Zone A"}',
    instruction: 'Go to Zone A',
    a2aTaskId: null,
    a2aContextId: null,
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    timeoutMs: null,
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date('2026-06-20T10:00:00.000Z'),
    updatedAt: new Date('2026-06-20T10:00:00.000Z'),
    ...overrides,
  };
}

const repo = new RobotTaskRepository();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('findById', () => {
  it('queries by id and maps the row to a domain task', async () => {
    const row = makeTaskRow({
      id: 'abc',
      actionConfig: '{"speed":2}',
      createdAt: new Date('2026-06-21T08:00:00.000Z'),
    });
    mockPrisma.robotTask.findUnique.mockResolvedValue(row);

    const result = await repo.findById('abc');

    expect(mockPrisma.robotTask.findUnique).toHaveBeenCalledWith({
      where: { id: 'abc' },
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('abc');
    // mapper parses JSON actionConfig and ISO-formats createdAt
    expect(result?.actionConfig).toEqual({ speed: 2 });
    expect(result?.createdAt).toBe('2026-06-21T08:00:00.000Z');
  });

  it('returns null when no row is found', async () => {
    mockPrisma.robotTask.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('findAll', () => {
  it('uses default pagination and empty where when no args given', async () => {
    mockPrisma.robotTask.count.mockResolvedValue(0);
    mockPrisma.robotTask.findMany.mockResolvedValue([]);

    const result = await repo.findAll();

    expect(mockPrisma.robotTask.count).toHaveBeenCalledWith({ where: {} });
    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: {},
      skip: 0,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('builds where with in-clauses for array filters, scalar otherwise, plus dateRange', async () => {
    mockPrisma.robotTask.count.mockResolvedValue(42);
    mockPrisma.robotTask.findMany.mockResolvedValue([makeTaskRow()]);

    const result = await repo.findAll(
      {
        status: ['pending', 'assigned'],
        priority: 'high',
        robotId: 'r1',
        processInstanceId: 'pi1',
        source: 'process',
        dateRange: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
      },
      { page: 3, limit: 10, sortBy: 'priority', sortOrder: 'asc' }
    );

    const expectedWhere = {
      status: { in: ['pending', 'assigned'] },
      priority: 'high',
      robotId: 'r1',
      processInstanceId: 'pi1',
      source: 'process',
      createdAt: {
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-02-01T00:00:00.000Z'),
      },
    };
    expect(mockPrisma.robotTask.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      skip: 20, // (page 3 - 1) * limit 10
      take: 10,
      orderBy: { priority: 'asc' },
    });
    expect(result.data).toHaveLength(1);
    expect(result.pagination).toEqual({
      page: 3,
      limit: 10,
      total: 42,
      totalPages: 5, // ceil(42/10)
    });
  });

  it('treats a single-status filter as a scalar equality (no in-clause)', async () => {
    mockPrisma.robotTask.count.mockResolvedValue(1);
    mockPrisma.robotTask.findMany.mockResolvedValue([makeTaskRow()]);

    await repo.findAll({ status: 'completed', priority: ['high', 'critical'] });

    expect(mockPrisma.robotTask.count).toHaveBeenCalledWith({
      where: { status: 'completed', priority: { in: ['high', 'critical'] } },
    });
  });
});

// ---------------------------------------------------------------------------
// findPendingTasks
// ---------------------------------------------------------------------------

describe('findPendingTasks', () => {
  it('queries pending tasks ordered by priority desc then createdAt asc with default limit', async () => {
    mockPrisma.robotTask.findMany.mockResolvedValue([makeTaskRow(), makeTaskRow({ id: 'task-2' })]);

    const result = await repo.findPendingTasks();

    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: { status: 'pending' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 10,
    });
    expect(result).toHaveLength(2);
  });

  it('honors a custom limit', async () => {
    mockPrisma.robotTask.findMany.mockResolvedValue([]);

    await repo.findPendingTasks(3);

    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });
});

// ---------------------------------------------------------------------------
// findByRobotId
// ---------------------------------------------------------------------------

describe('findByRobotId', () => {
  it('queries by robotId only when no statuses are given', async () => {
    mockPrisma.robotTask.findMany.mockResolvedValue([makeTaskRow({ robotId: 'r1' })]);

    const result = await repo.findByRobotId('r1');

    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: { robotId: 'r1' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    expect(result[0]?.robotId).toBe('r1');
  });

  it('adds a status in-clause when statuses are provided', async () => {
    mockPrisma.robotTask.findMany.mockResolvedValue([]);

    await repo.findByRobotId('r1', ['assigned', 'executing']);

    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: { robotId: 'r1', status: { in: ['assigned', 'executing'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  });

  it('ignores an empty statuses array', async () => {
    mockPrisma.robotTask.findMany.mockResolvedValue([]);

    await repo.findByRobotId('r1', []);

    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: { robotId: 'r1' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  });
});

// ---------------------------------------------------------------------------
// findByProcessInstanceId
// ---------------------------------------------------------------------------

describe('findByProcessInstanceId', () => {
  it('queries by processInstanceId ordered by createdAt asc', async () => {
    mockPrisma.robotTask.findMany.mockResolvedValue([makeTaskRow({ processInstanceId: 'pi1' })]);

    const result = await repo.findByProcessInstanceId('pi1');

    expect(mockPrisma.robotTask.findMany).toHaveBeenCalledWith({
      where: { processInstanceId: 'pi1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(result[0]?.processInstanceId).toBe('pi1');
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('create', () => {
  it('creates an unassigned task as pending with serialized actionConfig and defaults', async () => {
    const created = makeTaskRow({ status: 'pending', actionConfig: '{"target":"Zone B"}' });
    mockPrisma.robotTask.create.mockResolvedValue(created);

    const request: CreateRobotTaskRequest = {
      actionType: 'move_to_location',
      actionConfig: { target: 'Zone B' },
      instruction: 'Navigate to Zone B',
    };

    const result = await repo.create(request, 'manual');

    expect(mockPrisma.robotTask.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.robotTask.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({
      processInstanceId: undefined,
      stepInstanceId: undefined,
      source: 'manual',
      robotId: undefined,
      priority: 'normal',
      status: 'pending',
      actionType: 'move_to_location',
      actionConfig: JSON.stringify({ target: 'Zone B' }),
      instruction: 'Navigate to Zone B',
      assignedAt: undefined,
      maxRetries: 3,
      retryCount: 0,
    });
    expect(typeof arg.data.id).toBe('string');
    expect(result.status).toBe('pending');
  });

  it('creates an assigned task with assignedAt set when robotId is provided', async () => {
    const created = makeTaskRow({ status: 'assigned', robotId: 'r9', priority: 'high' });
    mockPrisma.robotTask.create.mockResolvedValue(created);

    const request: CreateRobotTaskRequest = {
      robotId: 'r9',
      priority: 'high',
      actionType: 'pickup_object',
      actionConfig: {},
      instruction: 'Pick the box',
      timeoutMs: 5000,
      maxRetries: 5,
    };

    const result = await repo.create(request, 'process', 'pi1', 'si1');

    const arg = mockPrisma.robotTask.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({
      processInstanceId: 'pi1',
      stepInstanceId: 'si1',
      source: 'process',
      robotId: 'r9',
      priority: 'high',
      status: 'assigned',
      timeoutMs: 5000,
      maxRetries: 5,
    });
    expect(arg.data.assignedAt).toBeInstanceOf(Date);
    expect(result.robotId).toBe('r9');
  });
});

// ---------------------------------------------------------------------------
// assignToRobot
// ---------------------------------------------------------------------------

describe('assignToRobot', () => {
  it('updates a pending task to assigned with assignedAt and returns the mapped task', async () => {
    const updated = makeTaskRow({ status: 'assigned', robotId: 'r1', assignedAt: new Date('2026-06-22T00:00:00.000Z') });
    mockPrisma.robotTask.update.mockResolvedValue(updated);

    const result = await repo.assignToRobot('task-1', 'r1');

    expect(mockPrisma.robotTask.update).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'task-1', status: 'pending' });
    expect(arg.data).toMatchObject({ robotId: 'r1', status: 'assigned' });
    expect(arg.data.assignedAt).toBeInstanceOf(Date);
    expect(result?.status).toBe('assigned');
  });

  it('returns null when the update throws (e.g. task no longer pending)', async () => {
    mockPrisma.robotTask.update.mockRejectedValue(new Error('record not found'));

    const result = await repo.assignToRobot('task-1', 'r1');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('updateStatus', () => {
  it('sets startedAt when transitioning to executing', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'executing' }));

    await repo.updateStatus('task-1', 'executing');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'task-1' });
    expect(arg.data.status).toBe('executing');
    expect(arg.data.startedAt).toBeInstanceOf(Date);
    expect(arg.data.completedAt).toBeUndefined();
  });

  it('sets completedAt when transitioning to a terminal status and records a2a ids', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'completed' }));

    await repo.updateStatus('task-1', 'completed', 'a2a-1', 'ctx-1');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBe('completed');
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(arg.data.startedAt).toBeUndefined();
    expect(arg.data.a2aTaskId).toBe('a2a-1');
    expect(arg.data.a2aContextId).toBe('ctx-1');
  });

  it('does not set timing fields for a non-timed status like assigned', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'assigned' }));

    await repo.updateStatus('task-1', 'assigned');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ status: 'assigned' });
  });

  it('returns null when the update throws', async () => {
    mockPrisma.robotTask.update.mockRejectedValue(new Error('not found'));

    const result = await repo.updateStatus('task-1', 'executing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

describe('complete', () => {
  it('marks completed with serialized result and no error on success', async () => {
    const result: RobotTaskResult = { success: true, data: { ok: 1 }, durationMs: 1200 };
    mockPrisma.robotTask.update.mockResolvedValue(
      makeTaskRow({ status: 'completed', result: JSON.stringify(result) })
    );

    const domain = await repo.complete('task-1', result);

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'task-1' });
    expect(arg.data.status).toBe('completed');
    expect(arg.data.result).toBe(JSON.stringify(result));
    expect(arg.data.error).toBeUndefined();
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(domain?.result).toEqual(result);
  });

  it('marks failed and records the message as error when result.success is false', async () => {
    const result: RobotTaskResult = { success: false, message: 'boom', durationMs: 50 };
    mockPrisma.robotTask.update.mockResolvedValue(
      makeTaskRow({ status: 'failed', result: JSON.stringify(result), error: 'boom' })
    );

    await repo.complete('task-1', result);

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBe('failed');
    expect(arg.data.error).toBe('boom');
  });

  it('returns null when the update throws', async () => {
    mockPrisma.robotTask.update.mockRejectedValue(new Error('db error'));

    const domain = await repo.complete('task-1', { success: true, durationMs: 1 });

    expect(domain).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fail
// ---------------------------------------------------------------------------

describe('fail', () => {
  it('sets status failed with error and completedAt', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'failed', error: 'oops' }));

    const result = await repo.fail('task-1', 'oops');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'task-1' });
    expect(arg.data).toMatchObject({ status: 'failed', error: 'oops' });
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(result?.error).toBe('oops');
  });

  it('returns null when the update throws', async () => {
    mockPrisma.robotTask.update.mockRejectedValue(new Error('fail'));

    expect(await repo.fail('task-1', 'oops')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('cancel', () => {
  it('cancels with provided reason', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'cancelled', error: 'changed mind' }));

    await repo.cancel('task-1', 'changed mind');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ status: 'cancelled', error: 'changed mind' });
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it('uses default reason when none is provided', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'cancelled', error: 'Cancelled by user' }));

    await repo.cancel('task-1');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.error).toBe('Cancelled by user');
  });

  it('returns null when the update throws', async () => {
    mockPrisma.robotTask.update.mockRejectedValue(new Error('x'));

    expect(await repo.cancel('task-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

describe('retry', () => {
  it('resets to pending, increments retryCount, and clears timing/result/error', async () => {
    mockPrisma.robotTask.update.mockResolvedValue(makeTaskRow({ status: 'pending', retryCount: 1 }));

    const result = await repo.retry('task-1');

    const arg = mockPrisma.robotTask.update.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 'task-1' });
    expect(arg.data).toEqual({
      status: 'pending',
      retryCount: { increment: 1 },
      error: null,
      result: null,
      startedAt: null,
      completedAt: null,
    });
    expect(result?.status).toBe('pending');
  });

  it('returns null when the update throws', async () => {
    mockPrisma.robotTask.update.mockRejectedValue(new Error('x'));

    expect(await repo.retry('task-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getQueueStats
// ---------------------------------------------------------------------------

describe('getQueueStats', () => {
  it('issues three groupBy aggregations and assembles the stats object', async () => {
    mockPrisma.robotTask.groupBy
      // status counts
      .mockResolvedValueOnce([
        { status: 'pending', _count: 4 },
        { status: 'assigned', _count: 3 },
        { status: 'executing', _count: 2 },
        { status: 'completed', _count: 10 },
        { status: 'failed', _count: 1 },
      ])
      // priority counts (pending + assigned)
      .mockResolvedValueOnce([
        { priority: 'critical', _count: 1 },
        { priority: 'high', _count: 2 },
        { priority: 'normal', _count: 4 },
        // unknown priority should be ignored by the `in stats.byPriority` guard
        { priority: 'bogus', _count: 99 },
      ])
      // robot counts (assigned + executing)
      .mockResolvedValueOnce([
        { robotId: 'r1', status: 'assigned', _count: 2 },
        { robotId: 'r1', status: 'executing', _count: 1 },
        { robotId: 'r2', status: 'executing', _count: 5 },
        // null robotId is skipped
        { robotId: null, status: 'assigned', _count: 7 },
      ]);

    const stats = await repo.getQueueStats();

    // Verify the three groupBy call shapes
    expect(mockPrisma.robotTask.groupBy).toHaveBeenCalledTimes(3);
    expect(mockPrisma.robotTask.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['status'],
      _count: true,
    });
    expect(mockPrisma.robotTask.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['priority'],
      where: { status: { in: ['pending', 'assigned'] } },
      _count: true,
    });
    expect(mockPrisma.robotTask.groupBy).toHaveBeenNthCalledWith(3, {
      by: ['robotId', 'status'],
      where: { status: { in: ['assigned', 'executing'] } },
      _count: true,
    });

    expect(stats).toEqual({
      pending: 4,
      assigned: 3,
      executing: 2,
      completed: 10,
      failed: 1,
      byPriority: { critical: 1, high: 2, normal: 4, low: 0 },
      byRobot: {
        r1: { queued: 2, executing: 1 },
        r2: { queued: 0, executing: 5 },
      },
    });
  });

  it('returns zeroed stats when all aggregations are empty', async () => {
    mockPrisma.robotTask.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const stats = await repo.getQueueStats();

    expect(stats).toEqual({
      pending: 0,
      assigned: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      byPriority: { critical: 0, high: 0, normal: 0, low: 0 },
      byRobot: {},
    });
  });
});

// ---------------------------------------------------------------------------
// countByRobot
// ---------------------------------------------------------------------------

describe('countByRobot', () => {
  it('counts by robotId only when no statuses given', async () => {
    mockPrisma.robotTask.count.mockResolvedValue(7);

    const result = await repo.countByRobot('r1');

    expect(mockPrisma.robotTask.count).toHaveBeenCalledWith({ where: { robotId: 'r1' } });
    expect(result).toBe(7);
  });

  it('adds a status in-clause when statuses are given', async () => {
    mockPrisma.robotTask.count.mockResolvedValue(2);

    const result = await repo.countByRobot('r1', ['assigned']);

    expect(mockPrisma.robotTask.count).toHaveBeenCalledWith({
      where: { robotId: 'r1', status: { in: ['assigned'] } },
    });
    expect(result).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('delete', () => {
  it('returns true when the delete succeeds', async () => {
    mockPrisma.robotTask.delete.mockResolvedValue(makeTaskRow());

    const result = await repo.delete('task-1');

    expect(mockPrisma.robotTask.delete).toHaveBeenCalledWith({ where: { id: 'task-1' } });
    expect(result).toBe(true);
  });

  it('returns false when the delete throws', async () => {
    mockPrisma.robotTask.delete.mockRejectedValue(new Error('not found'));

    const result = await repo.delete('task-1');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exported singleton
// ---------------------------------------------------------------------------

describe('robotTaskRepository singleton', () => {
  it('shares the mocked prisma client', async () => {
    mockPrisma.robotTask.findUnique.mockResolvedValue(makeTaskRow({ id: 'singleton' }));

    const result = await robotTaskRepository.findById('singleton');

    expect(result?.id).toBe('singleton');
  });
});
