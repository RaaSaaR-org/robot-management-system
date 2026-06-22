/**
 * @file CommandRepository.test.ts
 * @description Unit tests for CommandRepository — CRUD + pagination over CommandInterpretation,
 *              exercising the real dbToDomain mapper while mocking the Prisma client at the I/O boundary.
 * @feature command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client singleton (imported from ../../database/index.js)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandInterpretation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as {
    commandInterpretation: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { CommandRepository, commandRepository } from '../CommandRepository.js';
import type { CreateCommandInterpretationInput } from '../CommandRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — a valid db-row shape that the real dbToDomain mapper accepts.
// parameters/warnings/suggestedAlternatives are JSON strings; dates are Date objects.
// ---------------------------------------------------------------------------

const CREATED_AT = new Date('2026-01-15T10:00:00.000Z');
const EXECUTED_AT = new Date('2026-01-15T10:05:00.000Z');

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    robotId: 'robot-1',
    originalText: 'Move to Warehouse A',
    commandType: 'navigation',
    parameters: JSON.stringify({ target: 'Warehouse A', speed: 'normal' }),
    confidence: 0.95,
    safetyClassification: 'safe',
    warnings: JSON.stringify(['low battery']),
    suggestedAlternatives: JSON.stringify(['Warehouse B']),
    status: 'interpreted',
    executedCommandId: null,
    createdAt: CREATED_AT,
    executedAt: null,
    ...overrides,
  };
}

function makeCreateInput(
  overrides: Partial<CreateCommandInterpretationInput> = {}
): CreateCommandInterpretationInput {
  return {
    robotId: 'robot-1',
    originalText: 'Move to Warehouse A',
    commandType: 'navigation',
    parameters: { target: 'Warehouse A', speed: 'normal' },
    confidence: 0.95,
    safetyClassification: 'safe',
    warnings: ['low battery'],
    suggestedAlternatives: ['Warehouse B'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const repo = new CommandRepository();

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('CommandRepository.findById', () => {
  it('queries by id and maps the db row to a domain object', async () => {
    mockPrisma.commandInterpretation.findUnique.mockResolvedValue(makeDbRow());

    const result = await repo.findById('cmd-1');

    expect(mockPrisma.commandInterpretation.findUnique).toHaveBeenCalledWith({
      where: { id: 'cmd-1' },
    });
    expect(result).toEqual({
      id: 'cmd-1',
      robotId: 'robot-1',
      originalText: 'Move to Warehouse A',
      commandType: 'navigation',
      parameters: { target: 'Warehouse A', speed: 'normal' },
      confidence: 0.95,
      safetyClassification: 'safe',
      warnings: ['low battery'],
      suggestedAlternatives: ['Warehouse B'],
      status: 'interpreted',
      executedCommandId: undefined,
      createdAt: CREATED_AT.toISOString(),
      executedAt: undefined,
    });
  });

  it('maps nullable columns: executedCommandId and executedAt become defined when present', async () => {
    mockPrisma.commandInterpretation.findUnique.mockResolvedValue(
      makeDbRow({
        status: 'executed',
        executedCommandId: 'exec-99',
        executedAt: EXECUTED_AT,
      })
    );

    const result = await repo.findById('cmd-1');

    expect(result?.executedCommandId).toBe('exec-99');
    expect(result?.executedAt).toBe(EXECUTED_AT.toISOString());
  });

  it('returns null when prisma finds nothing', async () => {
    mockPrisma.commandInterpretation.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('CommandRepository.findAll', () => {
  it('uses default pagination (page 1, pageSize 50) and orders by createdAt desc', async () => {
    mockPrisma.commandInterpretation.findMany.mockResolvedValue([makeDbRow()]);
    mockPrisma.commandInterpretation.count.mockResolvedValue(1);

    const result = await repo.findAll();

    expect(mockPrisma.commandInterpretation.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    expect(mockPrisma.commandInterpretation.count).toHaveBeenCalledWith();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe('cmd-1');
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
    });
  });

  it('computes skip from page/pageSize and totalPages via ceil', async () => {
    mockPrisma.commandInterpretation.findMany.mockResolvedValue([]);
    mockPrisma.commandInterpretation.count.mockResolvedValue(25);

    const result = await repo.findAll({ page: 3, pageSize: 10 });

    expect(mockPrisma.commandInterpretation.findMany).toHaveBeenCalledWith({
      skip: 20,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.pagination).toEqual({
      page: 3,
      pageSize: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('returns empty entries when no rows exist', async () => {
    mockPrisma.commandInterpretation.findMany.mockResolvedValue([]);
    mockPrisma.commandInterpretation.count.mockResolvedValue(0);

    const result = await repo.findAll();

    expect(result.entries).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findByRobotId
// ---------------------------------------------------------------------------

describe('CommandRepository.findByRobotId', () => {
  it('filters findMany and count by robotId with default pagination', async () => {
    mockPrisma.commandInterpretation.findMany.mockResolvedValue([makeDbRow()]);
    mockPrisma.commandInterpretation.count.mockResolvedValue(1);

    const result = await repo.findByRobotId('robot-1');

    expect(mockPrisma.commandInterpretation.findMany).toHaveBeenCalledWith({
      where: { robotId: 'robot-1' },
      skip: 0,
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    expect(mockPrisma.commandInterpretation.count).toHaveBeenCalledWith({
      where: { robotId: 'robot-1' },
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].robotId).toBe('robot-1');
  });

  it('honors custom pagination params', async () => {
    mockPrisma.commandInterpretation.findMany.mockResolvedValue([]);
    mockPrisma.commandInterpretation.count.mockResolvedValue(7);

    const result = await repo.findByRobotId('robot-2', { page: 2, pageSize: 5 });

    expect(mockPrisma.commandInterpretation.findMany).toHaveBeenCalledWith({
      where: { robotId: 'robot-2' },
      skip: 5,
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 5,
      total: 7,
      totalPages: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('CommandRepository.create', () => {
  it('serializes JSON fields, defaults status to interpreted, and maps the result', async () => {
    mockPrisma.commandInterpretation.create.mockResolvedValue(makeDbRow());

    const input = makeCreateInput();
    const result = await repo.create(input);

    expect(mockPrisma.commandInterpretation.create).toHaveBeenCalledWith({
      data: {
        robotId: 'robot-1',
        originalText: 'Move to Warehouse A',
        commandType: 'navigation',
        parameters: JSON.stringify({ target: 'Warehouse A', speed: 'normal' }),
        confidence: 0.95,
        safetyClassification: 'safe',
        warnings: JSON.stringify(['low battery']),
        suggestedAlternatives: JSON.stringify(['Warehouse B']),
        status: 'interpreted',
      },
    });
    expect(result.id).toBe('cmd-1');
    expect(result.status).toBe('interpreted');
  });

  it('defaults warnings and suggestedAlternatives to empty arrays when omitted', async () => {
    mockPrisma.commandInterpretation.create.mockResolvedValue(
      makeDbRow({
        warnings: JSON.stringify([]),
        suggestedAlternatives: JSON.stringify([]),
      })
    );

    const input = makeCreateInput({
      warnings: undefined,
      suggestedAlternatives: undefined,
    });
    const result = await repo.create(input);

    expect(mockPrisma.commandInterpretation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          warnings: JSON.stringify([]),
          suggestedAlternatives: JSON.stringify([]),
        }),
      })
    );
    expect(result.warnings).toEqual([]);
    expect(result.suggestedAlternatives).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('CommandRepository.updateStatus', () => {
  it('updates status without setting executedAt for non-executed statuses', async () => {
    mockPrisma.commandInterpretation.update.mockResolvedValue(
      makeDbRow({ status: 'confirmed' })
    );

    const result = await repo.updateStatus('cmd-1', 'confirmed');

    expect(mockPrisma.commandInterpretation.update).toHaveBeenCalledWith({
      where: { id: 'cmd-1' },
      data: {
        status: 'confirmed',
        executedCommandId: undefined,
        executedAt: undefined,
      },
    });
    expect(result?.status).toBe('confirmed');
  });

  it('sets executedAt to a Date and stores executedCommandId when status is executed', async () => {
    mockPrisma.commandInterpretation.update.mockResolvedValue(
      makeDbRow({
        status: 'executed',
        executedCommandId: 'exec-1',
        executedAt: EXECUTED_AT,
      })
    );

    const result = await repo.updateStatus('cmd-1', 'executed', 'exec-1');

    const callArg = mockPrisma.commandInterpretation.update.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; executedCommandId?: string; executedAt?: Date };
    };
    expect(callArg.where).toEqual({ id: 'cmd-1' });
    expect(callArg.data.status).toBe('executed');
    expect(callArg.data.executedCommandId).toBe('exec-1');
    expect(callArg.data.executedAt).toBeInstanceOf(Date);
    expect(result?.executedCommandId).toBe('exec-1');
  });

  it('returns null when prisma.update throws (e.g. record not found)', async () => {
    mockPrisma.commandInterpretation.update.mockRejectedValue(new Error('not found'));

    const result = await repo.updateStatus('missing', 'failed');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('CommandRepository.delete', () => {
  it('returns true when the record is deleted', async () => {
    mockPrisma.commandInterpretation.delete.mockResolvedValue(makeDbRow());

    const result = await repo.delete('cmd-1');

    expect(mockPrisma.commandInterpretation.delete).toHaveBeenCalledWith({
      where: { id: 'cmd-1' },
    });
    expect(result).toBe(true);
  });

  it('returns false when prisma.delete throws', async () => {
    mockPrisma.commandInterpretation.delete.mockRejectedValue(new Error('not found'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe('CommandRepository.count', () => {
  it('returns the total count from prisma', async () => {
    mockPrisma.commandInterpretation.count.mockResolvedValue(42);

    const result = await repo.count();

    expect(mockPrisma.commandInterpretation.count).toHaveBeenCalledWith();
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

describe('commandRepository singleton', () => {
  it('is an instance of CommandRepository sharing the mocked prisma', async () => {
    expect(commandRepository).toBeInstanceOf(CommandRepository);
    mockPrisma.commandInterpretation.count.mockResolvedValue(3);
    await expect(commandRepository.count()).resolves.toBe(3);
  });
});
