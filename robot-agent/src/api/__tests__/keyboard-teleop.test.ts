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

// Mocked so no test in this file can reach a real sidecar: `preset:'stop'` and
// `{estop}` now command the base, and `_loco` would otherwise fetch localhost.
const locoMove = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; error?: string; locoDisabled?: boolean }> => ({ ok: true })),
);
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: { locoMove },
  getSidecarUrl: () => 'http://localhost:0',
}));

import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import type { RobotStateManager, TeleopErrorListener } from '../../robot/state.js';

const TEST_JOINTS = [
  { name: 'shoulder_pan', axis: 'z', limitLower: -1, limitUpper: 1, defaultPosition: 0 },
  { name: 'elbow_flex', axis: 'y', limitLower: 0, limitUpper: 2, defaultPosition: 0.5 },
];

/** A fake ws connection: an EventEmitter that records what was sent. */
class FakeWs extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: unknown[] = [];
  /** The keepalive probe (real `ws` always has this; the fake must too). */
  ping = vi.fn();
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
  /** Listeners registered through `onTeleopError`, so tests can fire one. */
  const teleopErrorListeners = new Set<TeleopErrorListener>();
  return {
    enableTeleop: vi.fn().mockReturnValue({ shoulder_pan: 0, elbow_flex: 0.5 }),
    disableTeleop: vi.fn(),
    homeTeleopJoints: vi.fn(),
    applyTeleopDelta: vi.fn().mockReturnValue(0),
    setTeleopJoint: vi.fn().mockReturnValue(0),
    getTeleopPositions: vi.fn().mockReturnValue({ shoulder_pan: 0, elbow_flex: 0.5 }),
    getActiveJointConfig: vi.fn().mockReturnValue(TEST_JOINTS),
    getState: vi.fn().mockReturnValue({ robotType: 'so101' }),
    isEStopTriggered: vi.fn().mockReturnValue(false),
    // The base's FSM, as the socket reads it every tick for `{type:'base'}`.
    // Standing by default: a stub that reported a damped base would put every
    // test in this file behind the state the feature exists to get OUT of.
    getAgentSafetyState: vi.fn(() => ({
      estopLatched: false, estopReason: null, estopAt: null,
      damped: false, lastFsmId: 500, place: null, bootId: '',
    })),
    getEStopState: vi.fn().mockReturnValue({ status: 'armed', reason: null }),
    triggerEmergencyStop: vi.fn(),
    onTeleopError: vi.fn((l: TeleopErrorListener) => {
      teleopErrorListeners.add(l);
      return () => teleopErrorListeners.delete(l);
    }),
    /** Test-only: pretend the 50 Hz pose stream failed. */
    fireTeleopError(code: string, message: string) {
      for (const l of teleopErrorListeners) l({ code, message } as Parameters<TeleopErrorListener>[0]);
    },
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

/**
 * The most recent `{type:'estop'}` frame.
 *
 * Not `[0]`: the agent now states the latch on CONNECT as well as on every
 * transition, so index 0 is the handshake's answer and a reply to a message
 * sent later is at the end. The tests that indexed from the front were
 * asserting against the handshake without knowing it.
 */
function lastEstop(ws: FakeWs): Record<string, unknown> {
  const frames = ws.messagesOfType('estop');
  return frames[frames.length - 1];
}

beforeEach(() => {
  vi.useFakeTimers();
  locoMove.mockClear();
  locoMove.mockImplementation(async () => ({ ok: true }));
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

  it('stop preset zeroes the BASE as well as the held keys, without homing', async () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { preset: 'stop' });
    await vi.advanceTimersByTimeAsync(0);

    expect(state.homeTeleopJoints).not.toHaveBeenCalled();
    // The decoy this replaced: `stop` cleared the held-key map and nothing
    // else, so the panic button on a WALKING robot left it walking.
    expect(locoMove).toHaveBeenCalledOnce();
    expect(locoMove.mock.calls[0] as unknown as number[]).toEqual([0, 0, 0, 0]);
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

describe('keyboard-teleop — ownership is announced, not inferred', () => {
  it('sends a control frame naming the owner on connect', () => {
    const state = makeStateStub();
    const ws = connect(state);

    const control = ws.messagesOfType('control')[0];
    expect(control).toEqual({ type: 'control', owner: 'teleop', preempted: null });
  });

  it('names who was preempted, so the operator knows they took the robot', () => {
    controlOwnerLock.claim('vla');
    const state = makeStateStub();
    const ws = connect(state);

    expect(ws.messagesOfType('control')[0].preempted).toBe('vla');
  });
});

describe('keyboard-teleop — a latched E-Stop refuses input', () => {
  /** Every message shape that commands motion, and the stub call that proves it moved. */
  const writers: Array<[string, unknown, (s: ReturnType<typeof makeStateStub>) => unknown]> = [
    ['pose stream', { positions: { shoulder_pan: 0.3 } }, (s) => s.setTeleopJoint],
    ['single position', { joint: 'shoulder_pan', position: 0.3 }, (s) => s.setTeleopJoint],
    ['one-shot delta', { joint: 'shoulder_pan', delta: 0.1 }, (s) => s.applyTeleopDelta],
    ['home preset', { preset: 'home' }, (s) => s.homeTeleopJoints],
  ];

  for (const [name, msg, writer] of writers) {
    it(`discards a ${name} while the latch is held`, () => {
      const state = makeStateStub();
      state.isEStopTriggered.mockReturnValue(true);
      const ws = connect(state);

      sendMsg(ws, msg);

      expect(writer(state)).not.toHaveBeenCalled();
      expect(ws.messagesOfType('error')[0]).toMatchObject({ code: 'estop_latched' });
    });
  }

  it('discards a held key that was already down when the latch was taken', () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', direction: 1 });
    vi.advanceTimersByTime(33);
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(1);

    state.isEStopTriggered.mockReturnValue(true);
    vi.advanceTimersByTime(33 * 5);

    // Not merely paused: the held velocity is dropped, so clearing the latch
    // cannot resume a motion nobody is still asking for.
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(1);
    state.isEStopTriggered.mockReturnValue(false);
    vi.advanceTimersByTime(33 * 5);
    expect(state.applyTeleopDelta).toHaveBeenCalledTimes(1);
  });

  it('still forwards a zero base command — a stop is never refused', async () => {
    const state = makeStateStub();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect(state);

    sendMsg(ws, { move: { vx: 0, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);

    expect(locoMove.mock.calls[0] as unknown as number[]).toEqual([0, 0, 0, 0]);
  });

  it('refuses a non-zero base command', async () => {
    const state = makeStateStub();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect(state);

    sendMsg(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);

    expect(locoMove).not.toHaveBeenCalled();
    expect(ws.messagesOfType('error')[0]).toMatchObject({ code: 'estop_latched' });
  });
});

describe('keyboard-teleop — {estop} is the real stop', () => {
  it('zeroes the base, latches the stop, leaves teleop, and says so — in that order', async () => {
    const order: string[] = [];
    const state = makeStateStub();
    locoMove.mockImplementation(async () => {
      order.push('locoMove');
      return { ok: true };
    });
    state.triggerEmergencyStop.mockImplementation(() => order.push('trigger'));
    state.disableTeleop.mockImplementation(() => order.push('disableTeleop'));
    const ws = connect(state);

    sendMsg(ws, { estop: { reason: 'person in the aisle' } });
    await vi.advanceTimersByTimeAsync(0);

    // The base command goes first: it is the half that has to be in flight
    // before anything slower happens.
    expect(order).toEqual(['locoMove', 'trigger', 'disableTeleop']);
    expect(locoMove.mock.calls[0] as unknown as number[]).toEqual([0, 0, 0, 0]);
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'person in the aisle');
    expect(lastEstop(ws)).toEqual({
      type: 'estop',
      active: true,
      reason: 'person in the aisle',
    });
  });

  it('supplies a reason when the client sends none', async () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { estop: {} });
    await vi.advanceTimersByTimeAsync(0);

    const [, reason] = state.triggerEmergencyStop.mock.calls[0];
    expect(typeof reason).toBe('string');
    expect((reason as string).length).toBeGreaterThan(0);
    expect(lastEstop(ws).reason).toBe(reason);
  });

  it('is not parked behind an in-flight move — it bypasses the coalescing slot', async () => {
    const state = makeStateStub();
    let release!: () => void;
    locoMove.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ ok: true }); }),
    );
    const ws = connect(state);
    sendMsg(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(locoMove).toHaveBeenCalledOnce();

    sendMsg(ws, { estop: {} });
    await vi.advanceTimersByTimeAsync(0);

    // Straight out, while the first RPC is still blocked. `locoMove`'s timeout
    // is duration + 5s — waiting behind it is not an option for this message.
    expect(locoMove).toHaveBeenCalledTimes(2);
    expect(locoMove.mock.calls[1] as unknown as number[]).toEqual([0, 0, 0, 0]);
    release();
  });

  it('drops held keys and the base ramp', async () => {
    const state = makeStateStub();
    const ws = connect(state);
    sendMsg(ws, { joint: 'shoulder_pan', direction: 1 });
    sendMsg(ws, { estop: {} });
    // The latch is what the tick reads, so the stub has to follow the robot.
    state.isEStopTriggered.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(33 * 5);

    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
  });

  it('is honoured again even when a stop is already latched', async () => {
    const state = makeStateStub();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect(state);

    sendMsg(ws, { estop: { reason: 'again' } });
    await vi.advanceTimersByTimeAsync(0);

    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'again');
    // The handshake already said "latched"; the reply is a second, distinct
    // frame carrying THIS operator's reason.
    expect(ws.messagesOfType('estop')).toHaveLength(2);
    expect(lastEstop(ws)).toEqual({ type: 'estop', active: true, reason: 'again' });
  });
});

