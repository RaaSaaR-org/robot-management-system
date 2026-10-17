/**
 * @file keyboard-teleop-arming.test.ts
 * @description TASK-393: a real G1's arms through `/ws/keyboard-teleop`. On an
 *              arm-only sidecar (`write_mode: arm_sdk`) a joint frame arms the
 *              sidecar only for a socket that holds the control lease and is
 *              heartbeating and has made a clutch rising edge since the last
 *              disarm it did not cause; heartbeat silence, lease loss, an
 *              E-stop and the socket closing all give the arms back, and none
 *              of them is undone by a grip that was already held. Same fake-ws
 *              harness as
 *              keyboard-teleop-lease.test.ts, with a real ArmRegistry over a
 *              fake sidecar.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const locoMove = vi.hoisted(() => vi.fn(async (..._args: number[]) => ({ ok: true })));
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: { locoMove },
  getSidecarUrl: () => 'http://localhost:0',
}));

import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import { ControlLeaseRegistry, hashLeaseId } from '../../control-lease/control-lease.js';
import { ArmRegistry, type ArmClient } from '../../teleop/arm-registry.js';
import { UNKNOWN_ARM_STATUS, type SidecarArmStatus } from '../../hardware/arm-status.js';
import type { RobotStateManager, TeleopErrorListener } from '../../robot/state.js';

const SECRET = 'raw-lease-secret';
const HB_TIMEOUT_MS = 200;

/** The sidecar's side of the contract, as far as the agent can see it. */
class FakeSidecar implements ArmClient {
  status: SidecarArmStatus = { ...UNKNOWN_ARM_STATUS };
  armedLocal = false;
  armCalls: Array<number | null> = [];
  disarmCalls = 0;
  armResult: { ok: boolean; error?: string } = { ok: true };
  setMode(mode: SidecarArmStatus['writeMode']) {
    this.status = { ...this.status, writeMode: mode };
  }
  requiresArming() {
    return this.status.writeMode === 'arm_sdk';
  }
  isArmedLocally() {
    return this.armedLocal;
  }
  getArmStatus() {
    return this.status;
  }
  async arm(generation: number | null) {
    this.armCalls.push(generation);
    if (this.armResult.ok) {
      this.armedLocal = true;
      this.status = { ...this.status, armed: true, armWeight: 1 };
    }
    return this.armResult;
  }
  async disarm() {
    this.disarmCalls += 1;
    this.armedLocal = false;
    this.status = { ...this.status, armed: false, armWeight: 0 };
    return { ok: true };
  }
  async refreshArmStatus() {
    return this.status;
  }
}

class FakeWs extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: Record<string, unknown>[] = [];
  ping = vi.fn();
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  ofType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
  errors(code: string) {
    return this.sent.filter((m) => m.type === 'error' && m.code === code);
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
    triggerEmergencyStop: vi.fn(),
    onTeleopError: vi.fn((_l: TeleopErrorListener) => () => {}),
  };
}

const send = (ws: FakeWs, payload: unknown) => ws.emit('message', Buffer.from(JSON.stringify(payload)));
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

let dir: string;
let leases: ControlLeaseRegistry;
let sidecar: FakeSidecar;
let arms: ArmRegistry;
const openSockets: FakeWs[] = [];

function makeServer(required = false) {
  const state = makeStateStub();
  const wss = createKeyboardTeleopWebSocket(state as unknown as RobotStateManager, {
    controlLease: leases,
    leaseRequired: () => required,
    armRegistry: arms,
    heartbeatTimeoutMs: HB_TIMEOUT_MS,
  });
  const connect = (): FakeWs => {
    const ws = new FakeWs();
    wss.emit('connection', ws);
    openSockets.push(ws);
    return ws;
  };
  return { state, connect };
}

const close = (ws: FakeWs) => {
  ws.readyState = WebSocket.CLOSED;
  ws.emit('close');
};

