/**
 * @file keyboard-teleop-held.test.ts
 * @description TASK-407: every `{wrists}` / `{positions}` frame is answered —
 *              with `{type:'state', positions}` when an arm followed, or with
 *              `{type:'state', held:true, side, reason}` when it did not — and
 *              the held answers stay at or below 20 Hz per socket. Without them
 *              a refused arm read as a dead link in the headset. Same fake-ws
 *              harness as keyboard-teleop-arming.test.ts.
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
  hardwareClient: {
    locoMove,
    // TASK-398: a sidecar that reports no gate — moves go out as before.
    getLocoCapability: () => ({ gate: 'unknown', moveEnabled: null, idsVerified: false, ids: null }),
    getMeasuredFsmId: () => null,
    getBaseState: () => null,
    mayMoveBase: () => true,
  },
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

/** Every held answer this socket received, in order. */
const held = (ws: FakeWs) => ws.sent.filter((m) => m.type === 'state' && m.held === true);
/** Every real state answer (positions, no held flag). */
const states = (ws: FakeWs) => ws.sent.filter((m) => m.type === 'state' && m.held !== true);

describe('pose frames the agent refuses are answered, not dropped', () => {
  it('answers a pose frame on an unbound socket with held: lease', async () => {
    const { state, connect } = makeServer(true);
    const ws = connect();
    send(ws, POSE);
    await flush();
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(ws.errors('lease_required')).toHaveLength(1);
    expect(held(ws)).toEqual([{ type: 'state', held: true, side: 'left', reason: 'lease' }]);
  });

  it('answers a latched E-stop with held: estop', async () => {
    const { state, connect } = makeServer();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect();
    send(ws, { wrists: { left: WRIST, right: WRIST } });
    await flush();
    expect(held(ws).at(-1)).toMatchObject({ held: true, side: 'both', reason: 'estop' });
  });

  it('answers a robot with no arm chain with held: ik_held', async () => {
    const { connect } = makeServer();
    const ws = connect();
    send(ws, { wrists: { left: null, right: WRIST } });
    await flush();
    expect(ws.errors('ik_unsupported')).toHaveLength(1);
    expect(held(ws).at(-1)).toMatchObject({ side: 'right', reason: 'ik_held' });
  });

  it('answers a frame that moved an arm with the existing state, and no held flag', async () => {
    const { connect } = makeServer();
    const ws = connect();
    send(ws, POSE);
    await flush();
    expect(held(ws)).toHaveLength(0);
    expect(states(ws).at(-1)).toHaveProperty('positions');
  });

  describe('on an arm-only sidecar', () => {
    beforeEach(() => {
      sidecar.setMode('arm_sdk');
      install(1);
    });

    it('says lease when the socket holds none', async () => {
      const { connect } = makeServer();
      const ws = connect();
      send(ws, { hb: 1 });
      send(ws, POSE);
      await flush();
      expect(held(ws).at(-1)).toMatchObject({ reason: 'lease' });
    });

    it('says not_armed while the re-engage latch waits for a fresh squeeze', async () => {
      const { connect } = makeServer();
      const ws = connect();
      await bindHolding(ws);
      send(ws, POSE);
      await flush();
      expect(ws.errors('arm_reengage_required').length).toBeGreaterThan(0);
      expect(held(ws).at(-1)).toMatchObject({ side: 'left', reason: 'not_armed' });
    });

    it('says unclutched for a wrist pose on a side whose grip is open', async () => {
      const { connect } = makeServer();
      const ws = connect();
      await bindAndBeat(ws);
      hb(ws, GRIP_NONE);
      send(ws, { wrists: { left: WRIST, right: null } });
      await flush();
      expect(held(ws).at(-1)).toMatchObject({ side: 'left', reason: 'unclutched' });
    });

    it('says arm_gate when the heartbeat has gone quiet', async () => {
      const { connect } = makeServer();
      const ws = connect();
      await bindAndBeat(ws);
      await vi.advanceTimersByTimeAsync(HB_TIMEOUT_MS + 100);
      send(ws, POSE);
      await flush();
      expect(held(ws).at(-1)).toMatchObject({ reason: 'arm_gate' });
    });
  });
});

describe('the held answers are rate limited to 20 Hz per socket', () => {
  it('answers every frame of a 20 Hz stream within one tick', async () => {
    const { connect } = makeServer(true);
    const ws = connect();
    for (let i = 0; i < 20; i++) {
      send(ws, POSE);
      // One agent tick (33 ms) later the answer is out.
      await vi.advanceTimersByTimeAsync(33);
      expect(held(ws)).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(17);
    }
  });

  it('coalesces a burst: never more than one held answer per 50 ms', async () => {
    const { connect } = makeServer(true);
    const ws = connect();
    // 200 frames over one second — ten times the rig's own rate.
    for (let i = 0; i < 200; i++) {
      send(ws, POSE);
      await vi.advanceTimersByTimeAsync(5);
    }
    await vi.advanceTimersByTimeAsync(100);
    const count = held(ws).length;
    expect(count).toBeGreaterThanOrEqual(19);
    expect(count).toBeLessThanOrEqual(21);
  });

  it('keeps the existing deduplicated error alongside the held answers', async () => {
    const { connect } = makeServer(true);
    const ws = connect();
    for (let i = 0; i < 10; i++) {
      send(ws, POSE);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(ws.errors('lease_required')).toHaveLength(1);
    expect(held(ws)).toHaveLength(10);
  });

  it('a real answer supersedes a refusal still waiting for its slot', async () => {
    const { state, connect } = makeServer();
    const ws = connect();
    state.isEStopTriggered.mockReturnValue(true);
    send(ws, POSE);
    send(ws, POSE); // coalesced, waiting
    state.isEStopTriggered.mockReturnValue(false);
    send(ws, POSE); // moves the arm
    await vi.advanceTimersByTimeAsync(100);
    expect(held(ws)).toHaveLength(1);
    expect(states(ws).at(-1)).toHaveProperty('positions');
  });
});
