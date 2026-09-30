/**
 * @file useGamepadJoints.lease.test.ts
 * @description The gamepad input under the session page's control lease
 *              (TASK-320): unchanged with no lease, silent until its own
 *              socket is bound, silenced by revocation without re-acquiring.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGamepadJoints } from '../useGamepadJoints';
import type { Robot } from '../../../robots/types/robots.types';
import { FakeSocket, stubLease, binds } from './fakeSocket';

const robot = { id: 'so101-1', name: 'Arm', a2aAgentUrl: 'http://agent:41243' } as Robot;

let frames: FrameRequestCallback[] = [];
let clock = 0;
/** Run one ~100 ms animation frame — past the hook's 50 ms tick. */
function frame() {
  clock += 100;
  const due = frames;
  frames = [];
  act(() => due.forEach((cb) => cb(clock)));
}

let panX = 0;
const pad = () =>
  ({ axes: [panX, 0, 0, 0], buttons: [] as GamepadButton[] }) as unknown as Gamepad;

const moves = (ws: FakeSocket) => ws.sent.filter((m) => 'joint' in m);

beforeEach(() => {
  FakeSocket.instances = [];
  frames = [];
  clock = 0;
  panX = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad()], configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGamepadJoints with the control lease', () => {
  it('drives the SO-101 sidecar exactly as before when no lease is given', () => {
    renderHook(() => useGamepadJoints({ robot, enabled: true }));
    const ws = FakeSocket.last();
    expect(ws.url).toBe('ws://agent:8766/ws/keyboard-teleop');
    act(() => ws.open());
    panX = 1;
    frame();
    expect(moves(ws)).toEqual([{ joint: 'shoulder_pan', direction: 1 }]);
  });

  it('with the capability off behaves as with no lease', () => {
    renderHook(() => useGamepadJoints({ robot, enabled: true, lease: stubLease('observing', false) }));
    const ws = FakeSocket.last();
    expect(ws.url).toBe('ws://agent:8766/ws/keyboard-teleop');
    act(() => ws.open());
    panX = 1;
    frame();
    expect(moves(ws)).toHaveLength(1);
    expect(binds(ws)).toHaveLength(0);
  });

  it('sends nothing on an unbound socket and drives once bound to the page lease', () => {
    let lease = stubLease('observing');
    const { rerender } = renderHook(() => useGamepadJoints({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    // Under a lease the input goes to the agent, which enforces it.
    expect(ws.url).toBe('ws://agent:41243/ws/keyboard-teleop');
    act(() => ws.open());
    panX = 1;
    frame();
    expect(moves(ws)).toHaveLength(0);
    expect(binds(ws)).toHaveLength(0);

    // The operator took control on the page: the input joins that lease.
    lease = { ...lease, state: 'bound' };
    rerender();
    expect(lease.bindSocket).toHaveBeenCalledTimes(1);
    expect(binds(ws)).toEqual([{ bind: { leaseId: 'secret', generation: 7 } }]);
    frame();
    expect(moves(ws)).toHaveLength(0); // the agent has not confirmed this socket yet

    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    frame();
    expect(moves(ws)).toEqual([{ joint: 'shoulder_pan', direction: 1 }]);
  });

  it('binds at once when the socket opens while the page already holds the lease', () => {
    const lease = stubLease('bound');
    renderHook(() => useGamepadJoints({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    expect(binds(ws)).toHaveLength(1);
  });

  it('revocation stops a held stick and never re-binds or re-acquires', () => {
    const lease = stubLease('bound');
    renderHook(() => useGamepadJoints({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    panX = 1;
    frame();
    expect(moves(ws)).toEqual([{ joint: 'shoulder_pan', direction: 1 }]);

    act(() => ws.receive({ type: 'lease', state: 'revoked', generation: 7 }));
    frame();
    frame();
    // The held stick's stop goes out once; nothing else moves.
    expect(moves(ws)).toEqual([
      { joint: 'shoulder_pan', direction: 1 },
      { joint: 'shoulder_pan', direction: 0 },
    ]);
    expect(lease.bindSocket).toHaveBeenCalledTimes(1);
  });

  it('goes quiet when the page lease ends', () => {
    let lease = stubLease('bound');
    const { rerender } = renderHook(() => useGamepadJoints({ robot, enabled: true, lease }));
    const ws = FakeSocket.last();
    act(() => ws.open());
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 7 }));
    lease = { ...lease, state: 'observing' };
    rerender();
    panX = 1;
    frame();
    expect(moves(ws)).toHaveLength(0);
  });
});
