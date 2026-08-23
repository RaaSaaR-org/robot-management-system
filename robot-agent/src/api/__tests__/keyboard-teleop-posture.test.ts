/**
 * @file keyboard-teleop-posture.test.ts
 * @description `{posture:'stand'}` and the `{type:'base'}` channel — the way an
 *              operator in a headset gets a damped base walking again.
 * @feature teleop
 *
 * THE STATE THIS EXISTS FOR. An E-Stop damps the base: `agentModeController`
 * sends StopMove and then `SetFsmId(1)`. Clearing the latch deliberately does
 * NOT undo that, because standing a collapsed humanoid up must be an explicit
 * act rather than the side effect of a UI click. So after every stop-and-reset
 * the robot's arms work — they are joint targets and never touch the loco FSM —
 * and its legs do not.
 *
 * Nothing said so. `SetVelocity` answers RPC_OK in a damped FSM and simply does
 * not integrate the velocity, so no error reached the console, the HUD went on
 * printing `SPEED 0.00`, and the wearer pushed a stick at a robot with no
 * intention of walking. Measured on the running stack: 30 `{move}` frames at
 * 0.4 m/s moved the base 3e-10 m; the identical stream after one `SetFsmId(500)`
 * moved it 1.2000 m.
 *
 * The way out was Agent Mode's `posture stand`, and Agent Mode refuses every
 * command while `controlOwnerLock` is held by teleop — which it is, for as long
 * as this socket is open. The operator holding the controls was the one caller
 * who could not ask.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import type { RobotStateManager } from '../../robot/state.js';
import type { JointConfig } from '../../robot/types.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';

const locoMove = vi.fn(async () => ({ ok: true }));
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: {
    locoMove: (...args: unknown[]) => locoMove(...(args as [])),
    sendJointPose: vi.fn(async () => ({ ok: true })),
  },
}));

import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';

class FakeWs extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: Record<string, unknown>[] = [];
  ping = vi.fn();
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

const JOINTS: JointConfig[] = [
  { name: 'left_shoulder_pitch_joint', axis: 'z', limitLower: -2, limitUpper: 2, defaultPosition: 0 },
];

function makeState(overrides: { damped?: boolean; latched?: boolean } = {}) {
  const agent = {
    estopLatched: false,
    estopReason: null,
    estopAt: null,
    damped: overrides.damped ?? false,
    lastFsmId: overrides.damped ? 1 : 500,
    place: null,
    bootId: '',
  };
  return {
    agent,
    enableTeleop: vi.fn(() => ({})),
    disableTeleop: vi.fn(),
    homeTeleopJoints: vi.fn(),
    applyTeleopDelta: vi.fn().mockReturnValue(0),
    setTeleopJoint: vi.fn(() => 0),
    getTeleopPositions: vi.fn(() => ({})),
    getActiveJointConfig: vi.fn(() => JOINTS),
    getState: vi.fn().mockReturnValue({ robotType: 'g1-edu' }),
    isEStopTriggered: vi.fn().mockReturnValue(overrides.latched ?? false),
    getEStopState: vi.fn().mockReturnValue({ status: 'armed', reason: null }),
    triggerEmergencyStop: vi.fn(),
    getAgentSafetyState: vi.fn(() => ({ ...agent })),
    onTeleopError: vi.fn(() => () => {}),
  };
}

type State = ReturnType<typeof makeState>;

function connect(state: State, standBase?: () => Promise<{ ok: boolean; error?: string }>) {
  const wss = createKeyboardTeleopWebSocket(
    state as unknown as RobotStateManager,
    standBase ? { standBase } : {},
  );
  const ws = new FakeWs();
  wss.emit('connection', ws);
  return ws;
}

function send(ws: FakeWs, payload: unknown) {
  ws.emit('message', Buffer.from(JSON.stringify(payload)));
}

beforeEach(() => {
  vi.useFakeTimers();
  controlOwnerLock.reset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  controlOwnerLock.reset();
});

describe('the base-state channel', () => {
  it('says on connect that the base is damped, before anything is commanded', () => {
    // On CONNECT, not on the first refusal: the operator has to know before
    // they push the stick, not by inferring it from a robot that did not move.
    const ws = connect(makeState({ damped: true }));

    expect(ws.ofType('base')).toEqual([{ type: 'base', damped: true, fsmId: 1 }]);
  });

  it('says on connect that a standing base is standing', () => {
    const ws = connect(makeState({ damped: false }));

    expect(ws.ofType('base')).toEqual([{ type: 'base', damped: false, fsmId: 500 }]);
  });

  it('follows a base damped by something else — one frame per transition', async () => {
    // The E-Stop that damps the base can be raised from the fleet page, by the
    // safety monitor, or by a second console. A channel that only reported this
    // socket's own commands would leave that operator looking at a stale HUD.
    const state = makeState({ damped: false });
    const ws = connect(state);
    expect(ws.ofType('base')).toHaveLength(1);

    state.agent.damped = true;
    state.agent.lastFsmId = 1;
    await vi.advanceTimersByTimeAsync(200);

    expect(ws.ofType('base')).toEqual([
      { type: 'base', damped: false, fsmId: 500 },
      { type: 'base', damped: true, fsmId: 1 },
    ]);

    // …and no repeat while it simply stays damped.
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.ofType('base')).toHaveLength(2);
  });
});

describe("{posture:'stand'}", () => {
  it('stands the base and reports the outcome, not the request', async () => {
    const state = makeState({ damped: true });
    const standBase = vi.fn(async () => {
      state.agent.damped = false;
      state.agent.lastFsmId = 500;
      return { ok: true };
    });
    const ws = connect(state, standBase);

    send(ws, { posture: 'stand' });
    await vi.advanceTimersByTimeAsync(50);

    expect(standBase).toHaveBeenCalledTimes(1);
    // The connect frame said damped; the second frame is the robot's answer.
    expect(ws.ofType('base')).toEqual([
      { type: 'base', damped: true, fsmId: 1 },
      { type: 'base', damped: false, fsmId: 500 },
    ]);
    // And the tick's edge detector does not then send a third, identical frame.
    await vi.advanceTimersByTimeAsync(500);
    expect(ws.ofType('base')).toHaveLength(2);
  });

  it('is refused while an E-Stop is latched — the damp is the stop working', async () => {
    // The base is damped BECAUSE somebody stopped the robot. Standing it back
    // up from under a live latch would be the teleop socket quietly undoing
    // half of an emergency stop.
    const state = makeState({ damped: true, latched: true });
    const standBase = vi.fn(async () => ({ ok: true }));
    const ws = connect(state, standBase);

    send(ws, { posture: 'stand' });
    await vi.advanceTimersByTimeAsync(50);

    expect(standBase).not.toHaveBeenCalled();
    expect(ws.ofType('error').map((e) => e.code)).toContain('estop_latched');
  });

  it('reports a refusal from the sidecar instead of leaving the console to guess', async () => {
    const state = makeState({ damped: true });
    const standBase = vi.fn(async () => ({ ok: false, error: 'sidecar: locomotion disabled' }));
    const ws = connect(state, standBase);

    send(ws, { posture: 'stand' });
    await vi.advanceTimersByTimeAsync(50);

    const errors = ws.ofType('error');
    expect(errors.map((e) => e.code)).toContain('stand_failed');
    expect(errors.find((e) => e.code === 'stand_failed')?.message)
      .toContain('locomotion disabled');
    // Still damped, and still SAYING so.
    expect(ws.ofType('base')).toEqual([{ type: 'base', damped: true, fsmId: 1 }]);
  });

  it('refuses any posture but stand, rather than passing a number to an FSM', async () => {
    // A teleop socket is unauthenticated. `{posture:'sit'}` from anything at all
    // would fold a 43-DOF humanoid up while an operator was working in it.
    const state = makeState({ damped: false });
    const standBase = vi.fn(async () => ({ ok: true }));
    const ws = connect(state, standBase);

    send(ws, { posture: 'sit' });
    send(ws, { posture: 1 });
    await vi.advanceTimersByTimeAsync(50);

    expect(standBase).not.toHaveBeenCalled();
    expect(ws.ofType('error').filter((e) => e.code === 'bad_posture')).toHaveLength(1);
  });

  it('says so when this agent has no base-posture path at all', async () => {
    const ws = connect(makeState({ damped: true }));

    send(ws, { posture: 'stand' });
    await vi.advanceTimersByTimeAsync(50);

    expect(ws.ofType('error').map((e) => e.code)).toContain('stand_unavailable');
  });

  it('survives a standBase that throws', async () => {
    const state = makeState({ damped: true });
    const ws = connect(state, async () => {
      throw new Error('DDS timeout');
    });

    send(ws, { posture: 'stand' });
    await vi.advanceTimersByTimeAsync(50);

    expect(ws.ofType('error').find((e) => e.code === 'stand_failed')?.message)
      .toContain('DDS timeout');
  });
});
