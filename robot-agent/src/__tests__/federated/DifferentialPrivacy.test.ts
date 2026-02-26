/**
 * @file DifferentialPrivacy.test.ts
 * @description Unit tests for gradient clipping and Gaussian noise injection
 * @feature Federated Learning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DifferentialPrivacy } from '../../federated/DifferentialPrivacy.js';

describe('DifferentialPrivacy', () => {
  let dp: DifferentialPrivacy;

  beforeEach(() => {
    dp = new DifferentialPrivacy();
  });

  describe('clipGradients', () => {
    it('does not modify gradients within the norm bound', () => {
      const gradients = [[1, 0, 0], [0, 1, 0]];
      const clipped = dp.clipGradients(gradients, 2.0);

      expect(clipped[0]).toEqual([1, 0, 0]);
      expect(clipped[1]).toEqual([0, 1, 0]);
    });

    it('clips gradients exceeding the norm bound', () => {
      // [3, 4] has L2 norm = 5
      const gradients = [[3, 4]];
      const clipped = dp.clipGradients(gradients, 1.0);

      // Should be scaled to norm 1.0: [3/5, 4/5] = [0.6, 0.8]
      expect(clipped[0][0]).toBeCloseTo(0.6, 10);
      expect(clipped[0][1]).toBeCloseTo(0.8, 10);
    });

    it('preserves direction when clipping', () => {
      const gradients = [[6, 8]]; // norm = 10
      const clipped = dp.clipGradients(gradients, 5.0);

      // Ratio should be preserved: 6/8 = 3/4
      const ratio = clipped[0][0] / clipped[0][1];
      expect(ratio).toBeCloseTo(6 / 8, 10);

      // Norm should be maxNorm
      const norm = Math.sqrt(clipped[0][0] ** 2 + clipped[0][1] ** 2);
      expect(norm).toBeCloseTo(5.0, 10);
    });

    it('handles zero gradient vector', () => {
      const gradients = [[0, 0, 0]];
      const clipped = dp.clipGradients(gradients, 1.0);

      expect(clipped[0]).toEqual([0, 0, 0]);
    });

    it('handles multiple gradient vectors with mixed norms', () => {
      // [1, 0] norm=1 (within), [6, 8] norm=10 (exceeds)
      const gradients = [[1, 0], [6, 8]];
      const clipped = dp.clipGradients(gradients, 5.0);

      // First should be unchanged
      expect(clipped[0]).toEqual([1, 0]);

      // Second should be clipped to norm 5
      const norm = Math.sqrt(clipped[1][0] ** 2 + clipped[1][1] ** 2);
      expect(norm).toBeCloseTo(5.0, 10);
    });

    it('throws on non-positive maxNorm', () => {
      expect(() => dp.clipGradients([[1]], 0)).toThrow('maxNorm must be positive');
      expect(() => dp.clipGradients([[1]], -1)).toThrow('maxNorm must be positive');
    });

    it('does not mutate the original gradients', () => {
      const original = [[6, 8]];
      dp.clipGradients(original, 1.0);
      expect(original[0]).toEqual([6, 8]);
    });
  });

  describe('addGaussianNoise', () => {
    let mathRandomSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Fix Math.random for deterministic tests (Box-Muller needs two values)
      let callCount = 0;
      mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
        // Return fixed values that won't cause log(0)
        const values = [0.5, 0.5, 0.3, 0.7, 0.8, 0.2, 0.1, 0.9];
        return values[callCount++ % values.length];
      });
    });

    afterEach(() => {
      mathRandomSpy.mockRestore();
    });

    it('adds noise to gradient values', () => {
      const gradients = [[1.0, 2.0]];
      const noised = dp.addGaussianNoise(gradients, 1.0, 1.0, 0.001);

      // Values should be changed (noise added)
      expect(noised[0][0]).not.toBe(1.0);
      expect(noised[0][1]).not.toBe(2.0);
    });

    it('returns same shape as input', () => {
      const gradients = [[1, 2, 3], [4, 5, 6]];
      const noised = dp.addGaussianNoise(gradients, 1.0, 1.0, 0.001);

      expect(noised).toHaveLength(2);
      expect(noised[0]).toHaveLength(3);
      expect(noised[1]).toHaveLength(3);
    });

    it('produces different noise for different elements', () => {
      // Use a real random so noise actually varies
      mathRandomSpy.mockRestore();

      const gradients = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
      const noised = dp.addGaussianNoise(gradients, 1.0, 1.0, 0.001);

      // With 10 elements starting at 0, they should not all be the same
      const unique = new Set(noised[0].map((v) => v.toFixed(6)));
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe('computeNoiseScale', () => {
    it('computes correct sigma for known values', () => {
      // σ = sensitivity * sqrt(2 * ln(1.25 / δ)) / ε
      const sensitivity = 1.0;
      const epsilon = 1.0;
      const delta = 1e-5;

      const sigma = dp.computeNoiseScale(sensitivity, epsilon, delta);
      const expected = sensitivity * Math.sqrt(2 * Math.log(1.25 / delta)) / epsilon;

      expect(sigma).toBeCloseTo(expected, 10);
    });

    it('scales linearly with sensitivity', () => {
      const sigma1 = dp.computeNoiseScale(1.0, 1.0, 0.001);
      const sigma2 = dp.computeNoiseScale(2.0, 1.0, 0.001);

      expect(sigma2).toBeCloseTo(2 * sigma1, 10);
    });

    it('scales inversely with epsilon', () => {
      const sigma1 = dp.computeNoiseScale(1.0, 1.0, 0.001);
      const sigma2 = dp.computeNoiseScale(1.0, 2.0, 0.001);

      expect(sigma2).toBeCloseTo(sigma1 / 2, 10);
    });

    it('increases noise for smaller delta', () => {
      const sigmaLargeDelta = dp.computeNoiseScale(1.0, 1.0, 0.1);
      const sigmaSmallDelta = dp.computeNoiseScale(1.0, 1.0, 0.001);

      expect(sigmaSmallDelta).toBeGreaterThan(sigmaLargeDelta);
    });

    it('throws on non-positive sensitivity', () => {
      expect(() => dp.computeNoiseScale(0, 1, 0.001)).toThrow('sensitivity must be positive');
    });

    it('throws on non-positive epsilon', () => {
      expect(() => dp.computeNoiseScale(1, 0, 0.001)).toThrow('epsilon must be positive');
    });

    it('throws on invalid delta', () => {
      expect(() => dp.computeNoiseScale(1, 1, 0)).toThrow('delta must be in (0, 1)');
      expect(() => dp.computeNoiseScale(1, 1, 1)).toThrow('delta must be in (0, 1)');
      expect(() => dp.computeNoiseScale(1, 1, -0.1)).toThrow('delta must be in (0, 1)');
    });
  });

  describe('computeL2Norm', () => {
    it('computes correct norm for known vector', () => {
      expect(dp.computeL2Norm([3, 4])).toBeCloseTo(5, 10);
    });

    it('returns 0 for zero vector', () => {
      expect(dp.computeL2Norm([0, 0, 0])).toBe(0);
    });

    it('returns absolute value for single element', () => {
      expect(dp.computeL2Norm([-5])).toBeCloseTo(5, 10);
    });
  });
});
