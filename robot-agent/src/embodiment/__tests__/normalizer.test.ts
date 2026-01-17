/**
 * @file normalizer.test.ts
 * @description Unit tests for ActionNormalizer
 * @feature vla
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionNormalizer } from '../normalizer.js';
import type { EmbodimentConfig } from '../types.js';

describe('ActionNormalizer', () => {
  let normalizer: ActionNormalizer;
  let mockConfig: EmbodimentConfig;

  beforeEach(() => {
    normalizer = new ActionNormalizer();

    mockConfig = {
      embodiment_tag: 'test_robot',
      manufacturer: 'Test',
      model: 'TestBot',
      action: {
        dim: 4,
        normalization: {
          mean: [0, 1, 2, 3],
          std: [1, 2, 1, 0.5],
        },
      },
      proprioception: {
        dim: 8,
        joint_names: ['j1', 'j2', 'j3', 'j4'],
      },
      cameras: [],
      version: '1.0.0',
    };
  });

  describe('normalize', () => {
    it('should normalize values using formula (raw - mean) / std', () => {
      const raw = [0, 1, 2, 3];
      const normalized = normalizer.normalize(raw, mockConfig);

      // (0 - 0) / 1 = 0
      // (1 - 1) / 2 = 0
      // (2 - 2) / 1 = 0
      // (3 - 3) / 0.5 = 0
      expect(normalized).toEqual([0, 0, 0, 0]);
    });

    it('should normalize non-zero values correctly', () => {
      const raw = [1, 3, 4, 4];
      const normalized = normalizer.normalize(raw, mockConfig);

      // (1 - 0) / 1 = 1
      // (3 - 1) / 2 = 1
      // (4 - 2) / 1 = 2
      // (4 - 3) / 0.5 = 2
      expect(normalized).toEqual([1, 1, 2, 2]);
    });

    it('should throw error on dimension mismatch', () => {
      const raw = [1, 2]; // Too few
      expect(() => normalizer.normalize(raw, mockConfig)).toThrow('dimension mismatch');
    });
  });

  describe('denormalize', () => {
    it('should denormalize values using formula normalized * std + mean', () => {
      const normalized = [0, 0, 0, 0];
      const raw = normalizer.denormalize(normalized, mockConfig);

      // 0 * 1 + 0 = 0
      // 0 * 2 + 1 = 1
      // 0 * 1 + 2 = 2
      // 0 * 0.5 + 3 = 3
      expect(raw).toEqual([0, 1, 2, 3]);
    });

    it('should denormalize non-zero values correctly', () => {
      const normalized = [1, 1, 2, 2];
      const raw = normalizer.denormalize(normalized, mockConfig);

      // 1 * 1 + 0 = 1
      // 1 * 2 + 1 = 3
      // 2 * 1 + 2 = 4
      // 2 * 0.5 + 3 = 4
      expect(raw).toEqual([1, 3, 4, 4]);
    });
  });

  describe('normalize/denormalize roundtrip', () => {
    it('should be reversible: denormalize(normalize(x)) ≈ x', () => {
      const original = [1.5, 2.5, 3.5, 4.5];
      const normalized = normalizer.normalize(original, mockConfig);
      const recovered = normalizer.denormalize(normalized, mockConfig);

      expect(ActionNormalizer.arraysClose(original, recovered)).toBe(true);
    });

    it('should handle negative values', () => {
      const original = [-1, -0.5, 0, 0.5];
      const normalized = normalizer.normalize(original, mockConfig);
      const recovered = normalizer.denormalize(normalized, mockConfig);

      expect(ActionNormalizer.arraysClose(original, recovered)).toBe(true);
    });
  });

  describe('normalizeFlexible', () => {
    it('should handle shorter arrays by padding with zeros', () => {
      const raw = [1, 2]; // Too short
      const normalized = normalizer.normalizeFlexible(raw, mockConfig);

      expect(normalized.length).toBe(4);
      // First two are normalized, rest are 0 (normalized mean)
      expect(normalized[0]).toBe(1); // (1 - 0) / 1
      expect(normalized[1]).toBe(0.5); // (2 - 1) / 2
      expect(normalized[2]).toBe(0);
      expect(normalized[3]).toBe(0);
    });

    it('should handle longer arrays by truncating', () => {
      const raw = [1, 2, 3, 4, 5, 6]; // Too long
      const normalized = normalizer.normalizeFlexible(raw, mockConfig);

      expect(normalized.length).toBe(4);
    });
  });

  describe('denormalizeFlexible', () => {
    it('should handle shorter arrays by padding with mean', () => {
      const normalized = [1, 1]; // Too short
      const raw = normalizer.denormalizeFlexible(normalized, mockConfig);

      expect(raw.length).toBe(4);
      // First two are denormalized, rest are mean values
      expect(raw[0]).toBe(1); // 1 * 1 + 0
      expect(raw[1]).toBe(3); // 1 * 2 + 1
      expect(raw[2]).toBe(2); // mean[2]
      expect(raw[3]).toBe(3); // mean[3]
    });
  });

  describe('clipToLimits', () => {
    it('should clip values to position limits', () => {
      const configWithLimits: EmbodimentConfig = {
        ...mockConfig,
        limits: {
          position: {
            lower: [-1, -1, -1, -1],
            upper: [1, 1, 1, 1],
          },
        },
      };

      const raw = [-2, 0, 1.5, 3];
      const clipped = normalizer.clipToLimits(raw, configWithLimits);

      expect(clipped).toEqual([-1, 0, 1, 1]);
    });

    it('should pass through when no limits', () => {
      const raw = [-2, 0, 1.5, 3];
      const clipped = normalizer.clipToLimits(raw, mockConfig);

      expect(clipped).toEqual(raw);
    });
  });

  describe('validateDimensions', () => {
    it('should return valid for matching dimensions', () => {
      const action = [1, 2, 3, 4];
      const result = normalizer.validateDimensions(action, mockConfig);

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(4);
      expect(result.actual).toBe(4);
    });

    it('should return invalid for mismatched dimensions', () => {
      const action = [1, 2];
      const result = normalizer.validateDimensions(action, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(4);
      expect(result.actual).toBe(2);
      expect(result.message).toContain('mismatch');
    });
  });

  describe('zero std protection', () => {
    it('should handle zero std without division by zero', () => {
      const configWithZeroStd: EmbodimentConfig = {
        ...mockConfig,
        action: {
          dim: 2,
          normalization: {
            mean: [0, 0],
            std: [0, 1], // First std is zero
          },
        },
      };

      // Should not throw
      const raw = [1, 2];
      const normalized = normalizer.normalize(raw, configWithZeroStd);

      // Should use MIN_STD instead of 0
      expect(normalized[0]).toBeDefined();
      expect(isFinite(normalized[0])).toBe(true);
    });
  });

  describe('static helpers', () => {
    it('isClose should compare values within tolerance', () => {
      expect(ActionNormalizer.isClose(1.0, 1.0000001)).toBe(true);
      expect(ActionNormalizer.isClose(1.0, 1.1)).toBe(false);
      expect(ActionNormalizer.isClose(1.0, 1.01, 0.1)).toBe(true);
    });

    it('arraysClose should compare arrays element-wise', () => {
      expect(ActionNormalizer.arraysClose([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(ActionNormalizer.arraysClose([1, 2], [1, 2, 3])).toBe(false);
      expect(ActionNormalizer.arraysClose([1, 2, 3], [1, 2, 4])).toBe(false);
    });
  });
});
