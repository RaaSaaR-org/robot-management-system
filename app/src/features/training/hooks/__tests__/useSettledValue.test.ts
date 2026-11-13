/**
 * @file useSettledValue.test.ts
 * @description A single change passes at once; a run of quick changes passes only its last (TASK-492).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { useSettledValue } from '../useSettledValue';

const QUIET = 250;

describe('useSettledValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (initial: number | null, wrapper?: typeof StrictMode) =>
    renderHook(({ value }: { value: number | null }) => useSettledValue(value, QUIET), {
      initialProps: { value: initial },
      wrapper,
    });

  it('passes a change on at once when the one before it was a while ago', () => {
    const { result, rerender } = setup(3);
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ value: 4 });
    expect(result.current).toBe(4);
  });

  it('holds a change that follows another one quickly, and passes it on after the quiet time', () => {
    const { result, rerender } = setup(3);
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ value: 4 });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ value: 5 });
    expect(result.current).toBe(4);
    act(() => void vi.advanceTimersByTime(QUIET - 1));
    expect(result.current).toBe(4);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(5);
  });

  it('passes on only the last of a run of quick changes — a held arrow key', () => {
    const { result, rerender } = setup(10);
    act(() => void vi.advanceTimersByTime(1000));
    const seen = new Set<number | null>();
    for (let value = 11; value <= 70; value++) {
      rerender({ value });
      seen.add(result.current);
      act(() => void vi.advanceTimersByTime(33));
      seen.add(result.current);
    }
    // The first step went through at once; none of the 58 between did.
    expect([...seen]).toEqual([11]);
    act(() => void vi.advanceTimersByTime(QUIET));
    expect(result.current).toBe(70);
  });

  it('follows clicks that come slower than the quiet time one by one', () => {
    const { result, rerender } = setup(0);
    for (let value = 1; value <= 5; value++) {
      act(() => void vi.advanceTimersByTime(QUIET + 100));
      rerender({ value });
      expect(result.current).toBe(value);
    }
  });

  it('passes "nothing selected" on at once in both directions', () => {
    const { result, rerender } = setup(null);
    rerender({ value: 0 });
    expect(result.current).toBe(0);
    act(() => void vi.advanceTimersByTime(10));
    rerender({ value: null });
    expect(result.current).toBeNull();
    rerender({ value: 7 });
    expect(result.current).toBe(7);
  });

  it('still lets a held change through when effects run twice (StrictMode)', () => {
    const { result, rerender } = setup(3, StrictMode);
    act(() => void vi.advanceTimersByTime(1000));
    rerender({ value: 4 });
    rerender({ value: 5 });
    expect(result.current).toBe(4);
    act(() => void vi.advanceTimersByTime(QUIET));
    expect(result.current).toBe(5);
  });
});
