/**
 * @file EnsembleUncertainty.test.ts
 * @description Unit tests for EnsembleUncertainty — KLD, JSD, epistemic/aleatoric
 *   uncertainty, MC Dropout statistics, and episode ranking. All methods are pure
 *   deterministic math with no external I/O, so computations run for real and are
 *   asserted against analytically-derived expected values and mathematical invariants.
 * @feature Active Learning
 */

import { describe, it, expect } from 'vitest';
import { EnsembleUncertainty, ensembleUncertainty } from '../EnsembleUncertainty.js';
import type { UncertaintyEpisode } from '../../types/uncertainty.types.js';

const eu = new EnsembleUncertainty();

// ===========================================================================
// computeKLD
// ===========================================================================

describe('computeKLD', () => {
  it('returns 0 for identical distributions', () => {
    const p = [0.25, 0.25, 0.25, 0.25];
    expect(eu.computeKLD(p, p)).toBeCloseTo(0, 10);
  });

  it('returns 0 when either distribution is empty', () => {
    expect(eu.computeKLD([], [0.5, 0.5])).toBe(0);
    expect(eu.computeKLD([0.5, 0.5], [])).toBe(0);
  });

  it('throws when distribution lengths differ', () => {
    expect(() => eu.computeKLD([0.5, 0.5], [1])).toThrow(
      'KLD: distribution lengths must match (got 2 and 1)'
    );
  });

  it('computes a known divergence value', () => {
    // KL([1,0] || [0.5,0.5]) = 1*log(1/0.5) + ~0 = log(2)
    const result = eu.computeKLD([1, 0], [0.5, 0.5]);
    expect(result).toBeCloseTo(Math.log(2), 6);
  });

  it('is non-negative (asymmetric divergence clamped to >= 0)', () => {
    const result = eu.computeKLD([0.7, 0.3], [0.4, 0.6]);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('is asymmetric: KL(P||Q) != KL(Q||P) in general', () => {
    const p = [0.9, 0.1];
    const q = [0.4, 0.6];
    expect(eu.computeKLD(p, q)).not.toBeCloseTo(eu.computeKLD(q, p), 4);
  });
});

// ===========================================================================
// computeJSD
// ===========================================================================

describe('computeJSD', () => {
  it('returns 0 for a single prediction', () => {
    expect(eu.computeJSD([[0.5, 0.5]])).toBe(0);
  });

  it('returns 0 for empty predictions', () => {
    expect(eu.computeJSD([])).toBe(0);
  });

  it('returns 0 when prediction dimension is 0', () => {
    expect(eu.computeJSD([[], []])).toBe(0);
  });

  it('returns ~0 for two identical distributions', () => {
    const p = [0.25, 0.25, 0.25, 0.25];
    expect(eu.computeJSD([p, p])).toBeCloseTo(0, 10);
  });

  it('computes the classic 2-distribution JSD = (KL(P||M)+KL(Q||M))/2', () => {
    const p = [1, 0];
    const q = [0, 1];
    const m = [0.5, 0.5];
    const expected = (eu.computeKLD(p, m) + eu.computeKLD(q, m)) / 2;
    expect(eu.computeJSD([p, q])).toBeCloseTo(expected, 10);
    // For two maximally divergent distributions this equals log(2)
    expect(eu.computeJSD([p, q])).toBeCloseTo(Math.log(2), 6);
  });

  it('normalizes the generalized (n>2) JSD into [0, 1]', () => {
    const preds = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const jsd = eu.computeJSD(preds);
    expect(jsd).toBeGreaterThanOrEqual(0);
    expect(jsd).toBeLessThanOrEqual(1);
    // Three orthogonal one-hot dists -> maximal disagreement -> ~1 after /log(n)
    expect(jsd).toBeCloseTo(1, 6);
  });

  it('returns ~0 for n>2 identical distributions', () => {
    const p = [0.2, 0.3, 0.5];
    expect(eu.computeJSD([p, p, p])).toBeCloseTo(0, 6);
  });
});

// ===========================================================================
// computeEpistemicUncertainty
// ===========================================================================

describe('computeEpistemicUncertainty', () => {
  it('returns 0 for a single prediction', () => {
    expect(eu.computeEpistemicUncertainty([[1, 2, 3]])).toBe(0);
  });

  it('returns 0 for empty predictions', () => {
    expect(eu.computeEpistemicUncertainty([])).toBe(0);
  });

  it('returns 0 when dimension is 0', () => {
    expect(eu.computeEpistemicUncertainty([[], []])).toBe(0);
  });

  it('returns 0 when all models agree', () => {
    expect(
      eu.computeEpistemicUncertainty([
        [1, 2],
        [1, 2],
      ])
    ).toBeCloseTo(0, 10);
  });

  it('computes mean per-dimension population variance', () => {
    // dim0: [0,2] mean 1 var ((1)+(1))/2 = 1
    // dim1: [0,4] mean 2 var ((4)+(4))/2 = 4
    // mean of variances = (1+4)/2 = 2.5
    const result = eu.computeEpistemicUncertainty([
      [0, 0],
      [2, 4],
    ]);
    expect(result).toBeCloseTo(2.5, 10);
  });
});

// ===========================================================================
// computeAleatoricUncertainty
// ===========================================================================

describe('computeAleatoricUncertainty', () => {
  it('returns 0 for a single prediction', () => {
    expect(eu.computeAleatoricUncertainty([[1, 2, 3]])).toBe(0);
  });

  it('returns 0 for empty predictions', () => {
    expect(eu.computeAleatoricUncertainty([])).toBe(0);
  });

  it('returns 0 when dimension is 0', () => {
    expect(eu.computeAleatoricUncertainty([[], []])).toBe(0);
  });

  it('computes variance of per-model means', () => {
    // model0 mean = (0+0)/2 = 0; model1 mean = (2+4)/2 = 3
    // grand mean = 1.5; variance = ((1.5^2)+(1.5^2))/2 = 2.25
    const result = eu.computeAleatoricUncertainty([
      [0, 0],
      [2, 4],
    ]);
    expect(result).toBeCloseTo(2.25, 10);
  });

  it('returns 0 when all model means are equal', () => {
    // both models have mean 1 even though per-dim values differ
    const result = eu.computeAleatoricUncertainty([
      [0, 2],
      [2, 0],
    ]);
    expect(result).toBeCloseTo(0, 10);
  });
});

// ===========================================================================
// computeMCDropout
// ===========================================================================

describe('computeMCDropout', () => {
  it('returns empty result for no predictions', () => {
    expect(eu.computeMCDropout([])).toEqual({ mean: [], variance: [], uncertainty: 0 });
  });

  it('returns empty result when dimension is 0', () => {
    expect(eu.computeMCDropout([[], []])).toEqual({
      mean: [],
      variance: [],
      uncertainty: 0,
    });
  });

  it('computes per-dimension mean/variance and scalar uncertainty', () => {
    // dim0: [0,2] mean 1 var 1; dim1: [0,4] mean 2 var 4
    const result = eu.computeMCDropout([
      [0, 0],
      [2, 4],
    ]);
    expect(result.mean).toEqual([1, 2]);
    expect(result.variance).toEqual([1, 4]);
    expect(result.uncertainty).toBeCloseTo(2.5, 10); // mean of variances
  });

  it('reports zero uncertainty for identical passes', () => {
    const result = eu.computeMCDropout([
      [3, 5],
      [3, 5],
      [3, 5],
    ]);
    expect(result.mean).toEqual([3, 5]);
    expect(result.variance).toEqual([0, 0]);
    expect(result.uncertainty).toBe(0);
  });

  it('handles a single forward pass (variance 0)', () => {
    const result = eu.computeMCDropout([[7, 8, 9]]);
    expect(result.mean).toEqual([7, 8, 9]);
    expect(result.variance).toEqual([0, 0, 0]);
    expect(result.uncertainty).toBe(0);
  });
});

// ===========================================================================
// rankEpisodes
// ===========================================================================

describe('rankEpisodes', () => {
  function makeEpisode(id: string, predictions: number[][]): UncertaintyEpisode {
    return { episodeId: id, predictions };
  }

  it('returns an empty array for no episodes', () => {
    expect(eu.rankEpisodes([])).toEqual([]);
  });

  it('sorts descending by score and assigns 1-based ranks', () => {
    const low = makeEpisode('low', [
      [0.5, 0.5],
      [0.5, 0.5],
    ]); // identical -> score ~0
    const high = makeEpisode('high', [
      [1, 0],
      [0, 1],
    ]); // maximal disagreement -> high score

    const ranked = eu.rankEpisodes([low, high]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].episodeId).toBe('high');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].episodeId).toBe('low');
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('computes score = 0.6 * jsd + 0.4 * epistemic', () => {
    const ep = makeEpisode('e', [
      [1, 0],
      [0, 1],
    ]);
    const [ranked] = eu.rankEpisodes([ep]);
    const jsd = eu.computeJSD(ep.predictions);
    const epistemic = eu.computeEpistemicUncertainty(ep.predictions);
    expect(ranked.jsd).toBeCloseTo(jsd, 10);
    expect(ranked.epistemic).toBeCloseTo(epistemic, 10);
    expect(ranked.aleatoric).toBeCloseTo(
      eu.computeAleatoricUncertainty(ep.predictions),
      10
    );
    expect(ranked.score).toBeCloseTo(0.6 * jsd + 0.4 * epistemic, 10);
  });

  it('preserves all episode ids', () => {
    const eps = [
      makeEpisode('a', [[0.1, 0.9], [0.9, 0.1]]),
      makeEpisode('b', [[0.5, 0.5], [0.5, 0.5]]),
      makeEpisode('c', [[0.2, 0.8], [0.3, 0.7]]),
    ];
    const ranked = eu.rankEpisodes(eps);
    expect(ranked.map((r) => r.episodeId).sort()).toEqual(['a', 'b', 'c']);
    expect(ranked.map((r) => r.rank).sort()).toEqual([1, 2, 3]);
  });
});

// ===========================================================================
// singleton export
// ===========================================================================

describe('ensembleUncertainty singleton', () => {
  it('is an instance of EnsembleUncertainty', () => {
    expect(ensembleUncertainty).toBeInstanceOf(EnsembleUncertainty);
  });

  it('exposes the same computation as a fresh instance', () => {
    const preds = [
      [0.7, 0.3],
      [0.2, 0.8],
    ];
    expect(ensembleUncertainty.computeJSD(preds)).toBeCloseTo(eu.computeJSD(preds), 10);
  });
});
