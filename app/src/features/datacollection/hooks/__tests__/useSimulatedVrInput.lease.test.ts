/**
 * @file useSimulatedVrInput.lease.test.ts
 * @description The simulated-VR input under the session page's control lease
 *              (TASK-320): unchanged with no lease, streams only while its own
 *              socket is bound, silenced by revocation without re-acquiring.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSimulatedVrInput } from '../useSimulatedVrInput';
import type { Robot } from '../../../robots/types/robots.types';
import { FakeSocket, stubLease, binds } from './fakeSocket';

const robot = { id: 'g1-1', name: 'G1', a2aAgentUrl: 'http://agent:41243' } as Robot;

const CONFIG = {
  type: 'config',
  joints: [{ name: 'left_elbow_joint', limitLower: -1, limitUpper: 1, defaultPosition: 0 }],
};

const poses = (ws: FakeSocket) => ws.sent.filter((m) => 'positions' in m);
const tick = () => act(() => vi.advanceTimersByTime(60));

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSimulatedVrInput with the control lease', () => {
  it('streams exactly as before when no lease is given', () => {
    const { result } = renderHook(() => useSimulatedVrInput({ robot, enabled: true }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive(CONFIG));
    expect(result.current).toBe('streaming');
    tick();
    expect(poses(ws)).toHaveLength(1);
    expect(binds(ws)).toHaveLength(0);
  });

  it('streams nothing on an unbound socket and starts once bound to the page lease', () => {
    let lease = stubLease('observing');
    const { result, rerender } = renderHook(() => useSimulatedVrInput({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive(CONFIG));
    tick();
    tick();
    expect(poses(ws)).toHaveLength(0);
    expect(result.current).toBe('awaiting_control');

    lease = { ...lease, state: 'bound' };
    rerender();
    expect(binds(ws)).toEqual([{ bind: { leaseId: 'secret', generation: 7 } }]);
    tick();
    expect(poses(ws)).toHaveLength(0); // not confirmed by the agent yet

    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    tick();
    expect(poses(ws)).toHaveLength(1);
    expect(result.current).toBe('streaming');
  });

  it('revocation silences the stream and nothing re-binds or re-acquires', () => {
    const lease = stubLease('bound');
    const { result } = renderHook(() => useSimulatedVrInput({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    act(() => ws.receive(CONFIG));
    tick();
    expect(poses(ws)).toHaveLength(1);

    act(() => ws.receive({ type: 'lease', state: 'revoked', generation: 7 }));
    tick();
    tick();
    expect(poses(ws)).toHaveLength(1);
    expect(result.current).toBe('awaiting_control');
    expect(lease.bindSocket).toHaveBeenCalledTimes(1);
  });

  it('an expired lease silences it too, and leaving sends no home without the lease', () => {
    const lease = stubLease('bound');
    const { unmount } = renderHook(() => useSimulatedVrInput({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    act(() => ws.receive(CONFIG));
    act(() => ws.receive({ type: 'lease', state: 'expired', generation: 7 }));
    tick();
    unmount();
    expect(poses(ws)).toHaveLength(0);
    expect(ws.sent.filter((m) => 'preset' in m)).toHaveLength(0);
  });

  it('parks at home on leave while still bound', () => {
    const lease = stubLease('bound');
    const { unmount } = renderHook(() => useSimulatedVrInput({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    unmount();
    expect(ws.sent.filter((m) => 'preset' in m)).toEqual([{ preset: 'home' }]);
  });
});
