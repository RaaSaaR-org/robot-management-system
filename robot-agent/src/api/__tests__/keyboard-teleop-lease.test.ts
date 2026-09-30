/**
 * @file keyboard-teleop-lease.test.ts
 * @description TASK-315: with `CONTROL_LEASE_REQUIRED` on, a
 *              `/ws/keyboard-teleop` socket is an observer until it binds to
 *              the installed control lease, and loses motion authority the
 *              moment that lease is fenced, released or expires. Same harness
 *              as keyboard-teleop-drive.test.ts (emit 'connection' with a fake
 *              ws), with a real `ControlLeaseRegistry` on a temp file and the
 *              hardware client mocked.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const locoMove = vi.hoisted(() =>
  vi.fn(async (..._args: number[]): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
);
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: { locoMove },
  getSidecarUrl: () => 'http://localhost:0',
}));

import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import { ControlLeaseRegistry, hashLeaseId, type InstallRequest } from '../../control-lease/control-lease.js';
import type { RobotStateManager, TeleopErrorListener } from '../../robot/state.js';

const SECRET = 'raw-lease-secret';

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
    enableTeleop: vi.fn().mockReturnValue({ j1: 0 }),
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

function installReq(generation: number, overrides: Partial<InstallRequest> = {}): InstallRequest {
  return {
    generation,
    leaseIdHash: hashLeaseId(SECRET),
    sessionId: `session-${generation}`,
    userId: 'user-1',
    displayName: 'Ada',
    tenantId: null,
    ttlMs: 5_000,
    ...overrides,
  };
}

const send = (ws: FakeWs, payload: unknown) => ws.emit('message', Buffer.from(JSON.stringify(payload)));
/** Let the handler's `await` on the mocked RPC settle. */
const settle = () => new Promise((r) => setImmediate(r));

let dir: string;
let clock: number;
let leases: ControlLeaseRegistry;
const openSockets: FakeWs[] = [];

/** One server per test, like production has one — the bound count is per server. */
function makeServer(required: boolean) {
  const state = makeStateStub();
  const wss = createKeyboardTeleopWebSocket(state as unknown as RobotStateManager, {
    controlLease: leases,
    leaseRequired: () => required,
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

async function bind(ws: FakeWs, generation: number, leaseId = SECRET) {
  send(ws, { bind: { leaseId, generation } });
  await settle();
}

const movesSent = () => locoMove.mock.calls.filter((c) => c[0] !== 0 || c[1] !== 0 || c[2] !== 0);
const stopsSent = () => locoMove.mock.calls.filter((c) => c[0] === 0 && c[1] === 0 && c[2] === 0);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleop-lease-'));
  clock = 1_000;
  leases = new ControlLeaseRegistry({
    robotId: 'robot-1',
    filePath: path.join(dir, 'control-lease.json'),
    now: () => clock,
    enforced: () => true,
  });
  locoMove.mockClear();
  locoMove.mockImplementation(async () => ({ ok: true }));
  controlOwnerLock.reset();
});

afterEach(() => {
  for (const ws of openSockets.splice(0)) close(ws);
  leases.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  controlOwnerLock.reset();
});

describe('CONTROL_LEASE_REQUIRED on — an unbound socket is an observer', () => {
  it('connects without claiming teleop, enabling teleop or preempting Agent Mode', () => {
    controlOwnerLock.claim('agent');
    const { state, connect } = makeServer(true);
    const ws = connect();

    expect(controlOwnerLock.get()).toBe('agent');
    expect(state.enableTeleop).not.toHaveBeenCalled();
    expect(ws.ofType('control')).toHaveLength(0);
    expect(ws.ofType('config')).toHaveLength(1);
    expect(ws.ofType('estop')).toHaveLength(1);
    expect(ws.ofType('base')).toHaveLength(1);
    const [lease] = ws.ofType('lease');
    expect(lease).toMatchObject({ state: 'unbound', required: true });
    expect((lease!.holder as { state: string }).state).toBe('none');
    expect(JSON.stringify(ws.sent)).not.toContain(hashLeaseId(SECRET));
  });

  it('discards move and joint frames and reports lease_required once', async () => {
    leases.install(installReq(1));
    const { state, connect } = makeServer(true);
    const ws = connect();

    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    send(ws, { joint: 'j1', delta: 0.1 });
    send(ws, { joint: 'j1', position: 0.2 });
    send(ws, { joint: 'j1', direction: 1 });
    send(ws, { positions: { j1: 0.3 } });
    send(ws, { preset: 'home' });
    await settle();

    expect(locoMove).not.toHaveBeenCalled();
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(state.homeTeleopJoints).not.toHaveBeenCalled();
    expect(ws.errors('lease_required')).toHaveLength(1);
  });

  it('latches the E-Stop from an unbound socket', () => {
    const { state, connect } = makeServer(true);
    const ws = connect();
    send(ws, { estop: { reason: 'observer saw a person' } });
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'observer saw a person');
    expect(ws.ofType('estop').at(-1)).toMatchObject({ active: true });
  });

  it('closing an unbound socket releases nobody else\'s control', () => {
    controlOwnerLock.claim('agent');
    const { state, connect } = makeServer(true);
    close(connect());
    expect(controlOwnerLock.get()).toBe('agent');
    expect(state.disableTeleop).not.toHaveBeenCalled();
  });
});

