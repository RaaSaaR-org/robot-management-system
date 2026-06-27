/**
 * @file SimToRealValidationService.test.ts
 * @description Unit tests for the sim-to-real validation gate (TASK-171 Phase 3):
 *   domain-gap math (sim − real), derivation of the real success rate from
 *   recorded EvaluationEpisodes, and comparison-row mapping. Prisma + the
 *   EvaluationService are mocked; the gap math runs for real.
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the row passed to create so we can assert the computed gap.
const createMock = vi.fn();
const findFirstMock = vi.fn();
const findManyMock = vi.fn();
vi.mock('../../database/index.js', () => ({
  prisma: {
    simToRealValidation: {
      create: (args: { data: Record<string, unknown> }) => createMock(args),
      findFirst: (args: unknown) => findFirstMock(args),
      findMany: (args: unknown) => findManyMock(args),
    },
  },
}));

const getSuccessRateMock = vi.fn();
vi.mock('../EvaluationService.js', () => ({
  evaluationService: {
    getSuccessRate: (...a: unknown[]) => getSuccessRateMock(...a),
  },
}));

import { simToRealValidationService } from '../SimToRealValidationService.js';

beforeEach(() => {
  createMock.mockReset();
  findFirstMock.mockReset();
  findManyMock.mockReset();
  getSuccessRateMock.mockReset();
  // create() echoes the persisted row back with an id + date.
  createMock.mockImplementation(({ data }) => ({
    id: 'val-1',
    validationDate: new Date('2026-06-25T00:00:00.000Z'),
    perTaskMetrics: null,
    ...data,
  }));
});

describe('SimToRealValidationService.createValidation', () => {
  it('computes domainGapScore = sim − real with an explicit real rate', async () => {
    const dto = await simToRealValidationService.createValidation({
      modelVersionId: 'mv-1',
      twinId: 'twin-1',
      simSceneId: 'scene-1',
      embodimentTag: 'g1',
      simSuccessRate: 0.8,
      realSuccessRate: 0.6,
      realTestCount: 7,
    });

    expect(getSuccessRateMock).not.toHaveBeenCalled();
    expect(dto.simSuccessRate).toBe(0.8);
    expect(dto.realSuccessRate).toBe(0.6);
    expect(dto.domainGapScore).toBeCloseTo(0.2, 6);
    expect(dto.twinId).toBe('twin-1');
    // An explicit sample size is honored (not zeroed) when the real rate is given.
    expect(dto.realTestCount).toBe(7);
    // Persisted with no synthetic job (twin-derived validation).
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data.syntheticJobId).toBeNull();
  });

  it('derives the real rate from EvaluationEpisodes when not supplied', async () => {
    // EvaluationService returns a PERCENTAGE (0–100); the service normalises /100.
    getSuccessRateMock.mockResolvedValue({
      successRate: 50,
      totalEpisodes: 8,
      successfulEpisodes: 4,
      period: '30d',
    });

    const dto = await simToRealValidationService.createValidation({
      modelVersionId: 'mv-2',
      modelVersion: 'policy-v3',
      realRobotId: 'robot-7',
      simSuccessRate: 0.9,
    });

    expect(getSuccessRateMock).toHaveBeenCalledWith('robot-7', 'policy-v3', '30d');
    expect(dto.realSuccessRate).toBe(0.5);
    expect(dto.realTestCount).toBe(8);
    expect(dto.domainGapScore).toBeCloseTo(0.4, 6);
  });

  it('clamps rates into [0,1]', async () => {
    const dto = await simToRealValidationService.createValidation({
      modelVersionId: 'mv-3',
      simSuccessRate: 1.5,
      realSuccessRate: -0.2,
    });
    expect(dto.simSuccessRate).toBe(1);
    expect(dto.realSuccessRate).toBe(0);
    expect(dto.domainGapScore).toBe(1);
  });

  it('stores null real-rate + null gap for a sim-only validation (TASK-172.C)', async () => {
    const dto = await simToRealValidationService.createValidation({
      modelVersionId: 'mv-rl',
      simSceneId: 'scene-1',
      embodimentTag: 'g1',
      simSuccessRate: 0.72,
      simOnly: true,
    });

    // No real-rate derive; gap is undefined (null), not fabricated.
    expect(getSuccessRateMock).not.toHaveBeenCalled();
    expect(dto.simSuccessRate).toBe(0.72);
    expect(dto.realSuccessRate).toBeNull();
    expect(dto.domainGapScore).toBeNull();
    expect(createMock.mock.calls[0][0].data.realSuccessRate).toBeNull();
    expect(createMock.mock.calls[0][0].data.domainGapScore).toBeNull();
  });
});

describe('SimToRealValidationService.getComparisonForModel', () => {
  it('maps persisted validations to comparison rows (the real gap)', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'v1',
        modelVersionId: 'mv-1',
        twinId: 'twin-1',
        simSceneId: 'scene-1',
        embodimentTag: 'g1',
        validationDate: new Date('2026-06-25T00:00:00.000Z'),
        simSuccessRate: 0.8,
        realSuccessRate: 0.6,
        domainGapScore: 0.2,
        realTestCount: 5,
        taskCategories: [],
        notes: null,
      },
    ]);

    const rows = await simToRealValidationService.getComparisonForModel('mv-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelId: 'mv-1',
      simSuccessRate: 0.8,
      realSuccessRate: 0.6,
      gap: 0.2,
      twinId: 'twin-1',
      realTestCount: 5,
    });
  });

  it('returns an empty array when the model has no validations', async () => {
    findManyMock.mockResolvedValue([]);
    await expect(simToRealValidationService.getComparisonForModel('nope')).resolves.toEqual([]);
  });
});

describe('SimToRealValidationService.getLatestForModelVersion', () => {
  it('returns null when there is no validation', async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(simToRealValidationService.getLatestForModelVersion('mv-x')).resolves.toBeNull();
  });
});
