/**
 * @file useControlLease.test.tsx
 * @description The console's control-lease state machine: acquire → bind →
 *              bound, the renew cadence, the local deadline, conflicts, and
 *              every loss path releasing exactly once and never re-acquiring.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useControlLease, type LeaseSocket } from '../useControlLease';
import type { ControlLeaseApi, ControlLeaseGrant, RenewResult } from '../../api/controlLeaseApi';

const GRANT: ControlLeaseGrant = {
  leaseId: 'secret-lease-id',
  generation: 7,
  sessionId: 's1',
  ttlMs: 5000,
  renewEveryMs: 1000,
  expiresAt: '2026-09-30T00:00:05.000Z',
};

function makeApi(enabled = true) {
  const api = {
    getControlLease: vi.fn().mockResolvedValue({
      capability: { version: 1, enabled, ttlMs: 5000, renewEveryMs: 1000 },
      holder: null,
    }),
    acquireControlLease: vi.fn().mockResolvedValue({ ok: true, grant: GRANT }),
    renewControlLease: vi.fn<(...a: unknown[]) => Promise<RenewResult>>().mockResolvedValue({
      ok: true,
      generation: 7,
      expiresAt: 'x',
      ttlMs: 5000,
      renewEveryMs: 1000,
    }),
    releaseControlLease: vi.fn().mockResolvedValue({ released: true }),
  };
  return api as typeof api & ControlLeaseApi;
}

function makeSocket(): LeaseSocket & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(() => true), isOpen: () => true };
}

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

async function setup(enabled = true) {
  const api = makeApi(enabled);
  const socket = makeSocket();
  const onMotionGate = vi.fn();
  const hook = renderHook(({ id }) =>
    useControlLease(id, { api, now: () => Date.now(), observerFactory: () => null, onMotionGate }),
    { initialProps: { id: 'robot-1' } },
  );
  await flush();
  act(() => hook.result.current.attachSocket(socket));
  return { api, socket, hook, onMotionGate };
}

async function acquireAndBind(ctx: Awaited<ReturnType<typeof setup>>) {
  await act(async () => {
    await ctx.hook.result.current.acquire();
  });
  act(() => {
    ctx.hook.result.current.handleSocketMessage({ type: 'lease', state: 'bound', generation: 7 });
  });
}

describe('useControlLease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquires, sends the bind and is bound only on the agent ack', async () => {
    const ctx = await setup();
    expect(ctx.hook.result.current.enabled).toBe(true);
    await act(async () => {
      await ctx.hook.result.current.acquire();
    });
    expect(ctx.socket.send).toHaveBeenCalledWith({ bind: { leaseId: 'secret-lease-id', generation: 7 } });
    expect(ctx.hook.result.current.state).toBe('acquiring');
    act(() => {
      ctx.hook.result.current.handleSocketMessage({ type: 'lease', state: 'bound', generation: 7 });
    });
    expect(ctx.hook.result.current.state).toBe('bound');
  });

  it('renews every renewEveryMs while bound', async () => {
    const ctx = await setup();
    await acquireAndBind(ctx);
    expect(ctx.api.renewControlLease).not.toHaveBeenCalled();
    await flush(1000);
    expect(ctx.api.renewControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.api.renewControlLease).toHaveBeenCalledWith('robot-1', 'secret-lease-id', 7);
    await flush(1000);
    await flush(1000);
    expect(ctx.api.renewControlLease).toHaveBeenCalledTimes(3);
    expect(ctx.hook.result.current.state).toBe('bound');
  });

  it('stops motion and releases when a renew misses the local deadline', async () => {
    const ctx = await setup();
    ctx.api.renewControlLease.mockReturnValue(new Promise(() => {}));
    await acquireAndBind(ctx);
    // Deadline = acquire time + ttl − 2 × renew = 3000 ms.
    await flush(2999);
    expect(ctx.api.releaseControlLease).not.toHaveBeenCalled();
    await flush(1);
    expect(ctx.onMotionGate).toHaveBeenCalledWith('deadline');
    expect(ctx.socket.send).toHaveBeenLastCalledWith({ move: { vx: 0, vy: 0, omega: 0 } });
    expect(ctx.api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.hook.result.current.state).toBe('observing');
    expect(ctx.hook.result.current.notice?.kind).toBe('lost');
  });

  it('releases on a renew refusal and keeps its code', async () => {
    const ctx = await setup();
    ctx.api.renewControlLease.mockResolvedValue({ ok: false, code: 'transport_lost', status: 409 });
    await acquireAndBind(ctx);
    await flush(1000);
    expect(ctx.api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.hook.result.current.notice).toMatchObject({ kind: 'lost', code: 'transport_lost' });
  });

  it('surfaces the holder on a 409', async () => {
    const ctx = await setup();
    ctx.api.acquireControlLease.mockResolvedValue({
      ok: false,
      code: 'lease_held',
      status: 409,
      holder: { userId: 'u2', displayName: 'Ada' },
    });
    await act(async () => {
      await ctx.hook.result.current.acquire();
    });
    expect(ctx.hook.result.current.state).toBe('observing');
    expect(ctx.hook.result.current.holder?.displayName).toBe('Ada');
    expect(ctx.hook.result.current.notice).toMatchObject({ kind: 'conflict' });
    expect(ctx.hook.result.current.notice?.message).toContain('Ada');
    expect(ctx.socket.send).not.toHaveBeenCalled();
  });

  it('releases when the page becomes hidden', async () => {
    const ctx = await setup();
    await acquireAndBind(ctx);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    vis.mockRestore();
    expect(ctx.api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.hook.result.current.state).toBe('observing');
  });

  it('releases exactly once across overlapping loss paths', async () => {
    const ctx = await setup();
    ctx.api.renewControlLease.mockResolvedValue({ ok: false, code: 'lease_lost', status: 409 });
    await acquireAndBind(ctx);
    act(() => {
      ctx.hook.result.current.handleSocketMessage({ type: 'lease', state: 'revoked', generation: 7 });
      ctx.hook.result.current.attachSocket(null);
      window.dispatchEvent(new Event('pagehide'));
      ctx.hook.result.current.release();
    });
    await flush(10_000);
    ctx.hook.unmount();
    expect(ctx.api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.onMotionGate).toHaveBeenCalledTimes(1);
  });

  it('never re-acquires on its own after a loss', async () => {
    const ctx = await setup();
    await acquireAndBind(ctx);
    act(() => {
      ctx.hook.result.current.handleSocketMessage({ type: 'lease', state: 'expired', generation: 7 });
    });
    await flush(60_000);
    expect(ctx.api.acquireControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.hook.result.current.state).toBe('observing');
  });

  it('gives the lease back when the agent never confirms the bind', async () => {
    const ctx = await setup();
    await act(async () => {
      await ctx.hook.result.current.acquire();
    });
    await flush(3000);
    expect(ctx.api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(ctx.hook.result.current.notice?.reason).toBe('bind_timeout');
    expect(ctx.api.renewControlLease).not.toHaveBeenCalled();
  });

  it('hands back a grant that arrives after the operator let go', async () => {
    const ctx = await setup();
    let resolve: (v: unknown) => void = () => {};
    ctx.api.acquireControlLease.mockReturnValue(new Promise((r) => (resolve = r)));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = ctx.hook.result.current.acquire();
    });
    act(() => ctx.hook.result.current.release());
    await act(async () => {
      resolve({ ok: true, grant: GRANT });
      await pending;
    });
    expect(ctx.api.releaseControlLease).toHaveBeenCalledWith('robot-1', 'secret-lease-id', 7);
    expect(ctx.socket.send).not.toHaveBeenCalled();
    expect(ctx.hook.result.current.state).toBe('observing');
  });

  it('releases on a robot change and on unmount', async () => {
    const ctx = await setup();
    await acquireAndBind(ctx);
    ctx.hook.rerender({ id: 'robot-2' });
    expect(ctx.api.releaseControlLease).toHaveBeenCalledWith('robot-1', 'secret-lease-id', 7);
    ctx.hook.unmount();
    expect(ctx.api.releaseControlLease).toHaveBeenCalledTimes(1);
  });

  it('joins an extra socket to the current lease', async () => {
    const ctx = await setup();
    const extra = makeSocket();
    expect(ctx.hook.result.current.bindSocket(extra)).toBe(false);
    await acquireAndBind(ctx);
    expect(ctx.hook.result.current.bindSocket(extra)).toBe(true);
    expect(extra.send).toHaveBeenCalledWith({ bind: { leaseId: 'secret-lease-id', generation: 7 } });
    act(() => ctx.hook.result.current.release());
    expect(extra.send).toHaveBeenLastCalledWith({ move: { vx: 0, vy: 0, omega: 0 } });
  });

  it('does nothing when the capability is off', async () => {
    const ctx = await setup(false);
    expect(ctx.hook.result.current.enabled).toBe(false);
    await act(async () => {
      await ctx.hook.result.current.acquire();
    });
    expect(ctx.api.acquireControlLease).not.toHaveBeenCalled();
    expect(ctx.socket.send).not.toHaveBeenCalled();
  });
});