describe('CONTROL_LEASE_REQUIRED on — binding', () => {
  it('a socket bound with the right secret and generation drives', async () => {
    leases.install(installReq(1));
    const { state, connect } = makeServer(true);
    const ws = connect();
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await bind(ws, 1);

    expect(ws.ofType('lease').at(-1)).toEqual({ type: 'lease', state: 'bound', generation: 1 });
    expect(ws.ofType('control').at(-1)).toMatchObject({ owner: 'teleop', preempted: null });
    expect(state.enableTeleop).toHaveBeenCalledTimes(1);
    expect(leases.observe().bound).toBe(1);

    send(ws, { move: { vx: 0.1, vy: 0, omega: 0 } });
    send(ws, { joint: 'j1', delta: 0.1 });
    await settle();
    expect(movesSent().length).toBeGreaterThan(0);
    expect(state.applyTeleopDelta).toHaveBeenCalledWith('j1', 0.1);
    // The earlier refusal latch was reset by the bind — so the next unbound
    // refusal would be reported again rather than hidden.
    expect(ws.errors('lease_required')).toHaveLength(1);
  });

  it.each([
    ['a wrong secret', 1, 'not-the-secret'],
    ['an old generation', 1, SECRET],
    ['a future generation', 3, SECRET],
  ])('refuses %s with lease_invalid and stays unbound', async (_label, generation, leaseId) => {
    leases.install(installReq(1));
    leases.install(installReq(2));
    const { state, connect } = makeServer(true);
    const ws = connect();
    await bind(ws, generation, leaseId);

    expect(ws.errors('lease_invalid')).toHaveLength(1);
    expect(ws.ofType('lease').some((m) => m.state === 'bound')).toBe(false);
    expect(state.enableTeleop).not.toHaveBeenCalled();
    expect(controlOwnerLock.get()).toBe('idle');
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await settle();
    expect(locoMove).not.toHaveBeenCalled();
  });

  it('refuses a bind to an expired lease', async () => {
    leases.install(installReq(1));
    clock += 6_000;
    const { connect } = makeServer(true);
    const ws = connect();
    await bind(ws, 1);
    expect(ws.errors('lease_invalid')).toHaveLength(1);
  });

  it('refuses a malformed bind', async () => {
    leases.install(installReq(1));
    const { connect } = makeServer(true);
    const ws = connect();
    send(ws, { bind: { leaseId: 42, generation: '1' } });
    await settle();
    expect(ws.errors('lease_invalid')).toHaveLength(1);
  });

  it('connecting does not preempt Agent Mode; binding does, after the stop resolves', async () => {
    leases.install(installReq(1));
    controlOwnerLock.claim('agent');
    let resolveStop!: (v: { ok: boolean }) => void;
    locoMove.mockImplementationOnce(() => new Promise((r) => { resolveStop = r; }));
    const { connect } = makeServer(true);
    const ws = connect();
    expect(controlOwnerLock.get()).toBe('agent');

    send(ws, { bind: { leaseId: SECRET, generation: 1 } });
    await settle();
    expect(locoMove).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(ws.ofType('lease').some((m) => m.state === 'bound')).toBe(false);

    resolveStop({ ok: true });
    await settle();
    expect(ws.ofType('lease').at(-1)).toMatchObject({ state: 'bound', generation: 1 });
    expect(ws.ofType('control').at(-1)).toMatchObject({ owner: 'teleop', preempted: 'agent' });
  });
});

