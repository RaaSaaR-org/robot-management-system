/**
 * @file experimentRules.test.ts
 * @description The one-axis rule, the budget, and the sampling-noise rule of
 *   the experiment loop (TASK-242), tested as arithmetic.
 * @feature training
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  armDifferences,
  oneAxisViolation,
  readBudget,
  budgetViolation,
  criticalZ,
  inverseNormalCdf,
  compareToBaseline,
  buildVerdict,
  type ArmShape,
} from '../experimentRules.js';
import type { ArmResult } from '../../types/experiment.types.js';

const base: ArmShape = {
  name: 'baseline',
  datasetRefs: [{ datasetId: 'ds-full' }],
  hyperparameters: { learning_rate: 1e-4, batch_size: 32 },
};

describe('one axis per arm', () => {
  it('accepts an arm that varies only its data', () => {
    const arm = { ...base, name: 'drop shaky', datasetRefs: [{ datasetId: 'view-1' }] };
    expect(armDifferences(arm, base)).toEqual(['data (ds-full → view-1)']);
    expect(oneAxisViolation(arm, base)).toBeNull();
  });

  it('accepts an arm that varies only one hyperparameter', () => {
    const arm = { ...base, name: 'lr', hyperparameters: { learning_rate: 1e-5, batch_size: 32 } };
    expect(oneAxisViolation(arm, base)).toBeNull();
  });

  it('rejects an arm differing in data and learning rate, naming both', () => {
    const arm = { ...base, name: 'both', datasetRefs: [{ datasetId: 'view-1' }], hyperparameters: { learning_rate: 1e-5, batch_size: 32 } };
    const msg = oneAxisViolation(arm, base)!;
    expect(msg).toContain('both data (ds-full → view-1) and learning_rate (0.0001 → 0.00001)');
  });

  it('treats two hyperparameters as two axes', () => {
    const arm = { ...base, name: 'two', hyperparameters: { learning_rate: 1e-5, batch_size: 64 } };
    expect(oneAxisViolation(arm, base)).toContain('batch_size');
  });

  it('rejects an arm identical to the baseline', () => {
    expect(oneAxisViolation({ ...base, name: 'copy' }, base)).toContain('identical to the baseline');
  });

  it('ignores mixture order but not weights', () => {
    const b2: ArmShape = { name: 'b', datasetRefs: [{ datasetId: 'a' }, { datasetId: 'b' }] };
    expect(armDifferences({ name: 'x', datasetRefs: [{ datasetId: 'b' }, { datasetId: 'a', weight: 1 }] }, b2)).toEqual([]);
    expect(armDifferences({ name: 'x', datasetRefs: [{ datasetId: 'b' }, { datasetId: 'a', weight: 2 }] }, b2)).toHaveLength(1);
  });

  it('counts the starting model as an axis', () => {
    expect(armDifferences({ ...base, name: 'init', initFromModelVersionId: 'mv-1' }, base)).toEqual([
      'starting model (foundation weights → mv-1)',
    ]);
  });
});

describe('budget', () => {
  afterEach(() => {
    delete process.env.EXPERIMENT_MAX_GPU_HOURS;
  });

  it('fills defaults and refuses malformed values', () => {
    expect(readBudget(undefined)).toEqual({ maxArms: 4, maxGpuHours: 24, gpuHoursPerArm: 4 });
    expect(() => readBudget({ maxArms: 0 })).toThrow('maxArms');
    expect(() => readBudget({ maxArms: 2.5 })).toThrow('whole number');
  });

  it('enforces arm count, GPU hours and the platform ceilings', () => {
    expect(budgetViolation({ maxArms: 3, maxGpuHours: 12, gpuHoursPerArm: 4 }, 3)).toBeNull();
    expect(budgetViolation({ maxArms: 2, maxGpuHours: 12, gpuHoursPerArm: 4 }, 3)).toContain('exceed the budget of 2');
    expect(budgetViolation({ maxArms: 4, maxGpuHours: 10, gpuHoursPerArm: 4 }, 3)).toContain('12 GPU hours, over the budget of 10');
    expect(budgetViolation({ maxArms: 9, maxGpuHours: 10, gpuHoursPerArm: 1 }, 3)).toContain('platform limit of 8');
    process.env.EXPERIMENT_MAX_GPU_HOURS = '8';
    expect(budgetViolation({ maxArms: 4, maxGpuHours: 10, gpuHoursPerArm: 1 }, 3)).toContain('platform limit of 8 GPU hours');
  });
});

describe('the noise rule', () => {
  it('inverts the normal CDF', () => {
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.95996, 4);
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 8);
    expect(inverseNormalCdf(0.005)).toBeCloseTo(-2.5758, 3);
  });

  it('corrects the critical value for the number of comparisons', () => {
    expect(criticalZ(1)).toBeCloseTo(1.96, 2);
    expect(criticalZ(2)).toBeCloseTo(2.241, 2);
    expect(criticalZ(3)).toBeCloseTo(2.394, 2);
  });

  // [arm s, arm n, base s, base n, comparisons, expected direction]
  const table: Array<[number, number, number, number, number, string]> = [
    [11, 12, 8, 12, 1, 'within_noise'], //   +25 pts from 12 rollouts: noise
    [280, 400, 240, 400, 1, 'better'], //    +10 pts from 400: real
    [240, 400, 280, 400, 1, 'worse'],
    [44, 50, 35, 50, 1, 'better'], //        z = 2.21 > 1.96
    [44, 50, 35, 50, 2, 'within_noise'], //  same data, 2 arms: z 2.21 < 2.24
    [9, 9, 1, 9, 1, 'too_few_episodes'], //  below the 10-rollout floor
    [50, 50, 50, 50, 1, 'within_noise'], //  SE 0, delta 0
    [0, 20, 0, 20, 1, 'within_noise'],
    [20, 20, 0, 20, 1, 'better'],
  ];

  it.each(table)('%i/%i vs baseline %i/%i over %i comparison(s) → %s', (as, an, bs, bn, k, expected) => {
    const r = compareToBaseline({ successCount: as, episodeCount: an }, { successCount: bs, episodeCount: bn }, criticalZ(k));
    expect(r.direction).toBe(expected);
    expect(r.episodeCount).toBe(an);
  });

  it('writes out the arithmetic for the 12-rollout case', () => {
    const r = compareToBaseline({ successCount: 11, episodeCount: 12 }, { successCount: 8, episodeCount: 12 }, 1.96);
    expect(r.delta).toBeCloseTo(0.25, 6);
    expect(r.standardError).toBeCloseTo(Math.sqrt((19 / 24) * (5 / 24) * (2 / 12)), 9);
    expect(r.zScore).toBeCloseTo(1.51, 2);
    expect(r.significant).toBe(false);
  });
});

function result(s: number, n: number): ArmResult {
  return {
    successRate: s / n,
    successCount: s,
    episodeCount: n,
    meanDurationMs: 1000,
    domainGapScore: null,
    evaluationEpisodeIds: [],
    simJobId: 'sim',
    taskPrompt: 't',
  };
}

describe('buildVerdict', () => {
  const now = new Date('2026-09-30T00:00:00Z');

  it('names no winner within noise, and says so with the counts', () => {
    const v = buildVerdict({ id: 'b', name: 'full', result: result(8, 12) }, [{ id: 'a', name: 'lr', result: result(11, 12) }], now);
    expect(v.winnerArmId).toBeNull();
    expect(v.confidenceNote).toContain('No winner');
    expect(v.confidenceNote).toContain('8/12');
    expect(v.confidenceNote).toContain('11/12');
    expect(v.deltas[0].episodeCount).toBe(12);
  });

  it('names the best significantly better arm', () => {
    const v = buildVerdict(
      { id: 'b', name: 'full', result: result(240, 400) },
      [
        { id: 'a1', name: 'small', result: result(250, 400) },
        { id: 'a2', name: 'big', result: result(300, 400) },
      ],
      now
    );
    expect(v.winnerArmId).toBe('a2');
    expect(v.confidenceNote).toContain('Winner: "big"');
  });

  it('names the baseline when every arm is measurably worse', () => {
    const v = buildVerdict({ id: 'b', name: 'full', result: result(300, 400) }, [{ id: 'a', name: 'x', result: result(200, 400) }], now);
    expect(v.winnerArmId).toBe('b');
  });

  it('concludes with a failed arm left out', () => {
    const v = buildVerdict(
      { id: 'b', name: 'full', result: result(30, 50) },
      [
        { id: 'a', name: 'x', result: result(31, 50) },
        { id: 'f', name: 'broken', result: null },
      ],
      now
    );
    expect(v.failedArmIds).toEqual(['f']);
    expect(v.deltas).toHaveLength(1);
    expect(v.confidenceNote).toContain('1 arm(s) failed');
  });

  it('names no winner when the baseline failed', () => {
    const v = buildVerdict({ id: 'b', name: 'full', result: null }, [{ id: 'a', name: 'x', result: result(31, 50) }], now);
    expect(v.winnerArmId).toBeNull();
    expect(v.failedArmIds).toEqual(['b']);
  });
});
