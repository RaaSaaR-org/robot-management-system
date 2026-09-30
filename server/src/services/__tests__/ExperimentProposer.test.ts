/**
 * @file ExperimentProposer.test.ts
 * @description The deterministic proposers (TASK-242): data-ablation builds
 *   one reward-band view per arm, lr-sweep varies the learning rate only, and
 *   what they compose passes ExperimentService's one-axis rule.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { ExperimentProposer, type ProposerDeps } from '../ExperimentProposer.js';
import { oneAxisViolation } from '../experimentRules.js';
import type { DatasetSelection } from '../../types/dataset-view.types.js';

vi.mock('../DatasetService.js', () => ({ datasetService: {} }));
vi.mock('../../repositories/EpisodeRewardRepository.js', () => ({ episodeRewardRepository: {} }));

/** Twenty episodes, scores 0.05 … 1.00 — the shape a robometer job leaves behind. */
const SCORES = Array.from({ length: 20 }, (_, i) => ({ episodeIndex: i, score: (i + 1) / 20 }));

function deps(scores = SCORES) {
  const views: Array<{ parent: string; name: string; selection: DatasetSelection }> = [];
  const d: ProposerDeps = {
    rewardScores: vi.fn(async () => scores),
    // The same rule as DatasetService.selectionFromRewards: keep score ≥ minScore.
    selectionFromRewards: vi.fn(async (_id, rewardType, minScore) => ({
      episodes: scores.filter((s) => s.score >= minScore).map((s) => ({ episodeIndex: s.episodeIndex })),
      origin: { kind: 'reward' as const, rewardType, minScore },
    })),
    createView: vi.fn(async (parent, input) => {
      views.push({ parent, name: input.name, selection: input.selection });
      return { id: `view-${views.length}` };
    }),
  };
  return { d, views };
}

const COMMON = {
  baseModel: 'groot_n1_7',
  fineTuneMethod: 'lora',
  evaluation: { environment: 'g1_apple_pnp', rolloutCount: 50 },
};

describe('data-ablation', () => {
  it('makes a full-dataset baseline and one view per low reward band', async () => {
    const { d, views } = deps();
    const input = await new ExperimentProposer(d).compose('data-ablation', { ...COMMON, datasetId: 'ds-1' });
    expect(input.arms.map((a) => a.name)).toEqual(['full dataset', 'drop lowest 10% by robometer', 'drop lowest 25% by robometer']);
    expect(input.arms[0]).toMatchObject({ isBaseline: true, datasetRefs: [{ datasetId: 'ds-1' }] });
    expect(views.map((v) => v.selection.episodes.length)).toEqual([18, 15]);
    expect(views[0].selection.origin).toEqual({ kind: 'reward', rewardType: 'robometer', minScore: 0.15 });
    expect(input.arms[1].datasetRefs).toEqual([{ datasetId: 'view-1' }]);
    for (const arm of input.arms.slice(1)) {
      expect(oneAxisViolation({ ...arm, datasetRefs: arm.datasetRefs }, { ...input.arms[0] })).toBeNull();
    }
  });

  it('skips a band that drops nothing, or the same episodes as a smaller band', async () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({ episodeIndex: i, score: i < 5 ? 0.1 : 0.9 }));
    const { d } = deps(flat);
    const input = await new ExperimentProposer(d).compose('data-ablation', { ...COMMON, datasetId: 'ds-1', bands: [0.1, 0.5, 0.6] });
    expect(input.arms.map((a) => a.name)).toEqual(['full dataset', 'drop lowest 50% by robometer']);
  });

  it('refuses a dataset without reward scores', async () => {
    const { d } = deps([]);
    await expect(new ExperimentProposer(d).compose('data-ablation', { ...COMMON, datasetId: 'ds-1' })).rejects.toThrow('reward-model job');
  });

  it('refuses malformed bands', async () => {
    const { d } = deps();
    await expect(new ExperimentProposer(d).compose('data-ablation', { ...COMMON, datasetId: 'ds-1', bands: [1.5] })).rejects.toThrow('bands');
  });
});

describe('lr-sweep', () => {
  it('varies the learning rate and nothing else', async () => {
    const { d } = deps();
    const input = await new ExperimentProposer(d).compose('lr-sweep', {
      ...COMMON,
      datasetId: 'ds-1',
      hyperparameters: { learning_rate: 1e-4, batch_size: 32 },
    });
    expect(input.arms.map((a) => a.hyperparameters!.learning_rate)).toEqual([1e-4, 3.33e-5, 3e-4]);
    expect(input.arms.every((a) => a.hyperparameters!.batch_size === 32)).toBe(true);
    for (const arm of input.arms.slice(1)) expect(oneAxisViolation(arm, input.arms[0])).toBeNull();
    expect(d.createView).not.toHaveBeenCalled();
  });

  it('refuses a sweep with nothing to sweep', async () => {
    const { d } = deps();
    await expect(
      new ExperimentProposer(d).compose('lr-sweep', { ...COMMON, datasetId: 'ds-1', learningRates: [1e-4] })
    ).rejects.toThrow('nothing to sweep');
  });
});