describe('CONTROL_LEASE_REQUIRED on — fencing', () => {
  it('installing N+1 stops the base, revokes N and drops a move queued behind an in-flight RPC', async () => {
    leases.install(installReq(1));
    const { state, connect } = makeServer(true);
    const ws = connect();
    await bind(ws, 1);
    locoMove.mockClear();

    let resolveInFlight!: (v: { ok: boolean }) => void;
    locoMove.mockImplementationOnce(() => new Promise((r) => { resolveInFlight = r; }));
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } }); // in flight
    send(ws, { move: { vx: 0.3, vy: 0.1, omega: 0 } }); // queued in the pending slot
    expect(locoMove).toHaveBeenCalledTimes(1);

    leases.install(installReq(2, { leaseIdHash: hashLeaseId('someone-else') }));
    const callsAtFence = locoMove.mock.calls.length;
    expect(stopsSent()).toHaveLength(1);
    expect(ws.ofType('lease').at(-1)).toEqual({ type: 'lease', state: 'revoked', generation: 1 });
    expect(controlOwnerLock.get()).toBe('idle');
    expect(state.disableTeleop).toHaveBeenCalled();

    resolveInFlight({ ok: true });
    await settle();
    await settle();
    // Nothing after the fence may move the robot — not the queued move, not a new one.
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    send(ws, { joint: 'j1', delta: 0.1 });
    await settle();
    const after = locoMove.mock.calls.slice(callsAtFence);
    expect(after.filter((c) => c[0] !== 0 || c[1] !== 0 || c[2] !== 0)).toHaveLength(0);
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
    expect(ws.errors('lease_required')).toHaveLength(1);
    // No auto-rebind to the successor.
    expect(ws.ofType('lease').filter((m) => m.state === 'bound')).toHaveLength(1);
  });

  it('a release fences the bound socket with revoked', async () => {
    leases.install(installReq(1));
    const { connect } = makeServer(true);
    const ws = connect();
    await bind(ws, 1);
    leases.release({ generation: 1 });
    expect(ws.ofType('lease').at(-1)).toMatchObject({ state: 'revoked', generation: 1 });
  });

  it('an expired lease stops driving at processing time and tells the client', async () => {
    leases.install(installReq(1));
    const { connect } = makeServer(true);
    const ws = connect();
    await bind(ws, 1);
    locoMove.mockClear();

    clock += 6_000; // past the 5 s TTL; the registry's own timer has not fired
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await settle();

    expect(movesSent()).toHaveLength(0);
    expect(stopsSent()).toHaveLength(1);
    expect(ws.ofType('lease').at(-1)).toEqual({ type: 'lease', state: 'expired', generation: 1 });
    expect(ws.errors('lease_required')).toHaveLength(1);
  });

  it('an explicit rebind to the new generation drives again', async () => {
    leases.install(installReq(1));
    const { connect } = makeServer(true);
    const ws = connect();
    await bind(ws, 1);
    leases.install(installReq(2));
    await bind(ws, 2);
    expect(ws.ofType('lease').at(-1)).toMatchObject({ state: 'bound', generation: 2 });
    locoMove.mockClear();
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await settle();
    expect(movesSent().length).toBeGreaterThan(0);
  });
});

describe('CONTROL_LEASE_REQUIRED on — several sockets on one generation', () => {
  it('closing one leaves the other driving, and bound tracks both', async () => {
    leases.install(installReq(1));
    const { state, connect } = makeServer(true);
    const a = connect();
    const b = connect();
    await bind(a, 1);
    await bind(b, 1);
    expect(leases.observe().bound).toBe(2);
    expect(controlOwnerLock.holderCount()).toBe(2);

    close(a);
    expect(leases.observe().bound).toBe(1);
    expect(controlOwnerLock.get()).toBe('teleop');
    expect(state.disableTeleop).not.toHaveBeenCalled();

    locoMove.mockClear();
    send(b, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await settle();
    expect(movesSent().length).toBeGreaterThan(0);

    close(b);
    expect(leases.observe().bound).toBe(0);
    expect(controlOwnerLock.get()).toBe('idle');
    expect(state.disableTeleop).toHaveBeenCalledTimes(1);
  });

  it('a repeated bind on the same socket is idempotent', async () => {
    leases.install(installReq(1));
    const { connect } = makeServer(true);
    const ws = connect();
    await bind(ws, 1);
    await bind(ws, 1);
    expect(leases.observe().bound).toBe(1);
    expect(controlOwnerLock.holderCount()).toBe(1);
  });
});

describe('CONTROL_LEASE_REQUIRED off — unchanged', () => {
  it('claims on connect, sends no lease frames and ignores {bind}', async () => {
    leases.install(installReq(1));
    controlOwnerLock.claim('agent');
    const { state, connect } = makeServer(false);
    const ws = connect();
    expect(controlOwnerLock.get()).toBe('teleop');
    expect(state.enableTeleop).toHaveBeenCalledTimes(1);
    expect(ws.ofType('control')).toEqual([{ type: 'control', owner: 'teleop', preempted: 'agent' }]);

    await bind(ws, 1);
    expect(ws.ofType('lease')).toHaveLength(0);
    expect(ws.ofType('error')).toHaveLength(0);
    expect(leases.observe().bound).toBe(0);

    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await settle();
    expect(movesSent().length).toBeGreaterThan(0);
  });
});
