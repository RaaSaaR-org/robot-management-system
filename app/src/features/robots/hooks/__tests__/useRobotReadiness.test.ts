/**
 * @file useRobotReadiness.test.ts
 * @description The readiness hook (TASK-411): socket pushes win, the GET runs
 *              every 2 s while the socket is down and every 20 s (the watch
 *              refresh) while it is up, staleness, and the actions' pending /
 *              error state.
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { useReadinessStore } from '../../store/readinessStore';
import { useRobotReadiness, type UseRobotReadinessOptions } from '../useRobotReadiness';
import type { BringupResult } from '../../api/readinessApi';

const ROBOT = 'r1';

function fakeApi(): NonNullable<UseRobotReadinessOptions['api']> {
  const ok = async (): Promise<BringupResult> => ({ ok: true, status: 200, body: {} });
  return {
    getReadiness: vi.fn(async () => readinessFor(ROBOT, 'bringup_stopped')),
    startBringup: vi.fn(ok),
    stopBringup: vi.fn(ok),
    setSidecarMode: vi.fn(ok),
    adoptStep: vi.fn(ok),
    leaveStep: vi.fn(ok),
    lanUp: vi.fn(ok),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useReadinessStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useRobotReadiness', () => {
  it('polls every 2 s while the robot socket is down', async () => {
    const api = fakeApi();
    renderHook(() => useRobotReadiness(ROBOT, { api }));
    await flush();
    expect(api.getReadiness).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      await flush();
    }
    expect(api.getReadiness).toHaveBeenCalledTimes(4);
  });

  it('refreshes the watch every 20 s while the socket is up, and takes pushed snapshots', async () => {
    useReadinessStore.getState().setSocketOpen(true);
    const api = fakeApi();
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api }));
    await flush();
    expect(api.getReadiness).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(19_000);
    });
    expect(api.getReadiness).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(api.getReadiness).toHaveBeenCalledTimes(2);

    act(() => useReadinessStore.getState().put(readinessFor(ROBOT, 'hand_fault')));
    expect(result.current.readiness?.reason.code).toBe('hand_fault');
    expect(result.current.stale).toBe(false);
  });

  it('marks the snapshot stale when nothing new arrives', async () => {
    useReadinessStore.getState().setSocketOpen(true);
    const api = fakeApi();
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api, staleMs: 12_000 }));
    await flush();
    expect(result.current.stale).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(13_000);
    });
    expect(result.current.stale).toBe(true);
  });

  it('starts read-only, tracks pending, and keeps a refusal as lastError', async () => {
    const api = fakeApi();
    let release: (r: BringupResult) => void = () => {};
    api.startBringup = vi.fn(() => new Promise<BringupResult>((r) => { release = r; }));
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api }));
    await flush();
    let done: Promise<BringupResult>;
    act(() => {
      done = result.current.actions.start();
    });
    expect(api.startBringup).toHaveBeenCalledWith(ROBOT, 'read_only');
    expect(result.current.pending).toEqual({ action: 'start' });
    await act(async () => {
      release({ ok: false, status: 409, code: 'busy', error: 'a start is already running' });
      await done;
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.lastError).toEqual({ action: 'start', code: 'busy', error: 'a start is already running' });
  });

  it('passes the grant to the sidecar mode switch', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api }));
    await flush();
    await act(async () => {
      await result.current.actions.switchMode('arm_sdk', { leaseId: 'x', generation: 2 });
    });
    expect(api.setSidecarMode).toHaveBeenCalledWith(ROBOT, 'arm_sdk', { leaseId: 'x', generation: 2 });
  });
});
