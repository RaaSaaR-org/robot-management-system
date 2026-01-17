/**
 * @file normalizer.ts
 * @description Action normalization/denormalization for VLA pipeline
 * @feature vla
 */

import type { EmbodimentConfig, ValidationResult } from './types.js';

/**
 * ActionNormalizer handles transformation between raw joint values and
 * normalized [-1, 1] range used by VLA models.
 *
 * Normalization formula: normalized = (raw - mean) / std
 * Denormalization formula: raw = normalized * std + mean
 *
 * @example
 * ```typescript
 * const normalizer = new ActionNormalizer();
 *
 * // Normalize raw joint positions for VLA model input
 * const normalized = normalizer.normalize(rawAction, config);
 *
 * // Denormalize VLA model output for robot execution
 * const raw = normalizer.denormalize(modelOutput, config);
 * ```
 */
export class ActionNormalizer {
  // Minimum std value to prevent division by zero
  private static readonly MIN_STD = 1e-8;

  /**
   * Normalize raw action values to [-1, 1] range.
   *
   * Formula: normalized = (raw - mean) / std
   *
   * @param raw Raw action values from robot
   * @param config Embodiment configuration with normalization params
   * @returns Normalized action values in [-1, 1] range
   * @throws Error if dimensions don't match
   */
  normalize(raw: number[], config: EmbodimentConfig): number[] {
    const validation = this.validateDimensions(raw, config);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const { mean, std } = config.action.normalization;
    const normalized: number[] = new Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      const stdVal = Math.max(std[i], ActionNormalizer.MIN_STD);
      normalized[i] = (raw[i] - mean[i]) / stdVal;
    }

    return normalized;
  }

  /**
   * Denormalize action values from [-1, 1] range to raw joint values.
   *
   * Formula: raw = normalized * std + mean
   *
   * @param normalized Normalized action values from VLA model
   * @param config Embodiment configuration with normalization params
   * @returns Raw action values for robot execution
   * @throws Error if dimensions don't match
   */
  denormalize(normalized: number[], config: EmbodimentConfig): number[] {
    const validation = this.validateDimensions(normalized, config);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const { mean, std } = config.action.normalization;
    const raw: number[] = new Array(normalized.length);

    for (let i = 0; i < normalized.length; i++) {
      raw[i] = normalized[i] * std[i] + mean[i];
    }

    return raw;
  }

  /**
   * Safe normalize that handles dimension mismatches gracefully.
   * - Pads with zeros if raw is shorter than expected
   * - Truncates if raw is longer than expected
   * - Logs warning for mismatches
   *
   * @param raw Raw action values
   * @param config Embodiment configuration
   * @returns Normalized values with correct dimension
   */
  normalizeFlexible(raw: number[], config: EmbodimentConfig): number[] {
    const expectedDim = config.action.dim;
    const { mean, std } = config.action.normalization;

    if (raw.length !== expectedDim) {
      console.warn(
        `[ActionNormalizer] Dimension mismatch: expected ${expectedDim}, got ${raw.length}. Adjusting.`
      );
    }

    const normalized: number[] = new Array(expectedDim);

    for (let i = 0; i < expectedDim; i++) {
      if (i < raw.length) {
        const stdVal = Math.max(std[i], ActionNormalizer.MIN_STD);
        normalized[i] = (raw[i] - mean[i]) / stdVal;
      } else {
        // Pad with normalized zero (mean)
        normalized[i] = 0;
      }
    }

    return normalized;
  }

  /**
   * Safe denormalize that handles dimension mismatches gracefully.
   * - Pads with mean values if normalized is shorter than expected
   * - Truncates if normalized is longer than expected
   * - Logs warning for mismatches
   *
   * @param normalized Normalized action values
   * @param config Embodiment configuration
   * @returns Raw values with correct dimension
   */
  denormalizeFlexible(normalized: number[], config: EmbodimentConfig): number[] {
    const expectedDim = config.action.dim;
    const { mean, std } = config.action.normalization;

    if (normalized.length !== expectedDim) {
      console.warn(
        `[ActionNormalizer] Dimension mismatch: expected ${expectedDim}, got ${normalized.length}. Adjusting.`
      );
    }

    const raw: number[] = new Array(expectedDim);

    for (let i = 0; i < expectedDim; i++) {
      if (i < normalized.length) {
        raw[i] = normalized[i] * std[i] + mean[i];
      } else {
        // Pad with mean (default position)
        raw[i] = mean[i];
      }
    }

    return raw;
  }

  /**
   * Validate that action dimensions match configuration.
   *
   * @param action Action array to validate
   * @param config Embodiment configuration
   * @returns Validation result with expected and actual dimensions
   */
  validateDimensions(action: number[], config: EmbodimentConfig): ValidationResult {
    const expected = config.action.dim;
    const actual = action.length;

    if (actual !== expected) {
      return {
        valid: false,
        expected,
        actual,
        message: `Action dimension mismatch: expected ${expected}, got ${actual}`,
      };
    }

    return { valid: true, expected, actual };
  }

  /**
   * Clip action values to valid range after denormalization.
   *
   * @param raw Raw action values
   * @param config Embodiment configuration with limits
   * @returns Clipped action values within joint limits
   */
  clipToLimits(raw: number[], config: EmbodimentConfig): number[] {
    if (!config.limits?.position) {
      return [...raw];
    }

    const { lower, upper } = config.limits.position;
    const clipped: number[] = new Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      const lowerLimit = i < lower.length ? lower[i] : -Infinity;
      const upperLimit = i < upper.length ? upper[i] : Infinity;
      clipped[i] = Math.max(lowerLimit, Math.min(upperLimit, raw[i]));
    }

    return clipped;
  }

  /**
   * Denormalize and clip action values in one step.
   *
   * @param normalized Normalized action values from VLA model
   * @param config Embodiment configuration
   * @returns Raw, clipped action values ready for robot execution
   */
  denormalizeAndClip(normalized: number[], config: EmbodimentConfig): number[] {
    const raw = this.denormalize(normalized, config);
    return this.clipToLimits(raw, config);
  }

  /**
   * Denormalize flexibly and clip action values.
   *
   * @param normalized Normalized action values
   * @param config Embodiment configuration
   * @returns Raw, clipped action values with correct dimension
   */
  denormalizeFlexibleAndClip(normalized: number[], config: EmbodimentConfig): number[] {
    const raw = this.denormalizeFlexible(normalized, config);
    return this.clipToLimits(raw, config);
  }

  /**
   * Check if a value is close to another within tolerance.
   * Useful for verifying normalize/denormalize roundtrip.
   *
   * @param a First value
   * @param b Second value
   * @param tolerance Maximum allowed difference
   * @returns True if values are within tolerance
   */
  static isClose(a: number, b: number, tolerance = 1e-6): boolean {
    return Math.abs(a - b) < tolerance;
  }

  /**
   * Check if two arrays are element-wise close.
   *
   * @param a First array
   * @param b Second array
   * @param tolerance Maximum allowed difference per element
   * @returns True if all elements are within tolerance
   */
  static arraysClose(a: number[], b: number[], tolerance = 1e-6): boolean {
    if (a.length !== b.length) return false;
    return a.every((val, i) => ActionNormalizer.isClose(val, b[i], tolerance));
  }
}
