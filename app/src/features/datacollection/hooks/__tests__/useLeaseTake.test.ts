/**
 * @file useLeaseTake.test.ts
 * @description The page's Set up lease is given back (TASK-427): `release()`
 *              drops `wanted` and releases, and `useLeaseHandOver` releases
 *              once on the edge of the hand-over, never again for a lease the
 *              user takes back on purpose.
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLeaseHandOver, useLeaseTake } from '../useLeaseTake';

describe('useLeaseTake', () => {
  it('release() closes the socket wish and releases the lease', () => {
    const release = vi.fn();
    const { result } = renderHook(() => useLeaseTake());
    result.current.sync({ state: 'bound', notice: null, acquire: vi.fn(), release }, true);
    act(() => { result.current.release(); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.current.wanted).toBe(false);
  });
});

describe('useLeaseHandOver', () => {
  it('hands over once on the rising edge while the page holds the lease', () => {
    const handOver = vi.fn();
    const { rerender } = renderHook(({ due, holds }) => useLeaseHandOver(due, holds, handOver), {
      initialProps: { due: false, holds: true },
    });
    expect(handOver).not.toHaveBeenCalled();
    rerender({ due: true, holds: true });
    expect(handOver).toHaveBeenCalledTimes(1);
    // Taken back on purpose while still due: it stays.
    rerender({ due: true, holds: false });
    rerender({ due: true, holds: true });
    expect(handOver).toHaveBeenCalledTimes(1);
    // A new hand-over (the operator leaves and opens VR again) releases again.
    rerender({ due: false, holds: true });
    rerender({ due: true, holds: true });
    expect(handOver).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the hand-over comes due while the page holds nothing', () => {
    const handOver = vi.fn();
    const { rerender } = renderHook(({ due, holds }) => useLeaseHandOver(due, holds, handOver), {
      initialProps: { due: false, holds: false },
    });
    rerender({ due: true, holds: false });
    expect(handOver).not.toHaveBeenCalled();
  });
});