function install(generation: number) {
  leases.install({
    generation,
    leaseIdHash: hashLeaseId(SECRET),
    sessionId: `session-${generation}`,
    userId: 'user-1',
    displayName: 'Ada',
    tenantId: null,
    ttlMs: 60_000,
  });
}

let beat = 0;
/** One heartbeat carrying the clutch as the VR rig reports it. */
function hb(ws: FakeWs, clutch: unknown = { left: false, right: false }) {
  send(ws, { hb: ++beat, clutch });
}
const GRIP_BOTH = { left: true, right: true };
const GRIP_NONE = { left: false, right: false };

/** The operator lets go, then squeezes: the rising edge arming needs. */
function squeeze(ws: FakeWs, clutch: unknown = GRIP_BOTH) {
  hb(ws, GRIP_NONE);
  hb(ws, clutch);
}

/** Bind, beat with the grip open, then squeeze — ready to arm on the next frame. */
async function bindAndBeat(ws: FakeWs, generation = 1) {
  send(ws, { bind: { leaseId: SECRET, generation } });
  await flush();
  squeeze(ws);
}

/** Bind and beat with the grip ALREADY held: no edge has been seen. */
async function bindHolding(ws: FakeWs, generation = 1) {
  send(ws, { bind: { leaseId: SECRET, generation } });
  await flush();
  hb(ws, GRIP_BOTH);
}

/** Keep the heartbeat alive across `ms` of fake time, clutch unchanged. */
async function beatFor(ws: FakeWs, ms: number, clutch: unknown = GRIP_BOTH) {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100);
    hb(ws, clutch);
  }
}

const WRIST = { p: [0.3, 0.2, -0.3], q: [0, 0, 0, 1] };

const POSE = { positions: { left_shoulder_pitch_joint: 0.3 } };

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleop-arm-'));
  leases = new ControlLeaseRegistry({
    robotId: 'robot-1',
    filePath: path.join(dir, 'control-lease.json'),
    enforced: () => true,
  });
  sidecar = new FakeSidecar();
  arms = new ArmRegistry(sidecar, { retryCooldownMs: 1000 });
  locoMove.mockClear();
  controlOwnerLock.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const ws of openSockets.splice(0)) close(ws);
  arms.reset();
  leases.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a sidecar with nothing to arm (the sim, older sidecars)', () => {
  it('drives exactly as before: no lease, no heartbeat, no /arm', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    send(ws, POSE);
    await flush();
    expect(state.setTeleopJoint).toHaveBeenCalledWith('left_shoulder_pitch_joint', 0.3);
    expect(sidecar.armCalls).toHaveLength(0);
    expect(ws.ofType('arm')[0]).toMatchObject({ type: 'arm', writeMode: null, armed: false });
  });
});

