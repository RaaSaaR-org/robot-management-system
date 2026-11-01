/**
 * @file useRobotReadiness.test.ts
 * @description The readiness hook (TASK-411): socket pushes win, the GET runs
 *              every 2 s while the socket is down and every 20 s (the watch
 *              refresh) while it is up, staleness, and the actions' pending /
 *              error state. TASK-430: Restart is Stop, wait for `stopped`,
 *              Start read-only — and never Start after a refused or failed
 *              stop, or once the wait runs out.
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { useReadinessStore } from '../../store/readinessStore';
import { useRobotReadiness, type UseRobotReadinessOptions } from '../useRobotReadiness';
import type { BringupResult, BringupStatus, RobotReadiness } from '../../api/readinessApi';

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

describe('useRobotReadiness — restart (TASK-430)', () => {
  /** The stopped fixture, as the supervisor reports it on its way down or after. */
  const at = (overall: BringupStatus['overall']): RobotReadiness => {
    const base = readinessFor(ROBOT, 'bringup_stopped');
    return { ...base, bringup: { ...base.bringup!, overall } };
  };

  /** Snapshots in turn after the first (the mount's read), the last one repeating. */
  function sequence(api: ReturnType<typeof fakeApi>, calls: string[], after: RobotReadiness[]) {
    let n = 0;
    api.getReadiness = vi.fn(async () => {
      if (n === 0) {
        n += 1;
        return readinessFor(ROBOT, 'sidecar_stale_code');
      }
      const snap = after[Math.min(n - 1, after.length - 1)];
      n += 1;
      calls.push(`read:${snap.bringup?.overall}`);
      return snap;
    });
    api.stopBringup = vi.fn(async (): Promise<BringupResult> => {
      calls.push('stop');
      return { ok: true, status: 202, body: {} };
    });
    api.startBringup = vi.fn(async (): Promise<BringupResult> => {
      calls.push('start');
      return { ok: true, status: 202, body: {} };
    });
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('stops, waits until the supervisor reports stopped, then starts read-only', async () => {
    const api = fakeApi();
    const calls: string[] = [];
    sequence(api, calls, [at('stopping'), at('stopping'), at('stopped')]);
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api, restartPollMs: 1 }));
    await act(async () => {
      await Promise.resolve();
    });
    let done: Promise<BringupResult> = Promise.resolve({ ok: true, status: 0, body: {} });
    act(() => {
      done = result.current.actions.restart();
    });
    expect(result.current.pending).toEqual({ action: 'restart' });
    let out: BringupResult | undefined;
    await act(async () => {
      out = await done;
    });
    expect(out?.ok).toBe(true);
    // (The hook re-reads once more after any action; that read comes after Start.)
    expect(calls.slice(0, calls.indexOf('start') + 1)).toEqual(['stop', 'read:stopping', 'read:stopping', 'read:stopped', 'start']);
    expect(api.startBringup).toHaveBeenCalledWith(ROBOT, 'read_only');
    expect(result.current.pending).toBeNull();
    expect(result.current.lastError).toBeNull();
  });

  it('a refused stop never starts, and says the stop was refused', async () => {
    const api = fakeApi();
    const calls: string[] = [];
    sequence(api, calls, [at('stopped')]);
    api.stopBringup = vi.fn(async (): Promise<BringupResult> => ({ ok: false, status: 409, code: 'busy', error: 'a sidecar mode switch is in progress' }));
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api, restartPollMs: 1 }));
    await act(async () => {
      await result.current.actions.restart();
    });
    expect(api.startBringup).not.toHaveBeenCalled();
    expect(result.current.lastError).toEqual({ action: 'restart', code: 'busy', error: 'Stop was refused: a sidecar mode switch is in progress' });
  });

  it('a stop that ends in error never starts', async () => {
    const api = fakeApi();
    const calls: string[] = [];
    sequence(api, calls, [at('stopping'), at('error')]);
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api, restartPollMs: 1 }));
    await act(async () => {
      await result.current.actions.restart();
    });
    expect(calls.slice(0, 3)).toEqual(['stop', 'read:stopping', 'read:error']);
    expect(calls).not.toContain('start');
    expect(result.current.lastError).toMatchObject({ action: 'restart', code: 'stop_failed' });
    expect(result.current.lastError?.error).toContain('not started again');
  });

  it('gives up once the wait runs out, and never starts', async () => {
    const api = fakeApi();
    const calls: string[] = [];
    sequence(api, calls, [at('stopping')]);
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api, restartPollMs: 2, restartWaitMs: 30 }));
    await act(async () => {
      await result.current.actions.restart();
    });
    expect(calls).not.toContain('start');
    expect(result.current.lastError).toMatchObject({ action: 'restart', code: 'stop_timeout' });
  });

  it('a refused start after the stop says so', async () => {
    const api = fakeApi();
    const calls: string[] = [];
    sequence(api, calls, [at('stopped')]);
    api.startBringup = vi.fn(async (): Promise<BringupResult> => ({ ok: false, status: 409, code: 'busy', error: 'the supervisor is stopping' }));
    const { result } = renderHook(() => useRobotReadiness(ROBOT, { api, restartPollMs: 1 }));
    await act(async () => {
      await result.current.actions.restart();
    });
    expect(result.current.lastError).toEqual({ action: 'restart', code: 'busy', error: 'It stopped, but Start was refused: the supervisor is stopping' });
  });
});
