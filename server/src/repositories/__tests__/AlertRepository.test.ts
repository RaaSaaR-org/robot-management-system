/**
 * @file AlertRepository.test.ts
 * @description Unit tests for AlertRepository — the data-access layer for Alert
 *   entities. The prisma client (the I/O boundary) is mocked; the inline
 *   dbAlertToDomain mapper runs for real so mapping is exercised end-to-end.
 * @feature alerts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Alert as PrismaAlert } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock prisma before importing the repository. Only the `alert` model is
// touched, with exactly the methods the repository invokes.
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    alert: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import { prisma as _prisma } from '../../database/index.js';
import { AlertRepository, alertRepository } from '../AlertRepository.js';
import type { AlertSeverity } from '../AlertRepository.js';

// Retype the mocked prisma so `.mockResolvedValue` etc. typecheck.
const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures — db-row shape that dbAlertToDomain accepts (Date columns,
// nullable columns as null).
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<PrismaAlert> = {}): PrismaAlert {
  return {
    id: 'alert-1',
    severity: 'warning',
    title: 'Test Alert',
    message: 'Something happened',
    source: 'system',
    sourceId: null,
    acknowledged: false,
    acknowledgedAt: null,
    acknowledgedBy: null,
    dismissable: true,
    autoDismissMs: null,
    createdAt: new Date('2026-06-22T00:00:00.000Z'),
    ...overrides,
  } as PrismaAlert;
}

let repo: AlertRepository;

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AlertRepository();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('AlertRepository.findById', () => {
  it('queries by id and maps the db row to a domain Alert', async () => {
    prisma.alert.findUnique.mockResolvedValue(
      makeRow({
        id: 'a-99',
        sourceId: 'robot-7',
        acknowledged: true,
        acknowledgedAt: new Date('2026-06-22T01:00:00.000Z'),
        acknowledgedBy: 'user-3',
        autoDismissMs: 5000,
      })
    );

    const result = await repo.findById('a-99');

    expect(prisma.alert.findUnique).toHaveBeenCalledWith({ where: { id: 'a-99' } });
    expect(result).toEqual({
      id: 'a-99',
      severity: 'warning',
      title: 'Test Alert',
      message: 'Something happened',
      source: 'system',
      sourceId: 'robot-7',
      acknowledged: true,
      acknowledgedAt: '2026-06-22T01:00:00.000Z',
      acknowledgedBy: 'user-3',
      dismissable: true,
      autoDismissMs: 5000,
      timestamp: '2026-06-22T00:00:00.000Z',
    });
  });

  it('maps nullable columns to undefined', async () => {
    prisma.alert.findUnique.mockResolvedValue(makeRow());

    const result = await repo.findById('alert-1');

    expect(result?.sourceId).toBeUndefined();
    expect(result?.acknowledgedAt).toBeUndefined();
    expect(result?.acknowledgedBy).toBeUndefined();
    expect(result?.autoDismissMs).toBeUndefined();
  });

  it('returns null when prisma finds nothing', async () => {
    prisma.alert.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('AlertRepository.findAll', () => {
  it('applies default pagination, desc order, empty where, and computes totalPages', async () => {
    prisma.alert.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'alert-2' })]);
    prisma.alert.count.mockResolvedValue(120);

    const result = await repo.findAll();

    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });
    expect(prisma.alert.count).toHaveBeenCalledWith({ where: {} });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('alert-1');
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 120,
      totalPages: 3,
    });
  });

  it('honours custom pagination (skip = (page-1)*pageSize)', async () => {
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.alert.count.mockResolvedValue(0);

    await repo.findAll(undefined, { page: 3, pageSize: 10 });

    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 10,
    });
  });

  it('builds a where clause from scalar filters', async () => {
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.alert.count.mockResolvedValue(0);

    await repo.findAll({
      severity: 'critical',
      source: 'robot',
      sourceId: 'robot-1',
      acknowledged: false,
    });

    const arg = prisma.alert.findMany.mock.calls[0][0];
    expect(arg?.where).toEqual({
      severity: 'critical',
      source: 'robot',
      sourceId: 'robot-1',
      acknowledged: false,
    });
  });

  it('builds an `in` clause for array filters', async () => {
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.alert.count.mockResolvedValue(0);

    await repo.findAll({
      severity: ['critical', 'error'],
      source: ['robot', 'task'],
    });

    const arg = prisma.alert.findMany.mock.calls[0][0];
    expect(arg?.where).toEqual({
      severity: { in: ['critical', 'error'] },
      source: { in: ['robot', 'task'] },
    });
  });

  it('builds a createdAt range from startDate/endDate', async () => {
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.alert.count.mockResolvedValue(0);

    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-02-01T00:00:00.000Z');
    await repo.findAll({ startDate: start, endDate: end });

    const arg = prisma.alert.findMany.mock.calls[0][0];
    expect(arg?.where).toEqual({ createdAt: { gte: start, lte: end } });
  });

  it('returns empty data and zero totalPages when no alerts exist', async () => {
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.alert.count.mockResolvedValue(0);

    const result = await repo.findAll();

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findActive
// ---------------------------------------------------------------------------

describe('AlertRepository.findActive', () => {
  it('forces acknowledged:false and orders by severity then createdAt', async () => {
    prisma.alert.findMany.mockResolvedValue([]);

    await repo.findActive({ source: 'robot' });

    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: { source: 'robot', acknowledged: false },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });
  });

  it('sorts results by severity priority: critical, error, warning, info', async () => {
    prisma.alert.findMany.mockResolvedValue([
      makeRow({ id: 'i', severity: 'info' }),
      makeRow({ id: 'c', severity: 'critical' }),
      makeRow({ id: 'w', severity: 'warning' }),
      makeRow({ id: 'e', severity: 'error' }),
    ]);

    const result = await repo.findActive();

    expect(result.map((a) => a.id)).toEqual(['c', 'e', 'w', 'i']);
  });

  it('returns an empty array when there are no active alerts', async () => {
    prisma.alert.findMany.mockResolvedValue([]);

    const result = await repo.findActive();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('AlertRepository.create', () => {
  it('persists input and defaults dismissable to true for non-critical severities', async () => {
    prisma.alert.create.mockResolvedValue(makeRow({ severity: 'warning' }));

    await repo.create({
      severity: 'warning',
      title: 'Disk',
      message: 'Low space',
      source: 'system',
    });

    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: {
        severity: 'warning',
        title: 'Disk',
        message: 'Low space',
        source: 'system',
        sourceId: undefined,
        dismissable: true,
        autoDismissMs: undefined,
      },
    });
  });

  it('defaults dismissable to false for critical severity', async () => {
    prisma.alert.create.mockResolvedValue(makeRow({ severity: 'critical', dismissable: false }));

    await repo.create({
      severity: 'critical',
      title: 'Down',
      message: 'Robot offline',
      source: 'robot',
      sourceId: 'robot-7',
    });

    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: {
        severity: 'critical',
        title: 'Down',
        message: 'Robot offline',
        source: 'robot',
        sourceId: 'robot-7',
        dismissable: false,
        autoDismissMs: undefined,
      },
    });
  });

  it('respects an explicit dismissable flag and autoDismissMs', async () => {
    prisma.alert.create.mockResolvedValue(makeRow());

    await repo.create({
      severity: 'critical',
      title: 't',
      message: 'm',
      source: 'system',
      dismissable: true,
      autoDismissMs: 3000,
    });

    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dismissable: true, autoDismissMs: 3000 }),
    });
  });

  it('returns the mapped domain alert', async () => {
    prisma.alert.create.mockResolvedValue(makeRow({ id: 'new-1' }));

    const result = await repo.create({
      severity: 'info',
      title: 't',
      message: 'm',
      source: 'system',
    });

    expect(result.id).toBe('new-1');
    expect(result.timestamp).toBe('2026-06-22T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// acknowledge
// ---------------------------------------------------------------------------

describe('AlertRepository.acknowledge', () => {
  it('updates the alert with acknowledged flags and maps the result', async () => {
    const ackAt = new Date('2026-06-22T02:00:00.000Z');
    prisma.alert.update.mockResolvedValue(
      makeRow({ acknowledged: true, acknowledgedAt: ackAt, acknowledgedBy: 'user-9' })
    );

    const result = await repo.acknowledge('alert-1', 'user-9');

    expect(prisma.alert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: {
        acknowledged: true,
        acknowledgedAt: expect.any(Date),
        acknowledgedBy: 'user-9',
      },
    });
    expect(result?.acknowledged).toBe(true);
    expect(result?.acknowledgedBy).toBe('user-9');
    expect(result?.acknowledgedAt).toBe('2026-06-22T02:00:00.000Z');
  });

  it('passes undefined acknowledgedBy when no userId is given', async () => {
    prisma.alert.update.mockResolvedValue(makeRow({ acknowledged: true }));

    await repo.acknowledge('alert-1');

    const arg = prisma.alert.update.mock.calls[0][0];
    expect((arg?.data as { acknowledgedBy?: string }).acknowledgedBy).toBeUndefined();
  });

  it('returns null when the update throws (e.g. record not found)', async () => {
    prisma.alert.update.mockRejectedValue(new Error('record not found'));

    const result = await repo.acknowledge('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('AlertRepository.delete', () => {
  it('deletes by id and returns true on success', async () => {
    prisma.alert.delete.mockResolvedValue(makeRow());

    const result = await repo.delete('alert-1');

    expect(prisma.alert.delete).toHaveBeenCalledWith({ where: { id: 'alert-1' } });
    expect(result).toBe(true);
  });

  it('returns false when the delete throws', async () => {
    prisma.alert.delete.mockRejectedValue(new Error('record not found'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteAcknowledged / deleteAll
// ---------------------------------------------------------------------------

describe('AlertRepository.deleteAcknowledged', () => {
  it('deletes acknowledged alerts and returns the count', async () => {
    prisma.alert.deleteMany.mockResolvedValue({ count: 5 });

    const result = await repo.deleteAcknowledged();

    expect(prisma.alert.deleteMany).toHaveBeenCalledWith({ where: { acknowledged: true } });
    expect(result).toBe(5);
  });
});

describe('AlertRepository.deleteAll', () => {
  it('deletes all alerts and returns the count', async () => {
    prisma.alert.deleteMany.mockResolvedValue({ count: 12 });

    const result = await repo.deleteAll();

    expect(prisma.alert.deleteMany).toHaveBeenCalledWith({});
    expect(result).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// getCountsBySeverity
// ---------------------------------------------------------------------------

describe('AlertRepository.getCountsBySeverity', () => {
  it('groups unacknowledged alerts by severity and fills missing severities with 0', async () => {
    prisma.alert.groupBy.mockResolvedValue([
      { severity: 'critical', _count: { id: 2 } },
      { severity: 'warning', _count: { id: 4 } },
    ] as never);

    const result = await repo.getCountsBySeverity();

    expect(prisma.alert.groupBy).toHaveBeenCalledWith({
      by: ['severity'],
      _count: { id: true },
      where: { acknowledged: false },
    });
    expect(result).toEqual({
      critical: 2,
      error: 0,
      warning: 4,
      info: 0,
    } satisfies Record<AlertSeverity, number>);
  });

  it('returns all-zero counts when there are no alerts', async () => {
    prisma.alert.groupBy.mockResolvedValue([] as never);

    const result = await repo.getCountsBySeverity();

    expect(result).toEqual({ critical: 0, error: 0, warning: 0, info: 0 });
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('alertRepository singleton', () => {
  it('is an AlertRepository instance sharing the mocked prisma', async () => {
    expect(alertRepository).toBeInstanceOf(AlertRepository);

    prisma.alert.findUnique.mockResolvedValue(makeRow({ id: 'shared' }));
    const result = await alertRepository.findById('shared');

    expect(result?.id).toBe('shared');
  });
});
