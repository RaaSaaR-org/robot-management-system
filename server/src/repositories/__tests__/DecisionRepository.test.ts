/**
 * @file DecisionRepository.test.ts
 * @description Unit tests for DecisionRepository — the data-access layer for AI
 *   Decision explainability entities (EU AI Act Art. 13/50). The prisma client
 *   (the I/O boundary) is mocked; the inline dbToDomain mapper runs for real so
 *   JSON-string parsing and Date->ISO mapping are exercised end-to-end.
 * @feature explainability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Decision as PrismaDecision } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock prisma before importing the repository. Only the `decision` model is
// touched, with exactly the methods the repository invokes.
// ---------------------------------------------------------------------------

vi.mock('../../database/index.js', () => ({
  prisma: {
    decision: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma as _prisma } from '../../database/index.js';
import {
  DecisionRepository,
  decisionRepository,
  type CreateDecisionInput,
  type DecisionInputFactors,
  type DecisionSafetyFactors,
  type AlternativeConsidered,
} from '../DecisionRepository.js';

// Retype the mocked prisma so `.mockResolvedValue` etc. typecheck.
const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures — db-row shape that the inline dbToDomain mapper accepts. JSON
// columns are stored as JSON strings; createdAt is a real Date.
// ---------------------------------------------------------------------------

const sampleInputFactors: DecisionInputFactors = {
  userCommand: 'move to warehouse A',
  robotState: {
    location: { x: 1, y: 2, z: 0 },
    batteryLevel: 85,
    status: 'idle',
    heldObject: null,
  },
  environmentContext: {
    zones: ['warehouse-a'],
    restrictions: [],
    conditions: ['clear'],
  },
  conversationHistory: ['hello'],
};

const sampleAlternatives: AlternativeConsidered[] = [
  { action: 'wait', reason: 'battery low', rejectionReason: 'not low enough', confidence: 0.3 },
];

const sampleSafety: DecisionSafetyFactors = {
  classification: 'safe',
  warnings: [],
  constraints: ['max speed 1m/s'],
  riskLevel: 0.1,
};

function makeRow(overrides: Partial<PrismaDecision> = {}): PrismaDecision {
  return {
    id: 'dec-1',
    decisionType: 'command_interpretation',
    entityId: 'cmd-1',
    robotId: 'robot-1',
    inputFactors: JSON.stringify(sampleInputFactors),
    reasoning: JSON.stringify(['step a', 'step b']),
    modelUsed: 'gemini-2.5-flash',
    confidence: 0.92,
    alternatives: JSON.stringify(sampleAlternatives),
    safetyFactors: JSON.stringify(sampleSafety),
    createdAt: new Date('2026-06-22T00:00:00.000Z'),
    ...overrides,
  } as PrismaDecision;
}

let repo: DecisionRepository;

beforeEach(() => {
  vi.clearAllMocks();
  repo = new DecisionRepository();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('findById', () => {
  it('queries by id and maps the row to a domain object', async () => {
    prisma.decision.findUnique.mockResolvedValue(makeRow());

    const result = await repo.findById('dec-1');

    expect(prisma.decision.findUnique).toHaveBeenCalledWith({
      where: { id: 'dec-1' },
    });
    expect(result).toEqual({
      id: 'dec-1',
      decisionType: 'command_interpretation',
      entityId: 'cmd-1',
      robotId: 'robot-1',
      inputFactors: sampleInputFactors,
      reasoning: ['step a', 'step b'],
      modelUsed: 'gemini-2.5-flash',
      confidence: 0.92,
      alternatives: sampleAlternatives,
      safetyFactors: sampleSafety,
      createdAt: '2026-06-22T00:00:00.000Z',
    });
  });

  it('returns null when no row is found', async () => {
    prisma.decision.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByEntityId
// ---------------------------------------------------------------------------

describe('findByEntityId', () => {
  it('queries by entityId, orders by createdAt desc and maps the row', async () => {
    prisma.decision.findFirst.mockResolvedValue(makeRow({ entityId: 'cmd-9' }));

    const result = await repo.findByEntityId('cmd-9');

    expect(prisma.decision.findFirst).toHaveBeenCalledWith({
      where: { entityId: 'cmd-9' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result?.entityId).toBe('cmd-9');
    expect(result?.reasoning).toEqual(['step a', 'step b']);
  });

  it('returns null when no row matches', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);

    const result = await repo.findByEntityId('nope');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('findAll', () => {
  it('uses default pagination and empty where when no params given', async () => {
    prisma.decision.findMany.mockResolvedValue([makeRow()]);
    prisma.decision.count.mockResolvedValue(1);

    const result = await repo.findAll();

    expect(prisma.decision.findMany).toHaveBeenCalledWith({
      where: {},
      skip: 0,
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.decision.count).toHaveBeenCalledWith({ where: {} });
    expect(result.decisions).toHaveLength(1);
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
    });
  });

  it('builds where with robotId, decisionType and date range, and computes skip', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.decision.count.mockResolvedValue(120);

    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-02-01T00:00:00.000Z');

    const result = await repo.findAll({
      page: 3,
      pageSize: 20,
      robotId: 'robot-7',
      decisionType: 'safety_action',
      startDate: start,
      endDate: end,
    });

    const expectedWhere = {
      robotId: 'robot-7',
      decisionType: 'safety_action',
      createdAt: { gte: start, lte: end },
    };
    expect(prisma.decision.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      skip: 40, // (3-1)*20
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.decision.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.pagination).toEqual({
      page: 3,
      pageSize: 20,
      total: 120,
      totalPages: 6, // ceil(120/20)
    });
    expect(result.decisions).toEqual([]);
  });

  it('sets only gte when startDate provided without endDate', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.decision.count.mockResolvedValue(0);

    const start = new Date('2026-03-01T00:00:00.000Z');
    await repo.findAll({ startDate: start });

    expect(prisma.decision.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: start } },
      skip: 0,
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('sets only lte when endDate provided without startDate', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.decision.count.mockResolvedValue(0);

    const end = new Date('2026-03-31T00:00:00.000Z');
    await repo.findAll({ endDate: end });

    expect(prisma.decision.findMany).toHaveBeenCalledWith({
      where: { createdAt: { lte: end } },
      skip: 0,
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  });
});

// ---------------------------------------------------------------------------
// findByRobotId — delegates to findAll with robotId merged in
// ---------------------------------------------------------------------------

describe('findByRobotId', () => {
  it('delegates to findAll forcing the robotId filter', async () => {
    prisma.decision.findMany.mockResolvedValue([makeRow({ robotId: 'robot-3' })]);
    prisma.decision.count.mockResolvedValue(1);

    const result = await repo.findByRobotId('robot-3', { page: 2, pageSize: 10 });

    expect(prisma.decision.findMany).toHaveBeenCalledWith({
      where: { robotId: 'robot-3' },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.decisions[0].robotId).toBe('robot-3');
    expect(result.pagination.page).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('create', () => {
  it('JSON-stringifies the structured fields and maps the created row back', async () => {
    const created = makeRow({ id: 'dec-new', confidence: 0.5 });
    prisma.decision.create.mockResolvedValue(created);

    const input: CreateDecisionInput = {
      decisionType: 'task_execution',
      entityId: 'task-1',
      robotId: 'robot-1',
      inputFactors: sampleInputFactors,
      reasoning: ['r1'],
      modelUsed: 'gemini-2.5-flash',
      confidence: 0.5,
      alternatives: sampleAlternatives,
      safetyFactors: sampleSafety,
    };

    const result = await repo.create(input);

    expect(prisma.decision.create).toHaveBeenCalledWith({
      data: {
        decisionType: 'task_execution',
        entityId: 'task-1',
        robotId: 'robot-1',
        inputFactors: JSON.stringify(sampleInputFactors),
        reasoning: JSON.stringify(['r1']),
        modelUsed: 'gemini-2.5-flash',
        confidence: 0.5,
        alternatives: JSON.stringify(sampleAlternatives),
        safetyFactors: JSON.stringify(sampleSafety),
      },
    });
    expect(result.id).toBe('dec-new');
    expect(result.confidence).toBe(0.5);
    // mapping back ran for real on the row returned by prisma
    expect(result.inputFactors).toEqual(sampleInputFactors);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('delete', () => {
  it('returns true when the delete succeeds', async () => {
    prisma.decision.delete.mockResolvedValue(makeRow());

    const result = await repo.delete('dec-1');

    expect(prisma.decision.delete).toHaveBeenCalledWith({ where: { id: 'dec-1' } });
    expect(result).toBe(true);
  });

  it('returns false (swallows error) when prisma throws', async () => {
    prisma.decision.delete.mockRejectedValue(new Error('record not found'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

describe('count', () => {
  it('counts with an empty where when no params', async () => {
    prisma.decision.count.mockResolvedValue(7);

    const result = await repo.count();

    expect(prisma.decision.count).toHaveBeenCalledWith({ where: {} });
    expect(result).toBe(7);
  });

  it('counts with robotId and decisionType filters', async () => {
    prisma.decision.count.mockResolvedValue(3);

    const result = await repo.count({ robotId: 'robot-1', decisionType: 'safety_action' });

    expect(prisma.decision.count).toHaveBeenCalledWith({
      where: { robotId: 'robot-1', decisionType: 'safety_action' },
    });
    expect(result).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getMetrics
// ---------------------------------------------------------------------------

describe('getMetrics', () => {
  it('returns zeroed metrics when there are no decisions in the window', async () => {
    prisma.decision.findMany.mockResolvedValue([]);

    const result = await repo.getMetrics('weekly');

    // The where filter uses a createdAt range with gte/lte.
    const call = prisma.decision.findMany.mock.calls[0][0] as {
      where: { createdAt: { gte: Date; lte: Date } };
    };
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    expect(call.where.createdAt.lte).toBeInstanceOf(Date);
    // weekly window is 7 days
    const diffMs = call.where.createdAt.lte.getTime() - call.where.createdAt.gte.getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);

    expect(result).toMatchObject({
      period: 'weekly',
      totalDecisions: 0,
      accuracy: 0,
      precision: 0,
      recall: 0,
      errorRate: 0,
      driftIndicator: 0,
      avgConfidence: 0,
      safetyDistribution: { safe: 0, caution: 0, dangerous: 0 },
    });
  });

  it('adds robotId to the where filter when provided', async () => {
    prisma.decision.findMany.mockResolvedValue([]);

    await repo.getMetrics('daily', 'robot-42');

    const call = prisma.decision.findMany.mock.calls[0][0] as {
      where: { robotId: string; createdAt: { gte: Date; lte: Date } };
    };
    expect(call.where.robotId).toBe('robot-42');
    // daily window is 24h
    const diffMs = call.where.createdAt.lte.getTime() - call.where.createdAt.gte.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });

  it('uses a 30-day window for the monthly period', async () => {
    prisma.decision.findMany.mockResolvedValue([]);

    await repo.getMetrics('monthly');

    const call = prisma.decision.findMany.mock.calls[0][0] as {
      where: { createdAt: { gte: Date; lte: Date } };
    };
    const diffMs = call.where.createdAt.lte.getTime() - call.where.createdAt.gte.getTime();
    expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('computes accuracy/confidence/drift and safety distribution from rows', async () => {
    // Two high-confidence (>=0.7) and one low; mixed safety classifications.
    const rows: PrismaDecision[] = [
      makeRow({
        id: 'a',
        confidence: 0.9,
        safetyFactors: JSON.stringify({ ...sampleSafety, classification: 'safe' }),
      }),
      makeRow({
        id: 'b',
        confidence: 0.8,
        safetyFactors: JSON.stringify({ ...sampleSafety, classification: 'caution' }),
      }),
      makeRow({
        id: 'c',
        confidence: 0.4,
        safetyFactors: JSON.stringify({ ...sampleSafety, classification: 'dangerous' }),
      }),
    ];
    prisma.decision.findMany.mockResolvedValue(rows);

    const result = await repo.getMetrics('daily');

    expect(result.totalDecisions).toBe(3);
    // avgConfidence = (0.9+0.8+0.4)/3 = 0.7
    expect(result.avgConfidence).toBeCloseTo(0.7, 10);
    // highConfidenceCount = 2 (0.9, 0.8) => accuracy = 2/3
    expect(result.accuracy).toBeCloseTo(2 / 3, 10);
    expect(result.precision).toBeCloseTo(2 / 3, 10);
    expect(result.recall).toBeCloseTo(2 / 3, 10);
    expect(result.errorRate).toBeCloseTo(1 - 2 / 3, 10);
    // drift = |0.7 - 0.8| = 0.1, scaled => min(0.2, 1) = 0.2
    expect(result.driftIndicator).toBeCloseTo(0.2, 10);
    expect(result.safetyDistribution).toEqual({ safe: 1, caution: 1, dangerous: 1 });
  });

  it('ignores unknown safety classifications in the distribution', async () => {
    const rows: PrismaDecision[] = [
      makeRow({
        id: 'x',
        confidence: 0.9,
        // classification not one of safe/caution/dangerous
        safetyFactors: JSON.stringify({ ...sampleSafety, classification: 'unknown' }),
      }),
    ];
    prisma.decision.findMany.mockResolvedValue(rows);

    const result = await repo.getMetrics('daily');

    expect(result.totalDecisions).toBe(1);
    expect(result.safetyDistribution).toEqual({ safe: 0, caution: 0, dangerous: 0 });
  });
});

// ---------------------------------------------------------------------------
// Exported singleton shares the mocked prisma
// ---------------------------------------------------------------------------

describe('decisionRepository singleton', () => {
  it('is an instance of DecisionRepository and uses the mocked prisma', async () => {
    expect(decisionRepository).toBeInstanceOf(DecisionRepository);
    prisma.decision.findUnique.mockResolvedValue(makeRow());

    const result = await decisionRepository.findById('dec-1');

    expect(result?.id).toBe('dec-1');
  });
});
