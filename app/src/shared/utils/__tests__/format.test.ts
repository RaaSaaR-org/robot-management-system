/**
 * @file format.test.ts
 * @description Tests for formatting utilities
 * @feature shared
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatTimeAgo, formatPercent, formatWithUnit } from '../format';

describe('formatTimeAgo', () => {
  const NOW = new Date('2026-06-22T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it('returns "Just now" for less than a minute', () => {
    expect(formatTimeAgo(ago(0))).toBe('Just now');
    expect(formatTimeAgo(ago(59 * 1000))).toBe('Just now');
  });

  it('returns minutes for 1m up to 59m', () => {
    expect(formatTimeAgo(ago(60 * 1000))).toBe('1m ago');
    expect(formatTimeAgo(ago(5 * 60 * 1000))).toBe('5m ago');
    expect(formatTimeAgo(ago(59 * 60 * 1000))).toBe('59m ago');
  });

  it('returns hours for 1h up to 23h', () => {
    expect(formatTimeAgo(ago(60 * 60 * 1000))).toBe('1h ago');
    expect(formatTimeAgo(ago(2 * 60 * 60 * 1000))).toBe('2h ago');
    expect(formatTimeAgo(ago(23 * 60 * 60 * 1000))).toBe('23h ago');
  });

  it('returns days for 1d up to 6d', () => {
    expect(formatTimeAgo(ago(24 * 60 * 60 * 1000))).toBe('1d ago');
    expect(formatTimeAgo(ago(6 * 24 * 60 * 60 * 1000))).toBe('6d ago');
  });

  it('falls back to locale date string at 7 days or more', () => {
    const old = ago(7 * 24 * 60 * 60 * 1000);
    expect(formatTimeAgo(old)).toBe(new Date(old).toLocaleDateString());
  });

  it('handles boundary exactly at 60 minutes -> 1h', () => {
    // 60 mins = exactly 1 hour, diffHours < 24 branch
    expect(formatTimeAgo(ago(60 * 60 * 1000))).toBe('1h ago');
  });
});

describe('formatPercent', () => {
  it('formats with zero decimals by default', () => {
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(50.6)).toBe('51%');
  });

  it('respects the decimals argument', () => {
    expect(formatPercent(50.567, 2)).toBe('50.57%');
    expect(formatPercent(33.3, 1)).toBe('33.3%');
  });

  it('handles zero and negative values', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(-5.4)).toBe('-5%');
  });
});

describe('formatWithUnit', () => {
  it('appends unit with one decimal by default', () => {
    expect(formatWithUnit(25.5, '°C')).toBe('25.5°C');
    expect(formatWithUnit(1.5, ' m/s')).toBe('1.5 m/s');
  });

  it('respects the decimals argument', () => {
    expect(formatWithUnit(1.2345, 'kg', 3)).toBe('1.234kg');
    expect(formatWithUnit(10, '%', 0)).toBe('10%');
  });

  it('handles empty unit and negative values', () => {
    expect(formatWithUnit(5, '')).toBe('5.0');
    expect(formatWithUnit(-3.14, '°', 2)).toBe('-3.14°');
  });
});
