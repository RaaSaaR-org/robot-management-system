/**
 * @file ActiveLearningService.test.ts
 * @description Unit tests for ActiveLearningService — prediction logging, uncertainty analysis,
 *   learning progress, MUSEL-inspired collection priorities, collection targets, diversity, and config.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client (the service does `new PrismaClient()`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    predictionLog: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    collectionTarget: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    predictionLog = mockPrisma.predictionLog;
    collectionTarget = mockPrisma.collectionTarget;
  },
}));

import {
  ActiveLearningService,
  activeLearningService,
} from '../ActiveLearningService.js';
import {
  DEFAULT_SCORING_CONFIG,
  DEFAULT_PRIORITY_WEIGHTS,
} from '../../types/active-learning.types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    modelId: 'm1',
    robotId: 'r1',
    inputHash: 'hash-1',
    taskCategory: 'pick',
    environment: 'warehouse',
    confidence: 0.8,
    wasCorrect: true,
    metadata: null,
    timestamp: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makeTargetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    targetType: 'task',
    targetName: 'pick',
    priorityScore: 0.6,
    estimatedDemos: 50,
    collectedDemos: 0,
    status: 'active',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset config to defaults (singleton holds in-memory config)
  activeLearningService.updateConfig({ ...DEFAULT_SCORING_CONFIG });
});

// ===========================================================================
// getInstance / singleton
// ===========================================================================

describe('getInstance', () => {
  it('returns the same singleton instance', () => {
    expect(ActiveLearningService.getInstance()).toBe(activeLearningService);
    expect(ActiveLearningService.getInstance()).toBe(
      ActiveLearningService.getInstance()
    );
  });
});

// ===========================================================================
// logPrediction
// ===========================================================================

describe('logPrediction', () => {
  it('creates a prediction log and emits a prediction:logged event', async () => {
    const row = makeLogRow();
    mockPrisma.predictionLog.create.mockResolvedValue(row);
    const events: unknown[] = [];
    activeLearningService.once('prediction:logged', (e) => events.push(e));

    const result = await activeLearningService.logPrediction({
      modelId: 'm1',
      robotId: 'r1',
      inputHash: 'hash-1',
      taskCategory: 'pick',
      environment: 'warehouse',
      confidence: 0.8,
      wasCorrect: true,
    });

    expect(result.id).toBe('log-1');
    expect(result.confidence).toBe(0.8);
    expect(result.wasCorrect).toBe(true);
    expect(mockPrisma.predictionLog.create).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('serializes metadata via JSON when present', async () => {
    mockPrisma.predictionLog.create.mockResolvedValue(
      makeLogRow({ metadata: { foo: 'bar' } })
    );

    const result = await activeLearningService.logPrediction({
      modelId: 'm1',
      robotId: 'r1',
      inputHash: 'h',
      taskCategory: 'pick',
      environment: 'warehouse',
      confidence: 0.5,
      metadata: { foo: 'bar' },
    });

    const callArg = mockPrisma.predictionLog.create.mock.calls[0][0] as {
      data: { metadata: unknown };
    };
    expect(callArg.data.metadata).toEqual({ foo: 'bar' });
    expect(result.metadata).toEqual({ foo: 'bar' });
  });

  it('maps null wasCorrect to undefined', async () => {
    mockPrisma.predictionLog.create.mockResolvedValue(
      makeLogRow({ wasCorrect: null })
    );
    const result = await activeLearningService.logPrediction({
      modelId: 'm1',
      robotId: 'r1',
      inputHash: 'h',
      taskCategory: 'pick',
      environment: 'warehouse',
      confidence: 0.5,
    });
    expect(result.wasCorrect).toBeUndefined();
  });

  it('propagates database errors', async () => {
    mockPrisma.predictionLog.create.mockRejectedValue(new Error('db down'));
    await expect(
      activeLearningService.logPrediction({
        modelId: 'm1',
        robotId: 'r1',
        inputHash: 'h',
        taskCategory: 'pick',
        environment: 'warehouse',
        confidence: 0.5,
      })
    ).rejects.toThrow('db down');
  });
});

// ===========================================================================
// logPredictionsBatch
// ===========================================================================

describe('logPredictionsBatch', () => {
  it('createMany then fetches recent logs for the involved models', async () => {
    mockPrisma.predictionLog.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.predictionLog.findMany.mockResolvedValue([
      makeLogRow({ id: 'a' }),
      makeLogRow({ id: 'b', modelId: 'm2' }),
    ]);

    const result = await activeLearningService.logPredictionsBatch([
      {
        modelId: 'm1',
        robotId: 'r1',
        inputHash: 'h1',
        taskCategory: 'pick',
        environment: 'warehouse',
        confidence: 0.7,
      },
      {
        modelId: 'm2',
        robotId: 'r2',
        inputHash: 'h2',
        taskCategory: 'place',
        environment: 'lab',
        confidence: 0.9,
      },
    ]);

    expect(mockPrisma.predictionLog.createMany).toHaveBeenCalledTimes(1);
    const findArg = mockPrisma.predictionLog.findMany.mock.calls[0][0] as {
      where: { modelId: { in: string[] } };
      take: number;
    };
    expect(findArg.where.modelId.in.sort()).toEqual(['m1', 'm2']);
    expect(findArg.take).toBe(2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('handles an empty batch', async () => {
    mockPrisma.predictionLog.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.predictionLog.findMany.mockResolvedValue([]);
    const result = await activeLearningService.logPredictionsBatch([]);
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// getPredictionLogs
// ===========================================================================

describe('getPredictionLogs', () => {
  it('queries by modelId only when no options are given', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([makeLogRow()]);
    const result = await activeLearningService.getPredictionLogs('m1');

    const arg = mockPrisma.predictionLog.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      take: number | undefined;
    };
    expect(arg.where).toEqual({ modelId: 'm1' });
    expect(arg.take).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  it('builds confidence/date/category filters from options', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([]);
    const start = new Date('2026-01-01');
    const end = new Date('2026-02-01');
    await activeLearningService.getPredictionLogs('m1', {
      limit: 5,
      taskCategory: 'pick',
      environment: 'warehouse',
      minConfidence: 0.2,
      maxConfidence: 0.9,
      startDate: start,
      endDate: end,
    });

    const arg = mockPrisma.predictionLog.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(arg.where).toMatchObject({
      modelId: 'm1',
      taskCategory: 'pick',
      environment: 'warehouse',
      confidence: { gte: 0.2, lte: 0.9 },
      timestamp: { gte: start, lte: end },
    });
    expect(arg.take).toBe(5);
  });
});

// ===========================================================================
// computeUncertaintyAnalysis
// ===========================================================================

describe('computeUncertaintyAnalysis', () => {
  it('returns neutral overall uncertainty when there are no logs', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([]);
    const analysis = await activeLearningService.computeUncertaintyAnalysis('m1');

    expect(analysis.modelId).toBe('m1');
    expect(analysis.totalPredictions).toBe(0);
    expect(analysis.overallUncertainty).toBe(0.5);
    expect(analysis.byTask).toEqual({});
    expect(analysis.byEnvironment).toEqual({});
    expect(analysis.highUncertaintyThreshold).toBe(
      DEFAULT_SCORING_CONFIG.highUncertaintyThreshold
    );
  });

  it('groups by task and environment and computes mean uncertainty', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([
      makeLogRow({ id: '1', taskCategory: 'pick', environment: 'lab', confidence: 0.8 }),
      makeLogRow({ id: '2', taskCategory: 'pick', environment: 'lab', confidence: 0.6 }),
      makeLogRow({ id: '3', taskCategory: 'place', environment: 'home', confidence: 0.2 }),
    ]);

    const analysis = await activeLearningService.computeUncertaintyAnalysis('m1', 7);

    expect(analysis.totalPredictions).toBe(3);
    // overall uncertainty = 1 - mean(0.8,0.6,0.2) = 1 - 0.5333... = 0.4667
    expect(analysis.overallUncertainty).toBeCloseTo(1 - (0.8 + 0.6 + 0.2) / 3, 5);
    // pick group: mean uncertainty = 1 - mean(0.8,0.6) = 0.3
    const pick = analysis.byTask['pick'];
    expect(pick.sampleCount).toBe(2);
    expect(pick.meanUncertainty).toBeCloseTo(0.3, 5);
    expect(analysis.byEnvironment['lab'].sampleCount).toBe(2);
    expect(analysis.byEnvironment['home'].sampleCount).toBe(1);
  });

  it('counts high-uncertainty predictions using the configured threshold', async () => {
    // threshold default 0.3 => high uncertainty when confidence < 0.7
    mockPrisma.predictionLog.findMany.mockResolvedValue([
      makeLogRow({ id: '1', confidence: 0.9 }), // not high
      makeLogRow({ id: '2', confidence: 0.5 }), // high
      makeLogRow({ id: '3', confidence: 0.1 }), // high
    ]);
    const analysis = await activeLearningService.computeUncertaintyAnalysis('m1');
    expect(analysis.highUncertaintyCount).toBe(2);
  });

  it('emits an uncertainty:analyzed event', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([]);
    const cb = vi.fn();
    activeLearningService.once('uncertainty:analyzed', cb);
    await activeLearningService.computeUncertaintyAnalysis('m1');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// computeLearningProgress
// ===========================================================================

describe('computeLearningProgress', () => {
  it('returns neutral defaults below minSamplesForAnalysis', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([
      makeLogRow(),
      makeLogRow(),
    ]); // 2 < default 10
    const progress = await activeLearningService.computeLearningProgress('m1', 'pick');
    expect(progress.improvementRate).toBe(0);
    expect(progress.currentPerformance).toBe(0.5);
    expect(progress.previousPerformance).toBe(0.5);
    expect(progress.isPlateaued).toBe(false);
  });

  it('computes improvement between older and recent halves', async () => {
    // 10 logs: first half low confidence (0.3), second half high (0.9)
    const logs = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeLogRow({ id: `old-${i}`, confidence: 0.3 })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeLogRow({ id: `new-${i}`, confidence: 0.9 })
      ),
    ];
    mockPrisma.predictionLog.findMany.mockResolvedValue(logs);

    const progress = await activeLearningService.computeLearningProgress('m1', 'pick');
    expect(progress.previousPerformance).toBeCloseTo(0.3, 5);
    expect(progress.currentPerformance).toBeCloseTo(0.9, 5);
    expect(progress.improvementRate).toBeCloseTo(0.6, 5);
    expect(progress.isPlateaued).toBe(false);
  });

  it('flags a plateau when improvement is below the plateau threshold', async () => {
    const logs = Array.from({ length: 10 }, (_, i) =>
      makeLogRow({ id: `p-${i}`, confidence: 0.7 })
    );
    mockPrisma.predictionLog.findMany.mockResolvedValue(logs);

    const progress = await activeLearningService.computeLearningProgress('m1', 'pick', 14);
    expect(progress.improvementRate).toBeCloseTo(0, 5);
    expect(progress.isPlateaued).toBe(true);
    expect(progress.plateauDuration).toBe(14);
  });
});

// ===========================================================================
// identifyPlateaus
// ===========================================================================

describe('identifyPlateaus', () => {
  it('returns only the tasks whose progress is plateaued', async () => {
    // First findMany: distinct task categories
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([
      { taskCategory: 'pick' },
      { taskCategory: 'place' },
    ]);
    // computeLearningProgress for 'pick' => plateaued (constant confidence)
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => makeLogRow({ id: `pk-${i}`, confidence: 0.7 }))
    );
    // computeLearningProgress for 'place' => improving, not plateaued
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([
      ...Array.from({ length: 5 }, (_, i) => makeLogRow({ id: `o-${i}`, confidence: 0.2 })),
      ...Array.from({ length: 5 }, (_, i) => makeLogRow({ id: `n-${i}`, confidence: 0.95 })),
    ]);

    const plateaus = await activeLearningService.identifyPlateaus('m1');
    expect(plateaus).toHaveLength(1);
    expect(plateaus[0].task).toBe('pick');
    expect(plateaus[0].isPlateaued).toBe(true);
  });

  it('returns empty when there are no tasks', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([]);
    const plateaus = await activeLearningService.identifyPlateaus('m1');
    expect(plateaus).toEqual([]);
  });
});

// ===========================================================================
// computeCollectionPriorities
// ===========================================================================

describe('computeCollectionPriorities', () => {
  it('produces sorted priorities and a summary, emitting priorities:updated', async () => {
    // computeUncertaintyAnalysis -> findMany (recent logs window)
    mockPrisma.predictionLog.findMany.mockResolvedValue([
      makeLogRow({ id: '1', taskCategory: 'pick', environment: 'lab', confidence: 0.2 }),
      makeLogRow({ id: '2', taskCategory: 'pick', environment: 'lab', confidence: 0.3 }),
    ]);

    const cb = vi.fn();
    activeLearningService.once('priorities:updated', cb);

    const response = await activeLearningService.computeCollectionPriorities('m1');

    expect(response.modelId).toBe('m1');
    expect(response.priorities.length).toBeGreaterThan(0);
    // sorted descending by priorityScore
    for (let i = 1; i < response.priorities.length; i++) {
      expect(response.priorities[i - 1].priorityScore).toBeGreaterThanOrEqual(
        response.priorities[i].priorityScore
      );
    }
    expect(response.summary.totalTargets).toBe(response.priorities.length);
    expect(response.summary.topRecommendation).toBe(response.priorities[0].recommendation);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('reports no targets when there are no logs', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValue([]);
    const response = await activeLearningService.computeCollectionPriorities(
      'm1',
      DEFAULT_PRIORITY_WEIGHTS
    );
    expect(response.priorities).toEqual([]);
    expect(response.summary.totalTargets).toBe(0);
    expect(response.summary.topRecommendation).toBe('No collection targets identified');
  });
});

// ===========================================================================
// createCollectionTarget
// ===========================================================================

describe('createCollectionTarget', () => {
  it('creates an active target with defaulted priority and emits target:created', async () => {
    mockPrisma.collectionTarget.create.mockResolvedValue(makeTargetRow());
    const cb = vi.fn();
    activeLearningService.once('target:created', cb);

    const target = await activeLearningService.createCollectionTarget('task', 'pick', 50);

    expect(target.status).toBe('active');
    expect(target.targetName).toBe('pick');
    const arg = mockPrisma.collectionTarget.create.mock.calls[0][0] as {
      data: { priorityScore: number; status: string; collectedDemos: number };
    };
    expect(arg.data.priorityScore).toBe(0.5);
    expect(arg.data.collectedDemos).toBe(0);
    expect(arg.data.status).toBe('active');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('uses the provided priority score', async () => {
    mockPrisma.collectionTarget.create.mockResolvedValue(
      makeTargetRow({ priorityScore: 0.9 })
    );
    await activeLearningService.createCollectionTarget('environment', 'lab', 20, 0.9);
    const arg = mockPrisma.collectionTarget.create.mock.calls[0][0] as {
      data: { priorityScore: number };
    };
    expect(arg.data.priorityScore).toBe(0.9);
  });
});

// ===========================================================================
// getCollectionTarget
// ===========================================================================

describe('getCollectionTarget', () => {
  it('returns the mapped target when found', async () => {
    mockPrisma.collectionTarget.findUnique.mockResolvedValue(makeTargetRow());
    const target = await activeLearningService.getCollectionTarget('t1');
    expect(target?.id).toBe('t1');
  });

  it('returns undefined when not found', async () => {
    mockPrisma.collectionTarget.findUnique.mockResolvedValue(null);
    const target = await activeLearningService.getCollectionTarget('nope');
    expect(target).toBeUndefined();
  });
});

// ===========================================================================
// listCollectionTargets
// ===========================================================================

describe('listCollectionTargets', () => {
  it('lists with no filters', async () => {
    mockPrisma.collectionTarget.findMany.mockResolvedValue([makeTargetRow()]);
    const result = await activeLearningService.listCollectionTargets();
    const arg = mockPrisma.collectionTarget.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toEqual({});
    expect(result).toHaveLength(1);
  });

  it('applies status, type, and minPriorityScore filters', async () => {
    mockPrisma.collectionTarget.findMany.mockResolvedValue([]);
    await activeLearningService.listCollectionTargets({
      status: 'active',
      targetType: 'task',
      minPriorityScore: 0.5,
    });
    const arg = mockPrisma.collectionTarget.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toEqual({
      status: 'active',
      targetType: 'task',
      priorityScore: { gte: 0.5 },
    });
  });
});

// ===========================================================================
// updateCollectionProgress
// ===========================================================================

describe('updateCollectionProgress', () => {
  it('returns undefined when the target does not exist', async () => {
    mockPrisma.collectionTarget.findUnique.mockResolvedValue(null);
    const result = await activeLearningService.updateCollectionProgress('nope', 5);
    expect(result).toBeUndefined();
    expect(mockPrisma.collectionTarget.update).not.toHaveBeenCalled();
  });

  it('increments demos and keeps status active when below estimate, emitting progress:updated', async () => {
    mockPrisma.collectionTarget.findUnique.mockResolvedValue(
      makeTargetRow({ collectedDemos: 10, estimatedDemos: 50, status: 'active' })
    );
    mockPrisma.collectionTarget.update.mockResolvedValue(
      makeTargetRow({ collectedDemos: 15, estimatedDemos: 50, status: 'active' })
    );
    const cb = vi.fn();
    activeLearningService.once('progress:updated', cb);

    const result = await activeLearningService.updateCollectionProgress('t1', 5);

    const arg = mockPrisma.collectionTarget.update.mock.calls[0][0] as {
      data: { collectedDemos: number; status: string };
    };
    expect(arg.data.collectedDemos).toBe(15);
    expect(arg.data.status).toBe('active');
    expect(result?.status).toBe('active');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('marks completed and emits target:completed when reaching the estimate', async () => {
    mockPrisma.collectionTarget.findUnique.mockResolvedValue(
      makeTargetRow({ collectedDemos: 45, estimatedDemos: 50, status: 'active' })
    );
    mockPrisma.collectionTarget.update.mockResolvedValue(
      makeTargetRow({ collectedDemos: 50, estimatedDemos: 50, status: 'completed' })
    );
    const cb = vi.fn();
    activeLearningService.once('target:completed', cb);

    const result = await activeLearningService.updateCollectionProgress('t1', 5);

    const arg = mockPrisma.collectionTarget.update.mock.calls[0][0] as {
      data: { status: string };
    };
    expect(arg.data.status).toBe('completed');
    expect(result?.status).toBe('completed');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// getProgressSummary
// ===========================================================================

describe('getProgressSummary', () => {
  it('aggregates target counts and overall progress', async () => {
    mockPrisma.collectionTarget.findMany.mockResolvedValue([
      makeTargetRow({ status: 'completed', collectedDemos: 50, estimatedDemos: 50 }),
      makeTargetRow({ status: 'active', collectedDemos: 25, estimatedDemos: 100 }),
    ]);

    const summary = await activeLearningService.getProgressSummary();
    expect(summary.totalTargets).toBe(2);
    expect(summary.completedTargets).toBe(1);
    expect(summary.activeTargets).toBe(1);
    expect(summary.totalDemosCollected).toBe(75);
    expect(summary.totalDemosNeeded).toBe(150);
    expect(summary.overallProgress).toBeCloseTo(0.5, 5);
  });

  it('returns zero progress when there are no targets', async () => {
    mockPrisma.collectionTarget.findMany.mockResolvedValue([]);
    const summary = await activeLearningService.getProgressSummary();
    expect(summary.totalTargets).toBe(0);
    expect(summary.overallProgress).toBe(0);
  });
});

// ===========================================================================
// computeDiversityAnalysis
// ===========================================================================

describe('computeDiversityAnalysis', () => {
  it('computes per-task/env diversity and recommends for low-diversity tasks', async () => {
    // 1: distinct task categories
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([{ taskCategory: 'pick' }]);
    // 2: distinct environments
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([{ environment: 'lab' }]);
    // 3: diversity for task 'pick' -> all duplicate inputHash => low diversity ratio
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([
      makeLogRow({ inputHash: 'same' }),
      makeLogRow({ inputHash: 'same' }),
      makeLogRow({ inputHash: 'same' }),
      makeLogRow({ inputHash: 'same' }),
    ]);
    // 4: diversity for env 'lab' -> all unique => high diversity ratio
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([
      makeLogRow({ inputHash: 'a' }),
      makeLogRow({ inputHash: 'b' }),
    ]);

    const analysis = await activeLearningService.computeDiversityAnalysis('m1');

    expect(analysis.byTask['pick'].diversityRatio).toBeCloseTo(0.25, 5);
    expect(analysis.byEnvironment['lab'].diversityRatio).toBeCloseTo(1, 5);
    // overall = mean(0.25, 1)
    expect(analysis.overallDiversityScore).toBeCloseTo(0.625, 5);
    // low diversity task (<0.3) triggers a recommendation
    expect(analysis.recommendations.some((r) => r.includes('pick'))).toBe(true);
  });

  it('handles a model with no logs', async () => {
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([]); // tasks
    mockPrisma.predictionLog.findMany.mockResolvedValueOnce([]); // envs
    const analysis = await activeLearningService.computeDiversityAnalysis('m1');
    expect(analysis.byTask).toEqual({});
    expect(analysis.byEnvironment).toEqual({});
    expect(analysis.overallDiversityScore).toBe(0);
    expect(analysis.recommendations).toEqual([]);
  });
});

// ===========================================================================
// updateConfig / getConfig
// ===========================================================================

describe('config', () => {
  it('merges partial config (including nested weights) and returns the result', () => {
    const updated = activeLearningService.updateConfig({
      highUncertaintyThreshold: 0.5,
      weights: { uncertainty: 0.6 } as never,
    });
    expect(updated.highUncertaintyThreshold).toBe(0.5);
    expect(updated.weights.uncertainty).toBe(0.6);
    // unspecified weights preserved from defaults
    expect(updated.weights.diversity).toBe(DEFAULT_PRIORITY_WEIGHTS.diversity);

    const current = activeLearningService.getConfig();
    expect(current.highUncertaintyThreshold).toBe(0.5);
  });

  it('getConfig returns a copy, not the internal reference', () => {
    const a = activeLearningService.getConfig();
    const b = activeLearningService.getConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
