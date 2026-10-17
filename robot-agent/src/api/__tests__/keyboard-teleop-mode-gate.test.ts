/**
 * @file keyboard-teleop-mode-gate.test.ts
 * @description TASK-398 on the teleop socket: against a sidecar that only
 *              changes modes (`G1_LOCO_ENABLED=fsm`), head turns and
 *              thumbsticks are IDLE — no sidecar call, no log line, one sticky
 *              error — the `{type:'base'}` frame carries the measured mode and
 *              `moveEnabled:false`, and `{estop}` latches without a velocity.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

const sidecar = vi.hoisted(() => ({
  gate: 'fsm' as 'fsm' | 'full' | 'unknown',
  mode: 'limp' as string,
  fsmId: 1 as number | null,
  locoMove: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: {
    locoMove: sidecar.locoMove,
    getLocoCapability: () => ({
      gate: sidecar.gate,
      moveEnabled: sidecar.gate === 'unknown' ? null : sidecar.gate === 'full',
      idsVerified: false,
      ids: null,
    }),
    getMeasuredFsmId: () => sidecar.fsmId,
    getBaseState: () => (sidecar.fsmId === null
      ? null
      : { fsmId: sidecar.fsmId, mode: sidecar.mode, ageS: 0.2, error: null }),
    mayMoveBase: () => sidecar.gate !== 'fsm',
  },
  getSidecarUrl: () => 'http://localhost:0',
}));

import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import type { RobotStateManager, TeleopErrorListener } from '../../robot/state.js';

class FakeWs extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: Array<Record<string, unknown>> = [];
  ping = vi.fn();
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

function makeStateStub() {
  return {
    enableTeleop: vi.fn().mockReturnValue({}),
    disableTeleop: vi.fn(),
    homeTeleopJoints: vi.fn(),
    applyTeleopDelta: vi.fn().mockReturnValue(0),
    setTeleopJoint: vi.fn().mockReturnValue(0),
    getTeleopPositions: vi.fn().mockReturnValue({}),
    getActiveJointConfig: vi.fn().mockReturnValue([]),
    getState: vi.fn().mockReturnValue({ robotType: 'g1_edu' }),
    isEStopTriggered: vi.fn().mockReturnValue(false),
    getAgentSafetyState: vi.fn(() => ({
      estopLatched: false, estopReason: null, estopAt: null,
      damped: false, lastFsmId: 500, place: null, bootId: '',
    })),
    getEStopState: vi.fn().mockReturnValue({ status: 'armed', reason: null }),
    triggerEmergencyStop: vi.fn(async () => null),
    onTeleopError: vi.fn((_l: TeleopErrorListener) => () => {}),
  };
}

const open: FakeWs[] = [];

function connect() {
  const state = makeStateStub();
  const wss = createKeyboardTeleopWebSocket(state as unknown as RobotStateManager);
  const ws = new FakeWs();
  wss.emit('connection', ws);
  open.push(ws);
  return { ws, state };
}

const send = (ws: FakeWs, payload: unknown) => ws.emit('message', Buffer.from(JSON.stringify(payload)));

beforeEach(() => {
  vi.useFakeTimers();
  sidecar.gate = 'fsm';
  sidecar.mode = 'limp';
  sidecar.fsmId = 1;
  sidecar.locoMove.mockClear();
  controlOwnerLock.reset();
});

afterEach(() => {
  for (const ws of open.splice(0)) {
    ws.readyState = WebSocket.CLOSED;
    ws.emit('close');
  }
  vi.useRealTimers();
});

describe('a sidecar that only changes modes', () => {
  it('turns 100 head-turn / thumbstick frames into zero sidecar calls and one error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ws } = connect();
    for (let i = 0; i < 100; i++) {
      send(ws, { move: { vx: 0, vy: 0, omega: i % 2 ? 0.4 : -0.4 } });
      await vi.advanceTimersByTimeAsync(30);
    }
    expect(sidecar.locoMove).not.toHaveBeenCalled();
    const errors = ws.ofType('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('loco_disabled');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says so in the base frame on connect, with the measured mode', () => {
    const { ws } = connect();
    expect(ws.ofType('base')).toEqual([{
      type: 'base', damped: true, fsmId: 1, mode: 'limp', measured: true,
      moveEnabled: false, modeControl: 'fsm',
    }]);
  });

  it('sends a new base frame on every edge of the measured mode', async () => {
    const { ws } = connect();
    sidecar.mode = 'stand';
    sidecar.fsmId = 4;
    await vi.advanceTimersByTimeAsync(100);
    sidecar.mode = 'balance';
    sidecar.fsmId = 500;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(500);   // no repeat while it stays
    expect(ws.ofType('base').map((f) => [f.mode, f.fsmId, f.damped])).toEqual([
      ['limp', 1, true], ['stand', 4, false], ['balance', 500, false],
    ]);
  });

  it('an {estop} latches and sends no velocity', async () => {
    const { ws, state } = connect();
    send(ws, { estop: { reason: 'B pressed' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'B pressed');
    expect(sidecar.locoMove).not.toHaveBeenCalled();
  });
});

describe('a sidecar that walks (the sim)', () => {
  it('still zeroes the base on {estop}, after the latch', async () => {
    sidecar.gate = 'full';
    const order: string[] = [];
    const { ws, state } = connect();
    state.triggerEmergencyStop.mockImplementation(async () => {
      order.push('trigger');
      return null;
    });
    sidecar.locoMove.mockImplementation(async () => {
      order.push('locoMove');
      return { ok: true };
    });
    send(ws, { estop: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['trigger', 'locoMove']);
  });
});
