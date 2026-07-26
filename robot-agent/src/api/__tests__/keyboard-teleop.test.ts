/**
 * @file keyboard-teleop.test.ts
 * @description Tests for the keyboard/pose teleop WebSocket handler. The handler
 *              is the only export; we drive it by emitting a 'connection' on the
 *              returned WebSocketServer with a fake ws (an EventEmitter), then
 *              feeding it teleop messages. The RobotStateManager dependency is a
 *              spy stub, so we assert the correct state methods are invoked with
 *              the right arguments for each message type, plus held-key tick
 *              integration.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import type { RobotStateManager } from '../../robot/state.js';

const TEST_JOINTS = [
  { name: 'shoulder_pan', axis: 'z', limitLower: -1, limitUpper: 1, defaultPosition: 0 },
  { name: 'elbow_flex', axis: 'y', limitLower: 0, limitUpper: 2, defaultPosition: 0.5 },
];

/** A fake ws connection: an EventEmitter that records what was sent. */
class FakeWs extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: unknown[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  /** Convenience: parse all messages of a given type. */
  messagesOfType(type: string) {
    return this.sent.filter((m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && (m as Record<string, unknown>).type === type,
    );
  }
}

function makeStateStub() {
  return {
    enableTeleop: vi.fn().mockReturnValue({ shoulder_pan: 0, elbow_flex: 0.5 }),
    disableTeleop: vi.fn(),
    homeTeleopJoints: vi.fn(),
    applyTeleopDelta: vi.fn().mockReturnValue(0),
    setTeleopJoint: vi.fn().mockReturnValue(0),
    getTeleopPositions: vi.fn().mockReturnValue({ shoulder_pan: 0, elbow_flex: 0.5 }),
    getActiveJointConfig: vi.fn().mockReturnValue(TEST_JOINTS),
    getState: vi.fn().mockReturnValue({ robotType: 'so101' }),
  };
}

type StateStub = ReturnType<typeof makeStateStub>;

function connect(state: StateStub): FakeWs {
  const wss = createKeyboardTeleopWebSocket(state as unknown as RobotStateManager);
  const ws = new FakeWs();
  wss.emit('connection', ws);
  return ws;
}

function sendMsg(ws: FakeWs, payload: unknown) {
  ws.emit('message', Buffer.from(JSON.stringify(payload)));
}

beforeEach(() => {
  vi.useFakeTimers();
  // The control lock is a process-wide singleton and is now refcounted, so
  // sockets left open by an earlier test would keep holders alive.
  controlOwnerLock.reset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  controlOwnerLock.reset();
});

describe('keyboard-teleop — connection handshake', () => {
  it('enters teleop and advertises the embodiment config on connect', () => {
    const state = makeStateStub();
    const ws = connect(state);

    expect(state.enableTeleop).toHaveBeenCalledOnce();
    const config = ws.messagesOfType('config')[0];
    expect(config).toBeDefined();
    expect(config.robotType).toBe('so101');
    expect(config.joints).toHaveLength(2);
    expect((config.joints as Array<{ name: string }>)[0].name).toBe('shoulder_pan');
    expect(config.positions).toEqual({ shoulder_pan: 0, elbow_flex: 0.5 });
  });

  it('leaves teleop on close', () => {
    const state = makeStateStub();
    const ws = connect(state);
    ws.emit('close');
    expect(state.disableTeleop).toHaveBeenCalledOnce();
  });

  it('leaves teleop on error', () => {
    const state = makeStateStub();
    const ws = connect(state);
    ws.emit('error', new Error('boom'));
    expect(state.disableTeleop).toHaveBeenCalledOnce();
  });
});

describe('keyboard-teleop — concurrent operators hold the control lock', () => {
  /** Two live sockets on one endpoint — the ordinary case: keyboard tab + VR view. */
  function connectTwo(state: StateStub): { a: FakeWs; b: FakeWs } {
    const wss = createKeyboardTeleopWebSocket(state as unknown as RobotStateManager);
    const a = new FakeWs();
    const b = new FakeWs();
    wss.emit('connection', a);
    wss.emit('connection', b);
    return { a, b };
  }

  it('one view closing must not release a lock the other operator still holds', () => {
    const state = makeStateStub();
    const { a, b } = connectTwo(state);
    expect(controlOwnerLock.get()).toBe('teleop');
    expect(controlOwnerLock.holderCount()).toBe(2);

    b.emit('close');

    // The human on socket A is still streaming joint targets: control must stay
    // theirs, and the joints must stay under teleop.
    expect(controlOwnerLock.get()).toBe('teleop');
    expect(state.disableTeleop).not.toHaveBeenCalled();

    a.emit('close');

    expect(controlOwnerLock.get()).toBe('idle');
    expect(state.disableTeleop).toHaveBeenCalledOnce();
  });

  it('error followed by close on the same socket releases exactly one holder', () => {
    const state = makeStateStub();
    const { a } = connectTwo(state);

    a.emit('error', new Error('boom'));
    a.emit('close');

    expect(controlOwnerLock.get()).toBe('teleop');
    expect(controlOwnerLock.holderCount()).toBe(1);
    expect(state.disableTeleop).not.toHaveBeenCalled();
  });
});

describe('keyboard-teleop — message routing', () => {
  it('one-shot delta message applies a clamped nudge and echoes state', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', delta: 0.1 });

    expect(state.applyTeleopDelta).toHaveBeenCalledWith('shoulder_pan', 0.1);
    expect(ws.messagesOfType('state').length).toBeGreaterThanOrEqual(1);
  });

  it('absolute position message uses setTeleopJoint', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'elbow_flex', position: 1.25 });

    expect(state.setTeleopJoint).toHaveBeenCalledWith('elbow_flex', 1.25);
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
  });

  it('pose stream applies every numeric joint target via setTeleopJoint', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { positions: { shoulder_pan: 0.3, elbow_flex: 1.1, bogus: 'nope' } });

    expect(state.setTeleopJoint).toHaveBeenCalledWith('shoulder_pan', 0.3);
    expect(state.setTeleopJoint).toHaveBeenCalledWith('elbow_flex', 1.1);
    // Non-numeric values are ignored.
    expect(state.setTeleopJoint).not.toHaveBeenCalledWith('bogus', expect.anything());
    expect(state.setTeleopJoint).toHaveBeenCalledTimes(2);
  });

  it('home preset resets joints to default pose', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { preset: 'home' });

    expect(state.homeTeleopJoints).toHaveBeenCalledOnce();
    expect(ws.messagesOfType('state').length).toBeGreaterThanOrEqual(1);
  });

  it('stop preset clears motion without homing', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { preset: 'stop' });

    expect(state.homeTeleopJoints).not.toHaveBeenCalled();
    // Still emits a fresh state snapshot.
    expect(ws.messagesOfType('state').length).toBeGreaterThanOrEqual(1);
  });

  it('ignores malformed (non-JSON) messages without throwing', () => {
    const state = makeStateStub();
    const ws = connect(state);
    expect(() => ws.emit('message', Buffer.from('not json{'))).not.toThrow();
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
  });
});

