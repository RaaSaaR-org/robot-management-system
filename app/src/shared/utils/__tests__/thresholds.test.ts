/**
 * @file thresholds.test.ts
 * @description Tests for system resource threshold utilities
 */

import { describe, it, expect } from 'vitest';
import {
  CPU_THRESHOLDS,
  MEMORY_THRESHOLDS,
  BATTERY_THRESHOLDS,
  getResourceVariant,
} from '../thresholds';

describe('threshold constants', () => {
  it('exposes CPU thresholds', () => {
    expect(CPU_THRESHOLDS.WARNING).toBe(70);
    expect(CPU_THRESHOLDS.ERROR).toBe(90);
  });

  it('exposes memory thresholds', () => {
    expect(MEMORY_THRESHOLDS.WARNING).toBe(70);
    expect(MEMORY_THRESHOLDS.ERROR).toBe(90);
  });

  it('exposes battery thresholds', () => {
    expect(BATTERY_THRESHOLDS.CRITICAL).toBe(10);
    expect(BATTERY_THRESHOLDS.LOW).toBe(20);
    expect(BATTERY_THRESHOLDS.GOOD).toBe(50);
  });
});

describe('getResourceVariant', () => {
  const WARN = CPU_THRESHOLDS.WARNING; // 70
  const ERR = CPU_THRESHOLDS.ERROR; // 90

  it('returns "default" below the warning threshold', () => {
    expect(getResourceVariant(0, WARN, ERR)).toBe('default');
    expect(getResourceVariant(69.9, WARN, ERR)).toBe('default');
  });

  it('returns "warning" at and above warning but below error', () => {
    expect(getResourceVariant(70, WARN, ERR)).toBe('warning'); // boundary inclusive
    expect(getResourceVariant(80, WARN, ERR)).toBe('warning');
    expect(getResourceVariant(89.9, WARN, ERR)).toBe('warning');
  });

  it('returns "error" at and above the error threshold', () => {
    expect(getResourceVariant(90, WARN, ERR)).toBe('error'); // boundary inclusive
    expect(getResourceVariant(100, WARN, ERR)).toBe('error');
  });

  it('error check takes precedence over warning', () => {
    // value crosses both thresholds -> error wins
    expect(getResourceVariant(95, WARN, ERR)).toBe('error');
  });

  it('works with arbitrary custom thresholds', () => {
    expect(getResourceVariant(5, 3, 8)).toBe('warning');
    expect(getResourceVariant(2, 3, 8)).toBe('default');
    expect(getResourceVariant(8, 3, 8)).toBe('error');
  });

  it('handles equal warning and error thresholds (error precedence)', () => {
    expect(getResourceVariant(50, 50, 50)).toBe('error');
    expect(getResourceVariant(49, 50, 50)).toBe('default');
  });

  it('handles negative values', () => {
    expect(getResourceVariant(-10, WARN, ERR)).toBe('default');
  });
});
