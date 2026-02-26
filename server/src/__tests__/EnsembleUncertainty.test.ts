/**
 * @file EnsembleUncertainty.test.ts
 * @description Tests for ensemble uncertainty estimation and active learning prioritization.
 * @feature Active Learning
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { EnsembleUncertainty } from '../services/EnsembleUncertainty.js';
import { createApp } from '../app.js';
import type { UncertaintyEpisode, RankedEpisode, MCDropoutResult } from '../types/uncertainty.types.js';

describe('EnsembleUncertainty', () => {
  let eu: EnsembleUncertainty;

  beforeEach(() => {
    eu = new EnsembleUncertainty();
  });

  // ========================================================================
  // KLD Tests
  // ========================================================================
  describe('computeKLD', () => {
    it('returns 0 for identical distributions', () => {
      const p = [0.25, 0.25, 0.25, 0.25];
      expect(eu.computeKLD(p, p)).toBeCloseTo(0, 10);
    });

    it('returns positive value for different distributions', () => {
      const p = [0.9, 0.1];
      const q = [0.1, 0.9];
      expect(eu.computeKLD(p, q)).toBeGreaterThan(0);
    });

    it('is asymmetric: KL(P||Q) != KL(Q||P) in general', () => {
      const p = [0.8, 0.2];
      const q = [0.3, 0.7];
      const klPQ = eu.computeKLD(p, q);
      const klQP = eu.computeKLD(q, p);
      expect(klPQ).not.toBeCloseTo(klQP, 5);
    });

    it('returns 0 for empty distributions', () => {
      expect(eu.computeKLD([], [])).toBe(0);
    });

    it('throws for mismatched lengths', () => {
      expect(() => eu.computeKLD([0.5, 0.5], [0.3, 0.3, 0.4])).toThrow('lengths must match');
    });

    it('handles distributions with zeros gracefully', () => {
      const p = [1.0, 0.0];
      const q = [0.5, 0.5];
      const result = eu.computeKLD(p, q);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  // ========================================================================
  // JSD Tests
  // ========================================================================
  describe('computeJSD', () => {
    it('returns 0 for identical distributions', () => {
      const predictions = [
        [0.25, 0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25, 0.25],
      ];
      expect(eu.computeJSD(predictions)).toBeCloseTo(0, 10);
    });

    it('returns value near 1 for maximally different distributions', () => {
      const predictions = [
        [1.0, 0.0],
        [0.0, 1.0],
      ];
      const jsd = eu.computeJSD(predictions);
      expect(jsd).toBeGreaterThan(0.5);
      expect(jsd).toBeLessThanOrEqual(1.0);
    });

    it('is symmetric: JSD(P, Q) == JSD(Q, P)', () => {
      const p = [0.7, 0.3];
      const q = [0.2, 0.8];
      const jsd1 = eu.computeJSD([p, q]);
      const jsd2 = eu.computeJSD([q, p]);
      expect(jsd1).toBeCloseTo(jsd2, 10);
    });

    it('returns value in [0, 1]', () => {
      const predictions = [
        [0.6, 0.3, 0.1],
        [0.1, 0.5, 0.4],
        [0.3, 0.3, 0.4],
      ];
      const jsd = eu.computeJSD(predictions);
      expect(jsd).toBeGreaterThanOrEqual(0);
      expect(jsd).toBeLessThanOrEqual(1);
    });

    it('returns 0 for single prediction', () => {
      expect(eu.computeJSD([[0.5, 0.5]])).toBe(0);
    });

    it('returns 0 for empty predictions', () => {
      expect(eu.computeJSD([])).toBe(0);
    });

    it('returns 0 for zero-dim predictions', () => {
      expect(eu.computeJSD([[], []])).toBe(0);
    });

    it('handles uniform distributions correctly', () => {
      const uniform = [0.25, 0.25, 0.25, 0.25];
      const jsd = eu.computeJSD([uniform, uniform, uniform]);
      expect(jsd).toBeCloseTo(0, 8);
    });

    it('handles more than 2 distributions', () => {
      const predictions = [
        [0.8, 0.1, 0.1],
        [0.1, 0.8, 0.1],
        [0.1, 0.1, 0.8],
      ];
      const jsd = eu.computeJSD(predictions);
      expect(jsd).toBeGreaterThan(0.3);
      expect(jsd).toBeLessThanOrEqual(1.0);
    });
  });

  // ========================================================================
  // Epistemic Uncertainty Tests
  // ========================================================================
  describe('computeEpistemicUncertainty', () => {
    it('returns 0 for identical predictions (agreement)', () => {
      const predictions = [
        [1.0, 2.0, 3.0],
        [1.0, 2.0, 3.0],
        [1.0, 2.0, 3.0],
      ];
      expect(eu.computeEpistemicUncertainty(predictions)).toBeCloseTo(0, 10);
    });

    it('returns high value for diverse ensemble', () => {
      const predictions = [
        [10.0, 0.0],
        [0.0, 10.0],
        [5.0, 5.0],
      ];
      const epistemic = eu.computeEpistemicUncertainty(predictions);
      expect(epistemic).toBeGreaterThan(5);
    });

    it('returns 0 for single prediction', () => {
      expect(eu.computeEpistemicUncertainty([[1.0, 2.0]])).toBe(0);
    });

    it('returns 0 for empty predictions', () => {
      expect(eu.computeEpistemicUncertainty([])).toBe(0);
    });

    it('returns 0 for zero-dim predictions', () => {
      expect(eu.computeEpistemicUncertainty([[], []])).toBe(0);
    });
  });

  // ========================================================================
  // Aleatoric Uncertainty Tests
  // ========================================================================
  describe('computeAleatoricUncertainty', () => {
    it('returns 0 when all models have same mean', () => {
      // Both models have mean = 2.0
      const predictions = [
        [1.0, 3.0],
        [0.5, 3.5],
      ];
      expect(eu.computeAleatoricUncertainty(predictions)).toBeCloseTo(0, 10);
    });

    it('returns positive value when model means differ', () => {
      const predictions = [
        [10.0, 10.0],
        [0.0, 0.0],
      ];
      const aleatoric = eu.computeAleatoricUncertainty(predictions);
      expect(aleatoric).toBeGreaterThan(0);
    });

    it('returns 0 for single prediction', () => {
      expect(eu.computeAleatoricUncertainty([[1.0, 2.0]])).toBe(0);
    });

    it('returns 0 for empty predictions', () => {
      expect(eu.computeAleatoricUncertainty([])).toBe(0);
    });
  });

  // ========================================================================
  // MC Dropout Tests
  // ========================================================================
  describe('computeMCDropout', () => {
    it('computes correct mean and variance for known data', () => {
      const predictions = [
        [2.0, 4.0],
        [4.0, 6.0],
      ];
      const result = eu.computeMCDropout(predictions);
      expect(result.mean).toEqual([3.0, 5.0]);
      expect(result.variance[0]).toBeCloseTo(1.0, 10);
      expect(result.variance[1]).toBeCloseTo(1.0, 10);
      expect(result.uncertainty).toBeCloseTo(1.0, 10);
    });

    it('returns zero variance for identical passes', () => {
      const predictions = [
        [1.0, 2.0, 3.0],
        [1.0, 2.0, 3.0],
      ];
      const result = eu.computeMCDropout(predictions);
      expect(result.mean).toEqual([1.0, 2.0, 3.0]);
      expect(result.variance).toEqual([0, 0, 0]);
      expect(result.uncertainty).toBe(0);
    });

    it('returns correct shapes', () => {
      const predictions = [
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [3, 4, 5, 6],
      ];
      const result = eu.computeMCDropout(predictions);
      expect(result.mean).toHaveLength(4);
      expect(result.variance).toHaveLength(4);
      expect(typeof result.uncertainty).toBe('number');
    });

    it('returns scalar uncertainty as mean of variances', () => {
      const predictions = [
        [0.0, 10.0],
        [10.0, 0.0],
      ];
      const result = eu.computeMCDropout(predictions);
      // var dim0 = 25, var dim1 = 25, uncertainty = 25
      expect(result.uncertainty).toBeCloseTo(25.0, 10);
    });

    it('handles empty predictions', () => {
      const result = eu.computeMCDropout([]);
      expect(result).toEqual({ mean: [], variance: [], uncertainty: 0 });
    });

    it('handles zero-dim predictions', () => {
      const result = eu.computeMCDropout([[], []]);
      expect(result).toEqual({ mean: [], variance: [], uncertainty: 0 });
    });
  });

  // ========================================================================
  // rankEpisodes Tests
  // ========================================================================
  describe('rankEpisodes', () => {
    it('ranks episodes with higher uncertainty first', () => {
      const episodes: UncertaintyEpisode[] = [
        {
          episodeId: 'low-uncertainty',
          predictions: [
            [0.5, 0.5],
            [0.5, 0.5],
          ],
        },
        {
          episodeId: 'high-uncertainty',
          predictions: [
            [1.0, 0.0],
            [0.0, 1.0],
          ],
        },
      ];

      const ranked = eu.rankEpisodes(episodes);
      expect(ranked[0].episodeId).toBe('high-uncertainty');
      expect(ranked[1].episodeId).toBe('low-uncertainty');
    });

    it('assigns correct ranks (1-based)', () => {
      const episodes: UncertaintyEpisode[] = [
        { episodeId: 'a', predictions: [[0.5, 0.5], [0.5, 0.5]] },
        { episodeId: 'b', predictions: [[1.0, 0.0], [0.0, 1.0]] },
        { episodeId: 'c', predictions: [[0.7, 0.3], [0.3, 0.7]] },
      ];

      const ranked = eu.rankEpisodes(episodes);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(2);
      expect(ranked[2].rank).toBe(3);
    });

    it('all scores are non-negative', () => {
      const episodes: UncertaintyEpisode[] = [
        { episodeId: 'a', predictions: [[0.5, 0.5], [0.5, 0.5]] },
        { episodeId: 'b', predictions: [[0.9, 0.1], [0.1, 0.9]] },
      ];

      const ranked = eu.rankEpisodes(episodes);
      for (const ep of ranked) {
        expect(ep.score).toBeGreaterThanOrEqual(0);
        expect(ep.jsd).toBeGreaterThanOrEqual(0);
        expect(ep.epistemic).toBeGreaterThanOrEqual(0);
        expect(ep.aleatoric).toBeGreaterThanOrEqual(0);
      }
    });

    it('score uses 0.6 * jsd + 0.4 * epistemic', () => {
      const episodes: UncertaintyEpisode[] = [
        {
          episodeId: 'test',
          predictions: [
            [0.8, 0.2],
            [0.2, 0.8],
          ],
        },
      ];

      const ranked = eu.rankEpisodes(episodes);
      const ep = ranked[0];
      const expectedScore = 0.6 * ep.jsd + 0.4 * ep.epistemic;
      expect(ep.score).toBeCloseTo(expectedScore, 10);
    });

    it('handles empty episodes array', () => {
      const ranked = eu.rankEpisodes([]);
      expect(ranked).toEqual([]);
    });

    it('includes all fields in result', () => {
      const episodes: UncertaintyEpisode[] = [
        { episodeId: 'ep1', predictions: [[0.5, 0.5], [0.3, 0.7]] },
      ];

      const ranked = eu.rankEpisodes(episodes);
      expect(ranked[0]).toHaveProperty('episodeId');
      expect(ranked[0]).toHaveProperty('jsd');
      expect(ranked[0]).toHaveProperty('epistemic');
      expect(ranked[0]).toHaveProperty('aleatoric');
      expect(ranked[0]).toHaveProperty('score');
      expect(ranked[0]).toHaveProperty('rank');
    });
  });

  // ========================================================================
  // API Route Tests
  // ========================================================================
  describe('API Routes', () => {
    const app = createApp();

    describe('POST /api/uncertainty/rank', () => {
      it('returns ranked episodes', async () => {
        const res = await request(app)
          .post('/api/uncertainty/rank')
          .send({
            episodes: [
              { episodeId: 'ep1', predictions: [[0.5, 0.5], [0.5, 0.5]] },
              { episodeId: 'ep2', predictions: [[1.0, 0.0], [0.0, 1.0]] },
            ],
          });

        expect(res.status).toBe(200);
        expect(res.body.ranked).toHaveLength(2);
        expect(res.body.ranked[0].episodeId).toBe('ep2');
        expect(res.body.timestamp).toBeDefined();
      });

      it('returns 400 for invalid input', async () => {
        const res = await request(app)
          .post('/api/uncertainty/rank')
          .send({ episodes: 'not-an-array' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('episodes must be an array');
      });
    });

    describe('POST /api/uncertainty/jsd', () => {
      it('returns JSD value', async () => {
        const res = await request(app)
          .post('/api/uncertainty/jsd')
          .send({
            predictions: [
              [0.5, 0.5],
              [0.5, 0.5],
            ],
          });

        expect(res.status).toBe(200);
        expect(typeof res.body.jsd).toBe('number');
        expect(res.body.jsd).toBeCloseTo(0, 5);
      });

      it('returns 400 for invalid input', async () => {
        const res = await request(app)
          .post('/api/uncertainty/jsd')
          .send({ predictions: 'bad' });

        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/uncertainty/mcdropout', () => {
      it('returns MCDropout result', async () => {
        const res = await request(app)
          .post('/api/uncertainty/mcdropout')
          .send({
            predictions: [
              [1.0, 2.0],
              [3.0, 4.0],
            ],
          });

        expect(res.status).toBe(200);
        expect(res.body.mean).toHaveLength(2);
        expect(res.body.variance).toHaveLength(2);
        expect(typeof res.body.uncertainty).toBe('number');
      });

      it('returns 400 for invalid input', async () => {
        const res = await request(app)
          .post('/api/uncertainty/mcdropout')
          .send({ predictions: 42 });

        expect(res.status).toBe(400);
      });
    });
  });
});
