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

describe('useRobotBaseMode — Limp preempting a pending change', () => {
  it('a preempted Balance answering late neither clears the Limp pending nor overwrites its result', async () => {
    const { api } = makeApi();
    let finishBalance: (r: unknown) => void = () => {};
    let finishLimp: (r: unknown) => void = () => {};
    api.setBaseMode.mockImplementation(((_id: string, mode: string) =>
      new Promise((resolve) => {
        if (mode === 'balance') finishBalance = resolve;
        else finishLimp = resolve;
      })) as unknown as typeof api.setBaseMode);
    const grant = { leaseId: 'l', generation: 1 };
    const hook = renderHook(() => useRobotBaseMode('robot-1', { api }));
    await flush();

    let balance: Promise<unknown> = Promise.resolve();
    let limp: Promise<unknown> = Promise.resolve();
    act(() => {
      balance = hook.result.current.request('balance', grant);
    });
    expect(hook.result.current.pending).toBe('balance');
    act(() => {
      limp = hook.result.current.request('limp', grant);
    });
    expect(hook.result.current.pending).toBe('limp');

    await act(async () => {
      finishBalance({ ok: false, status: 409, code: 'preempted', error: 'a Limp request preempted this change' });
      await balance;
    });
    expect(hook.result.current.pending).toBe('limp');
    expect(hook.result.current.lastResult).toBeNull();

    await act(async () => {
      finishLimp({ ok: true, status: 200, fsmId: 1, tookMs: 500 });
      await limp;
    });
    expect(hook.result.current.pending).toBeNull();
    expect(hook.result.current.lastResult).toMatchObject({ ok: true, fsmId: 1 });
  });
});
