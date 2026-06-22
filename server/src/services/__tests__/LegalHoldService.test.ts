/**
 * @file LegalHoldService.test.ts
 * @description Unit tests for LegalHoldService — create/release/query legal holds and manage logs under hold
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for external boundaries — the only boundary is the prisma client.
// LegalHoldService imports { prisma } from '../database/index.js'.
// ---------------------------------------------------------------------------

const { legalHold, complianceLog } = vi.hoisted(() => ({
  legalHold: {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  complianceLog: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: {
    legalHold,
    complianceLog,
  },
}));

import { LegalHoldService, legalHoldService } from '../LegalHoldService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T00:00:00.000Z');

/** Shape of a row as returned by prisma (logIds is a JSON string). */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hold-1',
    name: 'Investigation A',
    reason: 'litigation hold',
    createdBy: 'compliance-officer',
    startDate: NOW,
    endDate: null,
    isActive: true,
    logIds: JSON.stringify(['log-1', 'log-2']),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// createHold
// ===========================================================================

describe('createHold', () => {
  it('persists the hold, links the logs, and returns a mapped LegalHold', async () => {
    const row = makeRow();
    legalHold.create.mockResolvedValue(row);
    complianceLog.updateMany.mockResolvedValue({ count: 2 });

    const svc = new LegalHoldService();
    const result = await svc.createHold({
      name: 'Investigation A',
      reason: 'litigation hold',
      createdBy: 'compliance-officer',
      logIds: ['log-1', 'log-2'],
    });

    // logIds is serialized to a JSON string on the way in
    expect(legalHold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Investigation A',
        reason: 'litigation hold',
        createdBy: 'compliance-officer',
        logIds: JSON.stringify(['log-1', 'log-2']),
        isActive: true,
      }),
    });

    // logs are linked to the new hold id
    expect(complianceLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['log-1', 'log-2'] } },
      data: { legalHoldId: 'hold-1' },
    });

    // logIds comes back parsed into an array
    expect(result.logIds).toEqual(['log-1', 'log-2']);
    expect(result.id).toBe('hold-1');
    expect(result.isActive).toBe(true);
  });

  it('does not touch compliance logs when no logIds are provided', async () => {
    legalHold.create.mockResolvedValue(makeRow({ logIds: JSON.stringify([]) }));

    const svc = new LegalHoldService();
    const result = await svc.createHold({
      name: 'Empty hold',
      reason: 'precaution',
      createdBy: 'admin',
      logIds: [],
    });

    expect(complianceLog.updateMany).not.toHaveBeenCalled();
    expect(result.logIds).toEqual([]);
  });

  it('propagates errors from the database', async () => {
    legalHold.create.mockRejectedValue(new Error('db down'));
    const svc = new LegalHoldService();
    await expect(
      svc.createHold({ name: 'x', reason: 'y', createdBy: 'z', logIds: [] }),
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// releaseHold
// ===========================================================================

describe('releaseHold', () => {
  it('deactivates the hold, sets an endDate, and clears references from logs', async () => {
    const released = makeRow({ isActive: false, endDate: NOW });
    legalHold.update.mockResolvedValue(released);
    complianceLog.updateMany.mockResolvedValue({ count: 2 });

    const svc = new LegalHoldService();
    const result = await svc.releaseHold('hold-1');

    expect(legalHold.update).toHaveBeenCalledWith({
      where: { id: 'hold-1' },
      data: expect.objectContaining({ isActive: false, endDate: expect.any(Date) }),
    });
    expect(complianceLog.updateMany).toHaveBeenCalledWith({
      where: { legalHoldId: 'hold-1' },
      data: { legalHoldId: null },
    });
    expect(result?.isActive).toBe(false);
  });

  it('propagates the error when the hold does not exist (prisma update throws)', async () => {
    // prisma.update rejects on a missing record; the service never reaches the
    // `if (!hold) return null` branch because update throws first.
    legalHold.update.mockRejectedValue(new Error('Record to update not found'));
    const svc = new LegalHoldService();
    await expect(svc.releaseHold('missing')).rejects.toThrow('Record to update not found');
    expect(complianceLog.updateMany).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getHold
// ===========================================================================

describe('getHold', () => {
  it('returns the mapped hold when found', async () => {
    legalHold.findUnique.mockResolvedValue(makeRow());
    const svc = new LegalHoldService();
    const result = await svc.getHold('hold-1');
    expect(legalHold.findUnique).toHaveBeenCalledWith({ where: { id: 'hold-1' } });
    expect(result?.logIds).toEqual(['log-1', 'log-2']);
  });

  it('returns null when not found', async () => {
    legalHold.findUnique.mockResolvedValue(null);
    const svc = new LegalHoldService();
    expect(await svc.getHold('nope')).toBeNull();
  });

  it('tolerates a corrupt logIds JSON string by returning an empty array', async () => {
    legalHold.findUnique.mockResolvedValue(makeRow({ logIds: 'not-json' }));
    const svc = new LegalHoldService();
    const result = await svc.getHold('hold-1');
    expect(result?.logIds).toEqual([]);
  });
});

// ===========================================================================
// getActiveHolds / getAllHolds
// ===========================================================================

describe('getActiveHolds', () => {
  it('queries only active holds ordered by createdAt desc and maps them', async () => {
    legalHold.findMany.mockResolvedValue([makeRow({ id: 'h1' }), makeRow({ id: 'h2' })]);
    const svc = new LegalHoldService();
    const result = await svc.getActiveHolds();

    expect(legalHold.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(2);
    expect(result[0].logIds).toEqual(['log-1', 'log-2']);
  });

  it('returns an empty array when there are no active holds', async () => {
    legalHold.findMany.mockResolvedValue([]);
    const svc = new LegalHoldService();
    expect(await svc.getActiveHolds()).toEqual([]);
  });
});

describe('getAllHolds', () => {
  it('queries all holds without an isActive filter, ordered by createdAt desc', async () => {
    legalHold.findMany.mockResolvedValue([makeRow({ isActive: false })]);
    const svc = new LegalHoldService();
    const result = await svc.getAllHolds();

    expect(legalHold.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    expect(result).toHaveLength(1);
    expect(result[0].isActive).toBe(false);
  });
});

// ===========================================================================
// isLogUnderHold
// ===========================================================================

describe('isLogUnderHold', () => {
  it('returns false when the log has no legalHoldId', async () => {
    complianceLog.findUnique.mockResolvedValue({ legalHoldId: null });
    const svc = new LegalHoldService();
    expect(await svc.isLogUnderHold('log-1')).toBe(false);
    expect(legalHold.findUnique).not.toHaveBeenCalled();
  });

  it('returns false when the log does not exist', async () => {
    complianceLog.findUnique.mockResolvedValue(null);
    const svc = new LegalHoldService();
    expect(await svc.isLogUnderHold('ghost')).toBe(false);
  });

  it('returns true when the referenced hold is active', async () => {
    complianceLog.findUnique.mockResolvedValue({ legalHoldId: 'hold-1' });
    legalHold.findUnique.mockResolvedValue({ isActive: true });
    const svc = new LegalHoldService();
    expect(await svc.isLogUnderHold('log-1')).toBe(true);
    expect(legalHold.findUnique).toHaveBeenCalledWith({
      where: { id: 'hold-1' },
      select: { isActive: true },
    });
  });

  it('returns false when the referenced hold is inactive', async () => {
    complianceLog.findUnique.mockResolvedValue({ legalHoldId: 'hold-1' });
    legalHold.findUnique.mockResolvedValue({ isActive: false });
    const svc = new LegalHoldService();
    expect(await svc.isLogUnderHold('log-1')).toBe(false);
  });

  it('returns false when the referenced hold has been deleted', async () => {
    complianceLog.findUnique.mockResolvedValue({ legalHoldId: 'hold-1' });
    legalHold.findUnique.mockResolvedValue(null);
    const svc = new LegalHoldService();
    expect(await svc.isLogUnderHold('log-1')).toBe(false);
  });
});

// ===========================================================================
// getLogsUnderHold
// ===========================================================================

describe('getLogsUnderHold', () => {
  it('aggregates and deduplicates log IDs across all active holds', async () => {
    legalHold.findMany.mockResolvedValue([
      { logIds: JSON.stringify(['log-1', 'log-2']) },
      { logIds: JSON.stringify(['log-2', 'log-3']) },
    ]);
    const svc = new LegalHoldService();
    const result = await svc.getLogsUnderHold();

    expect(legalHold.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { logIds: true },
    });
    expect(result.sort()).toEqual(['log-1', 'log-2', 'log-3']);
  });

  it('returns an empty array when there are no active holds', async () => {
    legalHold.findMany.mockResolvedValue([]);
    const svc = new LegalHoldService();
    expect(await svc.getLogsUnderHold()).toEqual([]);
  });

  it('skips holds with corrupt logIds without throwing', async () => {
    legalHold.findMany.mockResolvedValue([
      { logIds: 'corrupt' },
      { logIds: JSON.stringify(['log-9']) },
    ]);
    const svc = new LegalHoldService();
    expect(await svc.getLogsUnderHold()).toEqual(['log-9']);
  });
});

// ===========================================================================
// addLogsToHold
// ===========================================================================

describe('addLogsToHold', () => {
  it('returns null when the hold does not exist', async () => {
    legalHold.findUnique.mockResolvedValue(null);
    const svc = new LegalHoldService();
    const result = await svc.addLogsToHold({ holdId: 'nope', logIds: ['log-3'] });
    expect(result).toBeNull();
    expect(legalHold.update).not.toHaveBeenCalled();
  });

  it('returns null when the hold is inactive', async () => {
    legalHold.findUnique.mockResolvedValue(makeRow({ isActive: false }));
    const svc = new LegalHoldService();
    const result = await svc.addLogsToHold({ holdId: 'hold-1', logIds: ['log-3'] });
    expect(result).toBeNull();
    expect(legalHold.update).not.toHaveBeenCalled();
  });

  it('merges new logs with existing (deduplicated) and links them', async () => {
    legalHold.findUnique.mockResolvedValue(makeRow({ logIds: JSON.stringify(['log-1', 'log-2']) }));
    legalHold.update.mockImplementation(async ({ data }: { data: { logIds: string } }) =>
      makeRow({ logIds: data.logIds }),
    );
    complianceLog.updateMany.mockResolvedValue({ count: 1 });

    const svc = new LegalHoldService();
    // log-2 already present, log-3 is new
    const result = await svc.addLogsToHold({ holdId: 'hold-1', logIds: ['log-2', 'log-3'] });

    const updateArg = legalHold.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'hold-1' });
    expect(JSON.parse(updateArg.data.logIds).sort()).toEqual(['log-1', 'log-2', 'log-3']);

    expect(complianceLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['log-2', 'log-3'] } },
      data: { legalHoldId: 'hold-1' },
    });
    expect(result?.logIds.sort()).toEqual(['log-1', 'log-2', 'log-3']);
  });
});

// ===========================================================================
// removeLogsFromHold
// ===========================================================================

describe('removeLogsFromHold', () => {
  it('returns null when the hold does not exist', async () => {
    legalHold.findUnique.mockResolvedValue(null);
    const svc = new LegalHoldService();
    const result = await svc.removeLogsFromHold('nope', ['log-1']);
    expect(result).toBeNull();
    expect(legalHold.update).not.toHaveBeenCalled();
  });

  it('removes the requested logs and clears their references', async () => {
    legalHold.findUnique.mockResolvedValue(
      makeRow({ logIds: JSON.stringify(['log-1', 'log-2', 'log-3']) }),
    );
    legalHold.update.mockImplementation(async ({ data }: { data: { logIds: string } }) =>
      makeRow({ logIds: data.logIds }),
    );
    complianceLog.updateMany.mockResolvedValue({ count: 1 });

    const svc = new LegalHoldService();
    const result = await svc.removeLogsFromHold('hold-1', ['log-2']);

    const updateArg = legalHold.update.mock.calls[0][0];
    expect(JSON.parse(updateArg.data.logIds)).toEqual(['log-1', 'log-3']);

    expect(complianceLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['log-2'] }, legalHoldId: 'hold-1' },
      data: { legalHoldId: null },
    });
    expect(result?.logIds).toEqual(['log-1', 'log-3']);
  });

  it('is a no-op on the stored list when removing logs not present', async () => {
    legalHold.findUnique.mockResolvedValue(makeRow({ logIds: JSON.stringify(['log-1']) }));
    legalHold.update.mockImplementation(async ({ data }: { data: { logIds: string } }) =>
      makeRow({ logIds: data.logIds }),
    );
    complianceLog.updateMany.mockResolvedValue({ count: 0 });

    const svc = new LegalHoldService();
    const result = await svc.removeLogsFromHold('hold-1', ['log-999']);

    const updateArg = legalHold.update.mock.calls[0][0];
    expect(JSON.parse(updateArg.data.logIds)).toEqual(['log-1']);
    expect(result?.logIds).toEqual(['log-1']);
  });
});

// ===========================================================================
// singleton export
// ===========================================================================

describe('singleton', () => {
  it('exports a ready-to-use instance', () => {
    expect(legalHoldService).toBeInstanceOf(LegalHoldService);
  });
});
