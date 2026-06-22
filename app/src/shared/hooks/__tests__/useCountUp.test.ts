/**
 * @file useCountUp.test.ts
 * @description Tests for the useCountUp animated counter hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from '../useCountUp';

describe('useCountUp', () => {
  let now: number;
  let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }>;
  let rafId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    rafCallbacks = [];
    rafId = 0;

    vi.spyOn(performance, 'now').mockImplementation(() => now);

    // Manually controllable requestAnimationFrame queue.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.push({ id: rafId, cb });
      return rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Advances simulated time and flushes one batch of queued RAF callbacks. */
  const flushFrame = (ms: number) => {
    now += ms;
    const batch = rafCallbacks;
    rafCallbacks = [];
    act(() => {
      batch.forEach((entry) => entry.cb(now));
    });
  };

  it('starts at 0', () => {
    const { result } = renderHook(() => useCountUp(100, 1000, 0));
    expect(result.current).toBe(0);
  });

  it('animates toward the target and reaches it at the end of the duration', () => {
    const { result } = renderHook(() => useCountUp(100, 1000, 0));

    // Fire the delay timeout (0ms) which schedules the first RAF.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Halfway through, value is between 0 and target (ease-out -> past 50%).
    flushFrame(500);
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);

    // At full duration, value snaps to the target.
    flushFrame(500);
    expect(result.current).toBe(100);
  });

  it('honors the delay before starting the animation', () => {
    const { result } = renderHook(() => useCountUp(50, 1000, 300));

    act(() => {
      vi.advanceTimersByTime(299);
    });
    // No RAF scheduled yet -> still 0
    expect(rafCallbacks.length).toBe(0);
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rafCallbacks.length).toBe(1);
  });

  it('does nothing when the target equals the previous target', () => {
    const { result } = renderHook(() => useCountUp(0, 1000, 0));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // target (0) === prevTargetRef.current (0) -> early return, no RAF
    expect(rafCallbacks.length).toBe(0);
    expect(result.current).toBe(0);
  });

  it('cancels the pending animation frame on unmount', () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { result, unmount } = renderHook(() => useCountUp(80, 1000, 0));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    flushFrame(200);
    const midValue = result.current;
    expect(midValue).toBeLessThan(80);

    unmount();
    // The cleanup cancels the queued RAF so the animation stops advancing.
    expect(cancelSpy).toHaveBeenCalled();
    expect(rafCallbacks.length).toBe(0);
    cancelSpy.mockRestore();
  });

  it('animates to a new target when target changes', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, 1000, 0),
      { initialProps: { target: 100 } }
    );

    act(() => {
      vi.advanceTimersByTime(0);
    });
    flushFrame(1000);
    expect(result.current).toBe(100);

    // Change target -> the cleanup from the previous effect sets count to 100,
    // then a new animation runs toward 200.
    rerender({ target: 200 });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    flushFrame(1000);
    expect(result.current).toBe(200);
  });
});