describe('keyboard-teleop — the error channel', () => {
  it('names the joints this embodiment does not have', () => {
    const state = makeStateStub();
    // The sim rejects the WHOLE pose over one unknown name, so the operator has
    // to be told which name it was.
    state.setTeleopJoint.mockImplementation((name: string) => (name === 'shoulder_pan' ? 0 : null));
    const ws = connect(state);

    sendMsg(ws, { positions: { shoulder_pan: 0.1, left_wrist_yaw_joint: 0.2 } });

    const err = ws.messagesOfType('error')[0];
    expect(err).toMatchObject({ type: 'error', code: 'unknown_joints' });
    expect(err.message).toContain('left_wrist_yaw_joint');
    expect(typeof err.at).toBe('string');
  });

  it('sends one frame per code per session, however often it recurs', () => {
    const state = makeStateStub();
    state.setTeleopJoint.mockReturnValue(null);
    const ws = connect(state);

    for (let i = 0; i < 5; i += 1) sendMsg(ws, { positions: { nope: 0.1 } });

    expect(ws.messagesOfType('error')).toHaveLength(1);
  });

  it('a second, different code is not hidden by the first', () => {
    const state = makeStateStub();
    state.setTeleopJoint.mockReturnValue(null);
    const ws = connect(state);
    sendMsg(ws, { positions: { nope: 0.1 } });

    state.isEStopTriggered.mockReturnValue(true);
    sendMsg(ws, { joint: 'shoulder_pan', delta: 0.1 });

    // One boolean latch made these hide each other; a per-code set does not.
    expect(ws.messagesOfType('error').map((m) => m.code)).toEqual([
      'unknown_joints',
      'estop_latched',
    ]);
  });

  it('relays a pose-stream failure that happened inside the state manager', () => {
    const state = makeStateStub();
    const ws = connect(state);

    state.fireTeleopError('action_rejected', 'G1_READ_ONLY — command path disabled');
    state.fireTeleopError('action_rejected', 'G1_READ_ONLY — command path disabled');

    const errors = ws.messagesOfType('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'action_rejected',
      message: 'G1_READ_ONLY — command path disabled',
    });
  });

  it('stops relaying once the socket is gone', () => {
    const state = makeStateStub();
    const ws = connect(state);
    ws.emit('close');

    state.fireTeleopError('sidecar_down', 'fetch failed');

    expect(ws.messagesOfType('error')).toHaveLength(0);
  });
});

