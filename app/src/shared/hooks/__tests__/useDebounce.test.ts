/**
 * @file useDebounce.test.ts
 * @description Tests for useDebounce and useDebouncedCallback hooks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce, useDebouncedCallback } from '../useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500));
    expect(result.current).toBe('initial');
  });

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe('a');
  });

  it('updates after the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('b');
  });

  it('resets the timer on rapid successive changes (only last value wins)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ value: 'c' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // 600ms total but only 300ms since last change -> still old value
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('c');
  });

  it('uses default delay of 500ms when none provided', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value),
      { initialProps: { value: 1 } }
    );
    rerender({ value: 2 });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(2);
  });

  it('clears the pending timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'a' } }
    );
    rerender({ value: 'b' });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes the callback only after the delay', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(cb, 500));

    act(() => {
      result.current('x');
    });
    expect(cb).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('x');
  });

  it('coalesces rapid synchronous calls into a single trailing invocation', () => {
    // No re-render between calls: the timer id lives in a ref, so each call
    // clears the previous timer even within one render. Only the last call wins.
    const cb = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(cb, 500));

    act(() => {
      result.current('a');
      vi.advanceTimersByTime(200);
      result.current('b');
      vi.advanceTimersByTime(200);
      result.current('c');
    });
    // 400ms elapsed, but every call reset the timer — nothing has fired yet.
    expect(cb).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('c');
  });

  it('keeps a stable function identity across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ cb }) => useDebouncedCallback(cb, 500),
      { initialProps: { cb: vi.fn() } }
    );
    const first = result.current;
    rerender({ cb: vi.fn() });
    expect(result.current).toBe(first);
  });

  it('invokes the latest callback even when it changed after scheduling', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useDebouncedCallback(cb, 500),
      { initialProps: { cb: first } }
    );

    act(() => {
      result.current('x');
    });
    rerender({ cb: second });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });

  it('cleans up the pending timeout on unmount', () => {
    const cb = vi.fn();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useDebouncedCallback(cb, 500));

    act(() => {
      result.current('a');
    });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
