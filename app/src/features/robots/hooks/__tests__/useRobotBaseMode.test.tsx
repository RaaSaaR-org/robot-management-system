/**
 * @file useRobotBaseMode.test.tsx
 * @description The robot-mode hook (TASK-398): polls at 1 Hz while mounted and
 *              enabled, stops when unmounted, tracks how long the robot has
 *              been measured in stand, and posts a change only with a lease.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRobotBaseMode } from '../useRobotBaseMode';
import type { BaseModeApi, BaseModeStatus } from '../../api/baseModeApi';

function status(mode: 'limp' | 'stand' | 'balance', fsmId: number): BaseModeStatus {
  return {
    capability: { gate: 'fsm', moveEnabled: false, idsVerified: false, ids: null },
    base: { fsmId, mode, ageS: 0.1, error: null },
    inFlight: null,
    estopLatched: false,
    armed: false,
  };
}

function makeApi() {
  let current = status('limp', 1);
  const api = {
    getBaseMode: vi.fn(async () => current),
    setBaseMode: vi.fn(async () => ({ ok: true as const, status: 200, fsmId: 4, tookMs: 400 })),
  };
  return { api: api as typeof api & BaseModeApi, set: (s: BaseModeStatus) => { current = s; } };
}

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRobotBaseMode', () => {
  it('polls once a second while mounted, and stops on unmount', async () => {
    const { api } = makeApi();
    const hook = renderHook(() => useRobotBaseMode('robot-1', { api }));
    await flush();
    expect(api.getBaseMode).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status?.base?.mode).toBe('limp');
    await flush(3000);
    expect(api.getBaseMode).toHaveBeenCalledTimes(4);
    hook.unmount();
    await flush(3000);
    expect(api.getBaseMode).toHaveBeenCalledTimes(4);
  });

  it('does not poll when disabled', async () => {
    const { api } = makeApi();
    renderHook(() => useRobotBaseMode('robot-1', { api, enabled: false }));
    await flush(3000);
    expect(api.getBaseMode).not.toHaveBeenCalled();
  });

  it('remembers when the robot was first measured in stand, and forgets it on leaving', async () => {
    const { api, set } = makeApi();
    let t = 1_000;
    const hook = renderHook(() => useRobotBaseMode('robot-1', { api, now: () => t }));
    await flush();
    expect(hook.result.current.standSince).toBeNull();
    set(status('stand', 4));
    t = 2_000;
    await flush(1000);
    expect(hook.result.current.standSince).toBe(2_000);
    t = 3_000;
    await flush(1000);
    expect(hook.result.current.standSince).toBe(2_000);
    set(status('balance', 500));
    await flush(1000);
    expect(hook.result.current.standSince).toBeNull();
  });

  it('posts with the lease, and refuses locally without one', async () => {
    const { api } = makeApi();
    const hook = renderHook(() => useRobotBaseMode('robot-1', { api }));
    await flush();
    let res;
    await act(async () => {
      res = await hook.result.current.request('stand', null);
    });
    expect(res).toMatchObject({ ok: false, code: 'lease_required' });
    expect(api.setBaseMode).not.toHaveBeenCalled();
    await act(async () => {
      res = await hook.result.current.request('stand', { leaseId: 's', generation: 2 });
    });
    expect(api.setBaseMode).toHaveBeenCalledWith('robot-1', 'stand', { leaseId: 's', generation: 2 });
    expect(hook.result.current.lastResult).toMatchObject({ ok: true, fsmId: 4 });
  });
});
