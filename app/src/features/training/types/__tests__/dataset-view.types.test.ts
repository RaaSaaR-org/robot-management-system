/**
 * @file dataset-view.types.test.ts
 * @description The selection builders: what they resolve to, and that they
 *              resolve at all rather than storing a rule (TASK-240).
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import {
  describeSelectionOrigin,
  isDatasetView,
  selectionFromEpisodeIndices,
  selectionFromFlags,
  selectionFromRewards,
} from '../dataset-view.types';

describe('selectionFromEpisodeIndices', () => {
  it('sorts and de-duplicates, so click order cannot change the stored JSON', () => {
    const selection = selectionFromEpisodeIndices([7, 1, 7, 3]);
    expect(selection.episodes).toEqual([
      { episodeIndex: 1 },
      { episodeIndex: 3 },
      { episodeIndex: 7 },
    ]);
    expect(selection.origin).toEqual({ kind: 'manual' });
  });

  it('keeps a note on the origin when one was given', () => {
    expect(selectionFromEpisodeIndices([0], 'the two clean grasps').origin).toEqual({
      kind: 'manual',
      note: 'the two clean grasps',
    });
  });
});

describe('selectionFromFlags', () => {
  it('keeps everything an operator did not flag', () => {
    const selection = selectionFromFlags([0, 1, 2, 3], new Set([1, 3]));
    expect(selection.episodes.map((e) => e.episodeIndex)).toEqual([0, 2]);
    expect(selection.origin).toEqual({ kind: 'flags', decision: 'remove' });
  });
});

describe('selectionFromRewards', () => {
  it('resolves the threshold to episode indices, not to the threshold', () => {
    // THE point of the whole feature: re-scoring the dataset tomorrow must not
    // change what this view means. The rule survives as prose in `origin`; the
    // list is the truth.
    const scores = [
      { episodeIndex: 0, score: 0.91, rewardType: 'robometer' },
      { episodeIndex: 1, score: 0.42, rewardType: 'robometer' },
      { episodeIndex: 2, score: 0.7, rewardType: 'robometer' },
    ];
    const selection = selectionFromRewards(scores, 0.7);
    expect(selection.episodes.map((e) => e.episodeIndex)).toEqual([0, 2]);
    expect(selection.origin).toEqual({ kind: 'reward', rewardType: 'robometer', minScore: 0.7 });
  });

  it('leaves out episodes nothing scored', () => {
    const selection = selectionFromRewards(
      [{ episodeIndex: 4, score: 0.8, rewardType: 'topreward' }],
      0.5,
    );
    expect(selection.episodes).toEqual([{ episodeIndex: 4 }]);
    expect(selection.origin).toEqual({ kind: 'reward', rewardType: 'topreward', minScore: 0.5 });
  });
});

describe('isDatasetView', () => {
  it('reads `kind` and nothing else', () => {
    expect(isDatasetView({ kind: 'view' })).toBe(true);
    expect(isDatasetView({ kind: 'materialized' })).toBe(false);
    // A materialized row can carry a parent as provenance — that is not
    // containment, and inferring viewness from it would be a second walker.
    expect(isDatasetView({ kind: undefined })).toBe(false);
  });
});

describe('describeSelectionOrigin', () => {
  it('says the rule in English for every origin', () => {
    expect(describeSelectionOrigin({ kind: 'manual' })).toBe('Picked by hand');
    expect(describeSelectionOrigin({ kind: 'flags', decision: 'keep' })).toContain('marked keep');
    expect(
      describeSelectionOrigin({ kind: 'reward', rewardType: 'topreward', minScore: 0.6 }),
    ).toBe('topreward score ≥ 0.6');
    expect(
      describeSelectionOrigin({ kind: 'agent', actorId: 'curator-1', rationale: 'top third' }),
    ).toBe('Chosen by curator-1 — top third');
  });
});