describe('an arm-only sidecar (write_mode: arm_sdk)', () => {
  beforeEach(() => {
    sidecar.setMode('arm_sdk');
    install(1);
  });

  it('refuses a joint frame from a socket without the lease, and does not apply it', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    send(ws, { hb: 1 });
    send(ws, POSE);
    await flush();
    expect(ws.errors('arm_requires_lease')).toHaveLength(1);
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(sidecar.armCalls).toHaveLength(0);
  });

  it('refuses a bound socket that sends no heartbeat', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    send(ws, { bind: { leaseId: SECRET, generation: 1 } });
    await flush();
    send(ws, POSE);
    await flush();
    expect(ws.errors('arm_requires_heartbeat')).toHaveLength(1);
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
  });

  it('arms once, with the lease generation, for a bound heartbeating socket', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    expect(state.setTeleopJoint).toHaveBeenCalledTimes(2);
    expect(ws.ofType('arm').at(-1)).toMatchObject({ armed: true, writeMode: 'arm_sdk', mine: true });
  });

  it('heartbeat silence halts the socket, disarms and says so; re-arming takes release then squeeze', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armedLocal).toBe(true);

    await vi.advanceTimersByTimeAsync(HB_TIMEOUT_MS + 100);
    expect(sidecar.disarmCalls).toBe(1);
    expect(ws.errors('heartbeat_lost')).toHaveLength(1);
    expect(ws.ofType('heartbeat').at(-1)).toEqual({ type: 'heartbeat', state: 'lost' });

    // Frames that trickle in after the loss do nothing.
    state.setTeleopJoint.mockClear();
    send(ws, POSE);
    await flush();
    expect(state.setTeleopJoint).not.toHaveBeenCalled();

    // The link comes back with the grip still held: nothing re-arms.
    hb(ws, GRIP_BOTH);
    expect(ws.ofType('heartbeat').at(-1)).toEqual({ type: 'heartbeat', state: 'live' });
    send(ws, POSE);
    await flush();
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(sidecar.armCalls).toEqual([1]);
    expect(ws.errors('arm_reengage_required')).toHaveLength(1);

    squeeze(ws);
    send(ws, POSE);
    await flush();
    expect(state.setTeleopJoint).toHaveBeenCalled();
    expect(sidecar.armCalls).toEqual([1, 1]);
  });

  it('a socket that keeps heartbeating stays armed while the operator holds still', async () => {
    const { connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    // …and with the grip let go: releasing the clutch is not a disarm.
    await beatFor(ws, 1000, GRIP_NONE);
    expect(sidecar.disarmCalls).toBe(0);
    expect(ws.errors('heartbeat_lost')).toHaveLength(0);
  });

  it('losing the lease disarms', async () => {
    const { connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    install(2);
    await flush();
    expect(sidecar.disarmCalls).toBe(1);
    expect(ws.ofType('lease').at(-1)).toMatchObject({ state: 'revoked' });
  });

  it('an E-stop from the socket disarms before it latches', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    let disarmedBeforeLatch = false;
    state.triggerEmergencyStop.mockImplementation(() => {
      disarmedBeforeLatch = sidecar.disarmCalls === 1;
    });
    send(ws, { estop: { reason: 'test' } });
    expect(disarmedBeforeLatch).toBe(true);
  });

  it('an E-stop latched elsewhere releases this socket\'s claim', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    state.isEStopTriggered.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(40);
    expect(sidecar.disarmCalls).toBe(1);
  });

  it('closing the last engaged socket disarms; closing one of two does not', async () => {
    const { connect } = makeServer();
    const a = connect();
    const b = connect();
    await bindAndBeat(a);
    await bindAndBeat(b);
    send(a, POSE);
    send(b, POSE);
    await flush();
    close(a);
    expect(sidecar.disarmCalls).toBe(0);
    close(b);
    expect(sidecar.disarmCalls).toBe(1);
  });

  it('a refused /arm reaches the operator in the sidecar\'s own words', async () => {
    sidecar.armResult = { ok: false, error: 'estop latched on the sidecar' };
    const { connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    await beatFor(ws, 100);
    expect(ws.errors('arm_failed')[0]?.message).toContain('estop latched on the sidecar');
    // A refusal is a disarm the operator did not cause: a held grip does not
    // retry it every second, a fresh squeeze does.
    await beatFor(ws, 1500);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    squeeze(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1, 1]);
  });

  it('a held key stops integrating once the sidecar disarmed itself', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, { joint: 'left_elbow_joint', direction: 1 });
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(state.applyTeleopDelta).toHaveBeenCalled();

    // The sidecar's own dead-man fired (a 409 not_armed cleared the flag).
    sidecar.armedLocal = false;
    hb(ws, GRIP_BOTH);
    await vi.advanceTimersByTimeAsync(40);
    state.applyTeleopDelta.mockClear();
    hb(ws, GRIP_BOTH);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
    // Nothing re-armed on its own: re-arming takes a new frame from the operator.
    expect(sidecar.armCalls).toEqual([1]);
  });

  it('refuses Home on the real arms, every time, and moves nothing', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, { preset: 'home' });
    send(ws, { preset: 'home' });
    await flush();
    expect(ws.errors('home_unavailable')).toHaveLength(2);
    expect(state.homeTeleopJoints).not.toHaveBeenCalled();
    expect(sidecar.armCalls).toHaveLength(0);
  });

  it('a latched sidecar E-stop refuses before any /arm is attempted', async () => {
    sidecar.status = { ...sidecar.status, estopLatched: true };
    const { connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toHaveLength(0);
    expect(ws.errors('arm_estop_latched')).toHaveLength(1);
  });

  // ---- the re-engage latch (TASK-393 review) ---------------------------------

  it('the first arm of a session needs the grip seen released before a squeeze counts', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindHolding(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toHaveLength(0);
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(ws.errors('arm_reengage_required')[0]?.message).toMatch(/release the grip/);
    expect(ws.ofType('arm').at(-1)).toMatchObject({ engage: 'need_release', clutch: GRIP_BOTH });

    hb(ws, GRIP_NONE);
    expect(ws.ofType('arm').at(-1)).toMatchObject({ engage: 'need_press' });
    hb(ws, GRIP_BOTH);
    expect(ws.ofType('arm').at(-1)).toMatchObject({ engage: 'ready' });
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    expect(ws.ofType('arm').at(-1)).toMatchObject({ engage: 'holding', armed: true });
  });

  it('a heartbeating client that never reports a clutch cannot arm the real arms', async () => {
    const { connect } = makeServer();
    const ws = connect();
    send(ws, { bind: { leaseId: SECRET, generation: 1 } });
    await flush();
    send(ws, { hb: 1 });
    send(ws, POSE);
    send(ws, { hb: 2 });
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toHaveLength(0);
    expect(ws.errors('arm_requires_clutch')).toHaveLength(1);
  });

  it('after an E-stop reset a grip still held does not re-arm — release then squeeze does', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);

    state.isEStopTriggered.mockReturnValue(true);
    await beatFor(ws, 200);
    expect(sidecar.disarmCalls).toBe(1);
    // The operator lets go and squeezes again DURING the latch: that edge does
    // not count, because nothing could arm while it was made.
    squeeze(ws);
    await beatFor(ws, 100);

    state.isEStopTriggered.mockReturnValue(false);
    await beatFor(ws, 500);
    state.setTeleopJoint.mockClear();
    for (let i = 0; i < 10; i++) {
      send(ws, POSE);
      await vi.advanceTimersByTimeAsync(50);
      hb(ws, GRIP_BOTH);
    }
    expect(sidecar.armCalls).toEqual([1]);
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(ws.ofType('arm').at(-1)).toMatchObject({ engage: 'need_release', armed: false });

    squeeze(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1, 1]);
    expect(state.setTeleopJoint).toHaveBeenCalled();
  });

  it('the socket\'s own E-stop, once reset, needs a fresh squeeze too', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    state.isEStopTriggered.mockReturnValue(true);
    send(ws, { estop: { reason: 'test' } });
    await beatFor(ws, 200);
    state.isEStopTriggered.mockReturnValue(false);
    await beatFor(ws, 200);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
  });

  it('a lease taken over and bound again needs a fresh squeeze', async () => {
    const { connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    install(2);
    await flush();
    expect(sidecar.disarmCalls).toBe(1);
    send(ws, { bind: { leaseId: SECRET, generation: 2 } });
    await flush();
    hb(ws, GRIP_BOTH);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    squeeze(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1, 2]);
  });

  it('the sidecar disarming itself (dead-man, 409) is not undone by a held grip', async () => {
    const { connect } = makeServer();
    const ws = connect();
    await bindAndBeat(ws);
    send(ws, POSE);
    await flush();
    sidecar.armedLocal = false;
    sidecar.status = { ...sidecar.status, armed: false, armWeight: 0 };
    await beatFor(ws, 100);
    expect(ws.ofType('arm').at(-1)).toMatchObject({ engage: 'need_release', mine: false });
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    squeeze(ws);
    send(ws, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1, 1]);
  });

  it('a tracked hand (no clutch) never arms the real arms', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    await bindHolding(ws);
    // A hands-only operator: the rig reports both clutches open, always.
    hb(ws, GRIP_NONE);
    for (let i = 0; i < 5; i++) {
      send(ws, { wrists: { left: WRIST, right: WRIST } });
      send(ws, { hands: { left: { wrist: [0, 0, 0], thumb: [0.05, 0, 0], index: [0.1, 0, 0], middle: [0.1, 0, 0.01] }, right: null } });
      hb(ws, GRIP_NONE);
    }
    await flush();
    expect(sidecar.armCalls).toHaveLength(0);
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(ws.errors('arm_side_unclutched')).toHaveLength(1);
  });

  it('on the real arms only the clutched side of a wrist frame is offered for arming', async () => {
    const { connect } = makeServer();
    const ws = connect();
    send(ws, { bind: { leaseId: SECRET, generation: 1 } });
    await flush();
    // Left on a controller, right a tracked hand.
    squeeze(ws, { left: true, right: false });
    send(ws, { wrists: { left: null, right: WRIST } });
    await flush();
    expect(sidecar.armCalls).toHaveLength(0);
    expect(ws.errors('arm_side_unclutched')).toHaveLength(1);
    send(ws, { wrists: { left: WRIST, right: WRIST } });
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
  });

  it('a released key is a stop and needs no arm', async () => {
    const { connect } = makeServer();
    const ws = connect();
    await bindHolding(ws);
    send(ws, { joint: 'left_elbow_joint', direction: 0 });
    await flush();
    expect(ws.errors('arm_reengage_required')).toHaveLength(0);
    // The keyboard reports one clutch, as a boolean.
    hb(ws, false);
    hb(ws, true);
    send(ws, { joint: 'left_elbow_joint', direction: 1 });
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
  });

  it('another console re-arming before this socket\'s tick does not revive its stale claim', async () => {
    // Two consoles under one lease, each its own server so their poses can be
    // told apart. A drives; B has squeezed but sent nothing yet.
    const one = makeServer();
    const two = makeServer();
    const a = one.connect();
    const b = two.connect();
    await bindAndBeat(a);
    send(a, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    await bindAndBeat(b);

    // The sidecar disarms itself (dead-man, 409) and, before A's next tick can
    // notice, B's first frame arms it afresh.
    sidecar.armedLocal = false;
    sidecar.status = { ...sidecar.status, armed: false, armWeight: 0 };
    send(b, POSE);
    expect(sidecar.armCalls).toEqual([1, 1]);
    one.state.setTeleopJoint.mockClear();
    send(a, POSE);
    await flush();

    // A's grip never let go: B's new arm is not A's.
    expect(one.state.setTeleopJoint).not.toHaveBeenCalled();
    expect(a.errors('arm_reengage_required').length).toBeGreaterThan(0);
    expect(a.ofType('arm').at(-1)).toMatchObject({ engage: 'need_release', mine: false });
    expect(two.state.setTeleopJoint).toHaveBeenCalledWith('left_shoulder_pitch_joint', 0.3);
  });

  it('a claim refused during the /arm cooldown is not left behind to keep the arms up', async () => {
    sidecar.armResult = { ok: false, error: 'not yet' };
    const one = makeServer();
    const two = makeServer();
    const a = one.connect();
    await bindAndBeat(a);
    send(a, POSE);
    await flush();
    await beatFor(a, 100, GRIP_NONE);
    // A fresh squeeze inside the cooldown is refused...
    squeeze(a);
    send(a, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1]);
    expect(arms.view().claims).toBe(0);

    // ...and leaves nothing that would outlive the console that does arm.
    sidecar.armResult = { ok: true };
    await beatFor(a, 1100, GRIP_NONE);
    const b = two.connect();
    await bindAndBeat(b);
    send(b, POSE);
    await flush();
    expect(sidecar.armCalls).toEqual([1, 1]);
    close(b);
    expect(sidecar.disarmCalls).toBe(1);
  });
});