describe('keyboard-teleop — keepalive', () => {
  it('pings, so a dead NAT binding stops looking like a still operator', () => {
    const state = makeStateStub();
    const ws = connect(state);
    expect(ws.ping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(ws.ping).toHaveBeenCalledTimes(3);
  });

  it('stops pinging a closed socket', () => {
    const state = makeStateStub();
    const ws = connect(state);
    ws.emit('close');

    vi.advanceTimersByTime(60_000);
    expect(ws.ping).not.toHaveBeenCalled();
  });
});

describe('keyboard-teleop — the latch is pushed, not polled', () => {
  /**
   * A console that only learns about the stops it caused itself is worse than
   * no indicator: it reports a healthy link over a robot that is discarding
   * every command. Verified live against the running sim, where the safety
   * monitor had latched on its own (flat battery raises 'Critical battery
   * level', which `checkSystemHealth` treats as a system failure) while the
   * desktop console still read "Stream armed".
   */
  it('tells a client that connects to an ALREADY latched robot', () => {
    const state = makeStateStub();
    state.isEStopTriggered.mockReturnValue(true);
    state.getEStopState.mockReturnValue({ status: 'triggered', reason: 'Critical system error detected' });

    const ws = connect(state);

    expect(ws.messagesOfType('estop')[0]).toEqual({
      type: 'estop',
      active: true,
      reason: 'Critical system error detected',
    });
  });

  it('says so explicitly when the robot is NOT latched, rather than staying silent', () => {
    // Silence is what the client cannot distinguish from an old build. One
    // frame on connect means the console never has to assume.
    const ws = connect(makeStateStub());
    expect(ws.messagesOfType('estop')[0]).toEqual({ type: 'estop', active: false, reason: null });
  });

  it('pushes a latch raised by somebody else, without the client sending anything', () => {
    const state = makeStateStub();
    const ws = connect(state);
    expect(ws.messagesOfType('estop')).toHaveLength(1);

    // The fleet console / a zone trigger / the safety monitor — not this socket.
    state.isEStopTriggered.mockReturnValue(true);
    state.getEStopState.mockReturnValue({ status: 'triggered', reason: 'zone breach' });
    vi.advanceTimersByTime(100);

    const frames = ws.messagesOfType('estop');
    expect(frames).toHaveLength(2);
    expect(frames[1]).toEqual({ type: 'estop', active: true, reason: 'zone breach' });
  });

  it('pushes the RELEASE too, so a console can believe a reset it did not perform', () => {
    const state = makeStateStub();
    state.isEStopTriggered.mockReturnValue(true);
    state.getEStopState.mockReturnValue({ status: 'triggered', reason: 'zone breach' });
    const ws = connect(state);

    state.isEStopTriggered.mockReturnValue(false);
    state.getEStopState.mockReturnValue({ status: 'armed', reason: null });
    vi.advanceTimersByTime(100);

    const frames = ws.messagesOfType('estop');
    expect(frames[frames.length - 1]).toEqual({ type: 'estop', active: false, reason: null });
  });

  it('sends one frame per transition, not one per tick', () => {
    const state = makeStateStub();
    const ws = connect(state);
    state.isEStopTriggered.mockReturnValue(true);
    vi.advanceTimersByTime(1000); // ~30 ticks
    expect(ws.messagesOfType('estop')).toHaveLength(2); // connect + the one edge
  });
});