describe('keyboard-teleop — held-key tick integration', () => {
  it('direction message does not move immediately, only on the timer tick', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', direction: 1 });

    // Direction only registers a velocity — no immediate apply.
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();

    // One tick (~33ms): velocity * dt = 0.8 * (33/1000) ≈ 0.0264 rad.
    vi.advanceTimersByTime(33);
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(1);
    const [joint, delta] = state.applyTeleopDelta.mock.calls[0];
    expect(joint).toBe('shoulder_pan');
    expect(delta).toBeCloseTo(0.8 * 0.033, 4);
  });

  it('moves negatively for direction -1', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', direction: -1 });
    vi.advanceTimersByTime(33);
    expect(state.applyTeleopDelta.mock.calls[0][1]).toBeLessThan(0);
  });

  it('direction 0 stops a held joint (no further applies)', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', direction: 1 });
    vi.advanceTimersByTime(33);
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(1);

    sendMsg(ws, { joint: 'shoulder_pan', direction: 0 });
    vi.advanceTimersByTime(99); // 3 more ticks
    // No additional applies after stop.
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(1);
  });

  it('clears the tick timer on close (no applies after disconnect)', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', direction: 1 });
    ws.emit('close');

    vi.advanceTimersByTime(330); // 10 ticks
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
  });

  it('integrates continuously while a key is held', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'elbow_flex', direction: 1 });

    vi.advanceTimersByTime(33 * 3); // 3 ticks
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(3);
  });
});
