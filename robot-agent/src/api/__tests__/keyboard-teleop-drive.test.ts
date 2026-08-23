/**
 * @file keyboard-teleop-drive.test.ts
 * @description The `{move:{vx,vy,omega}}` path on the teleop WebSocket — how a
 *              VR operator walks the robot. Driven the same way as
 *              keyboard-teleop.test.ts (emit 'connection' with a fake ws), with
 *              the hardware client mocked so the locomotion RPC is observable.
 *
 *              These are the safety-shaped parts: velocities are clamped to the
 *              robot's own configured speed AS A VECTOR, the commanded speed
 *              only ever rises at a bounded rate, letting go stops it now rather
 *              than on expiry, an operator who disappears cannot leave it
 *              walking, and a slow sidecar cannot make a queue decide where it
 *              goes — while never swallowing the one message of a burst that
 *              must arrive, the stop.
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

// Typed loosely on purpose: the tests drive both the accepting and the
// refusing sidecar through this same mock.
const locoMove = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; error?: string; rpcCode?: number }> => ({ ok: true })),
);
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: { locoMove },
  getSidecarUrl: () => 'http://localhost:0',
}));

import {
  createKeyboardTeleopWebSocket,
  slewBaseVelocity,
  clampPlanar,
} from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import { config } from '../../config/config.js';
import type { RobotStateManager, TeleopErrorListener } from '../../robot/state.js';

const MAX_MPS = Math.abs(config.agentMode.walkSpeedMps) || 0.4;
const MAX_RAD_S = ((Math.abs(config.agentMode.turnSpeedDps) || 45) * Math.PI) / 180;

class FakeWs extends EventEmitter {
  /** Widened to `number`: `afterEach` closes leaked sockets by moving it. */
  readyState: number = WebSocket.OPEN;
  sent: unknown[] = [];
  ping = vi.fn();
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  messagesOfType(type: string) {
    return this.sent.filter((m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && (m as Record<string, unknown>).type === type,
    );
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
    // The base's FSM, as the socket reads it every tick for `{type:'base'}`.
    // Standing by default: a stub that reported a damped base would put every
    // test in this file behind the state the feature exists to get OUT of.
    getAgentSafetyState: vi.fn(() => ({
      estopLatched: false, estopReason: null, estopAt: null,
      damped: false, lastFsmId: 500, place: null, bootId: '',
    })),
    // Read on connect and on every latch transition, so the console follows the
    // robot into and out of a stop it did not cause itself.
    getEStopState: vi.fn().mockReturnValue({ status: 'armed', reason: null }),
    triggerEmergencyStop: vi.fn(),
    onTeleopError: vi.fn((_l: TeleopErrorListener) => () => {}),
  };
}

/**
 * Sockets opened by a test, so `afterEach` can close them.
 *
 * NOT housekeeping — test isolation. Every connection starts a 33 Hz
 * `setInterval` that only `cleanup()` clears, and `locoMove` is a module-level
 * mock shared by the whole file. A socket left open by an earlier test whose
 * ramp had not finished went on calling `locoMove` into that shared mock; the
 * fake-timer tests below then read those calls as their own, which is how
 * "walks the commanded speed up to the stick" intermittently saw a speed drop to
 * a foreign socket's first ramp step. `vi.useFakeTimers()` does not cancel
 * already-scheduled native intervals, so the leak crossed the timer boundary
 * too.
 */
const openSockets: FakeWs[] = [];

function connect(): FakeWs {
  return connectWithState().ws;
}

/** Same, but hands back the state stub so a test can latch the E-Stop from OUTSIDE. */
function connectWithState(): { ws: FakeWs; state: ReturnType<typeof makeStateStub> } {
  const state = makeStateStub();
  const wss = createKeyboardTeleopWebSocket(state as unknown as RobotStateManager);
  const ws = new FakeWs();
  wss.emit('connection', ws);
  openSockets.push(ws);
  return { ws, state };
}

const send = (ws: FakeWs, payload: unknown) => ws.emit('message', Buffer.from(JSON.stringify(payload)));

/** Let the handler's `await` on the mocked RPC settle. */
const settle = () => new Promise((r) => setImmediate(r));

/**
 * HOLD the stick, the way a real client does: `VrTeleopRig` re-sends `{move}`
 * every `DRIVE_SEND_INTERVAL_S` (~100 ms) for as long as the stick is deflected.
 *
 * The ramp tests used to send ONE `{move}` and then advance a second of timers,
 * which quietly asserted that the agent keeps accelerating a robot whose
 * operator has gone silent — the agent refreshes `MOVE_TTL_S` on every tick the
 * ramp runs, so a single frame from a hard-pushed stick bought half a second of
 * unattended acceleration plus the TTL on top. It does not do that any more (see
 * `keyboard-teleop.ts`, the ramp block), so a test that wants a completed ramp
 * has to hold the stick like the thing it is standing in for.
 */
async function hold(ws: FakeWs, move: { vx: number; vy: number; omega: number }, ms: number) {
  const STEP = 100;
  for (let elapsed = 0; elapsed < ms; elapsed += STEP) {
    send(ws, { move });
    await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - elapsed));
  }
}

beforeEach(() => {
  locoMove.mockClear();
  locoMove.mockImplementation(async () => ({ ok: true }));
  controlOwnerLock.reset();
});

afterEach(() => {
  // Real timers are back by now (the inner suites restore them first), so this
  // clears the intervals the leaked sockets registered — see `openSockets`.
  for (const ws of openSockets.splice(0)) {
    ws.readyState = WebSocket.CLOSED;
    ws.emit('close');
  }
  vi.restoreAllMocks();
  controlOwnerLock.reset();
});

describe('driving the base from the teleop socket', () => {
  it('forwards a stick push as a base velocity with a finite time to live', async () => {
    const ws = connect();
    send(ws, { move: { vx: 0.3, vy: 0.1, omega: 0.2 } });
    await settle();

    expect(locoMove).toHaveBeenCalledOnce();
    const [vx, vy, omega, ttl] = locoMove.mock.calls[0] as unknown as number[];
    // The first command is the ramp's first step, not the stick — but it points
    // exactly where the stick does, and omega is never slewed.
    expect(vy / vx).toBeCloseTo(0.1 / 0.3, 6);
    expect(Math.hypot(vx, vy)).toBeLessThan(Math.hypot(0.3, 0.1));
    expect(omega).toBe(0.2);
    // The dead man: a command that never expires is one a crashed client leaves
    // running.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThan(1);
  });

  it('clamps the angular rate per axis — the planar limit is not an angular one', async () => {
    const ws = connect();
    send(ws, { move: { vx: 0, vy: 0, omega: 99 } });
    await settle();

    const [, , omega] = locoMove.mock.calls[0] as unknown as number[];
    expect(omega).toBeCloseTo(MAX_RAD_S, 6);
  });

  it('treats nonsense as zero rather than passing NaN to the locomotion RPC', async () => {
    const ws = connect();
    send(ws, { move: { vx: 'fast', omega: null } });
    await settle();

    const [vx, vy, omega] = locoMove.mock.calls[0] as unknown as number[];
    expect([vx, vy, omega]).toEqual([0, 0, 0]);
  });

  it('stops NOW when the stick returns to centre, instead of waiting out the expiry', async () => {
    const ws = connect();
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    await settle();
    send(ws, { move: { vx: 0, vy: 0, omega: 0 } });
    await settle();

    const [vx, , , ttl] = locoMove.mock.calls[1] as unknown as number[];
    expect(vx).toBe(0);
    // Zero duration, not MOVE_TTL_S: letting go is the moment they are most
    // likely to be stopping for a reason.
    expect(ttl).toBe(0);
  });

  it('never lets a slow sidecar stack commands — a queue must not decide where the robot goes', async () => {
    let release!: () => void;
    locoMove.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );
    const ws = connect();
    send(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
    await settle();
    for (let i = 0; i < 5; i += 1) send(ws, { move: { vx: 0.1 * i, vy: 0, omega: 0 } });
    await settle();

    expect(locoMove).toHaveBeenCalledOnce();
    release();
    await settle();
  });

  it('delivers the LAST command of a burst, and only the last, once the sidecar answers', async () => {
    let release!: () => void;
    locoMove.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ ok: true }); }),
    );
    const ws = connect();

    // First command blocks the sidecar. The next two arrive while it is stuck:
    // an intermediate sample, then the stop.
    send(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
    await settle();
    send(ws, { move: { vx: 0.2, vy: 0, omega: 0 } });
    send(ws, { move: { vx: 0, vy: 0, omega: 0 } });
    await settle();
    expect(locoMove).toHaveBeenCalledOnce();

    release();
    await settle();

    // Exactly one more call, and it is the zero. This is the bug the pending
    // slot exists for: the client sends ONE zero and goes quiet, so a dropped
    // stop is never re-sent by anybody, and the robot walked on until the TTL
    // expired.
    expect(locoMove).toHaveBeenCalledTimes(2);
    expect(locoMove.mock.calls[1] as unknown as number[]).toEqual([0, 0, 0, 0]);
    // The intermediate is discarded, never replayed — replaying it would let a
    // queue decide where the robot goes.
    const intermediates = (locoMove.mock.calls as unknown as number[][]).filter(
      (c) => c[0] === 0.2,
    );
    expect(intermediates).toHaveLength(0);
  });

  it('stops the robot when the operator’s socket closes', async () => {
    const ws = connect();
    send(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
    await settle();
    locoMove.mockClear();

    ws.emit('close');
    await settle();

    expect(locoMove).toHaveBeenCalledOnce();
    expect(locoMove.mock.calls[0] as unknown as number[]).toEqual([0, 0, 0, 0]);
  });

  it('does not stop the base for a socket that never drove — a keyboard tab is not the driver', async () => {
    const ws = connect();
    send(ws, { positions: { left_elbow_joint: 0.4 } });
    await settle();

    ws.emit('close');
    await settle();

    expect(locoMove).not.toHaveBeenCalled();
  });

  it('a stop-only socket is still not a driver', async () => {
    const ws = connect();
    send(ws, { move: { vx: 0, vy: 0, omega: 0 } });
    await settle();
    locoMove.mockClear();

    ws.emit('close');
    await settle();

    expect(locoMove).not.toHaveBeenCalled();
  });

  it('reports a refusing locomotion sidecar once, not once per tick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    locoMove.mockImplementation(async () => ({ ok: false, error: 'no sidecar' }));
    const ws = connect();

    for (let i = 0; i < 4; i += 1) {
      send(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
      await settle();
    }

    expect(locoMove.mock.calls.length).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalledOnce();
    // And once on the wire too — the operator is in a headset and will never
    // see a server log.
    const errors = ws.messagesOfType('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'loco_unavailable', message: 'no sidecar' });
  });

  it('tells a 403 apart from a dead sidecar — one is a setting somebody can change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    locoMove.mockImplementation(async () => ({
      ok: false,
      locoDisabled: true,
      error: 'locomotion is not enabled on this robot',
    }));
    const ws = connect();

    send(ws, { move: { vx: 0.4, vy: 0, omega: 0 } });
    await settle();

    expect(ws.messagesOfType('error')[0]).toMatchObject({ code: 'loco_disabled' });
    warn.mockRestore();
  });

  it('leaves the arm path alone — a move message moves no joints', async () => {
    // Through the helper, not hand-rolled: this test leaves a ramp running, and
    // a socket that is not in `openSockets` is a 33 Hz interval nothing ever
    // clears — which is precisely what was polluting the fake-timer suite below.
    const { ws, state } = connectWithState();

    send(ws, { move: { vx: 0.4, vy: 0, omega: 0.2 } });
    await settle();

    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(state.applyTeleopDelta).not.toHaveBeenCalled();
  });
});

describe('clampPlanar — the limit is on the VECTOR, not on each axis', () => {
  it('caps a diagonal push at the configured speed and keeps its heading', () => {
    // The bug: vx and vy were clamped independently, so a 45° stick push left
    // at hypot(0.4, 0.4) = 0.566 m/s against a configured walk speed of 0.4 —
    // 41% over the limit this file's own header promises.
    const { vx, vy } = clampPlanar(99, 99, 0.4);
    expect(Math.hypot(vx, vy)).toBeCloseTo(0.4, 12);
    expect(vx).toBeCloseTo(vy, 12);
  });

  it('preserves an arbitrary heading exactly', () => {
    const { vx, vy } = clampPlanar(3, -4, 0.4);
    expect(Math.hypot(vx, vy)).toBeCloseTo(0.4, 12);
    // 3:-4 in, 3:-4 out — only the magnitude was taken away.
    expect(Math.atan2(vy, vx)).toBeCloseTo(Math.atan2(-4, 3), 12);
  });

  it('leaves a pure-forward push at FULL speed — this is a cap, not a tax', () => {
    expect(clampPlanar(0.4, 0, 0.4)).toEqual({ vx: 0.4, vy: 0 });
    expect(clampPlanar(99, 0, 0.4).vx).toBeCloseTo(0.4, 12);
  });

  it('passes anything already inside the limit through untouched', () => {
    expect(clampPlanar(0.1, 0.05, 0.4)).toEqual({ vx: 0.1, vy: 0.05 });
    expect(clampPlanar(0, 0, 0.4)).toEqual({ vx: 0, vy: 0 });
  });
});

describe('slewBaseVelocity — the ramp only limits speeding UP', () => {
  const dt = 0.033;
  const at = (v: { vx: number; vy: number }) => Math.hypot(v.vx, v.vy);

  it('rises monotonically and reaches the target in about half a second', () => {
    let v = { vx: 0, vy: 0, omega: 0 };
    const target = { vx: 0.4, vy: 0, omega: 0 };
    const speeds: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      v = slewBaseVelocity(v, target, dt);
      speeds.push(at(v));
    }
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    }
    // 0.8 m/s² × 0.033 s = 0.0264 m/s per tick, so 0 → 0.4 m/s lands on tick 16
    // (0.528 s of ramp). Measured, not rounded: tick 15 is still at 0.396.
    expect(speeds[14]).toBeCloseTo(0.396, 6);
    expect(speeds[15]).toBe(0.4);
    expect(speeds[19]).toBe(0.4);
  });

  it('never overshoots the target', () => {
    const v = slewBaseVelocity({ vx: 0.39, vy: 0, omega: 0 }, { vx: 0.4, vy: 0, omega: 0 }, dt);
    expect(v.vx).toBe(0.4);
  });

  it('hands a zero through instantly — the release-stop keeps its exact meaning', () => {
    expect(slewBaseVelocity({ vx: 0.4, vy: 0, omega: 1 }, { vx: 0, vy: 0, omega: 0 }, dt))
      .toEqual({ vx: 0, vy: 0, omega: 0 });
  });

  it('hands any decrease through instantly', () => {
    expect(slewBaseVelocity({ vx: 0.4, vy: 0, omega: 0 }, { vx: 0.05, vy: 0, omega: 0 }, dt))
      .toEqual({ vx: 0.05, vy: 0, omega: 0 });
  });

  it('never slews omega — a turn-in-place that lagged the stick would feel broken', () => {
    const v = slewBaseVelocity({ vx: 0, vy: 0, omega: 0 }, { vx: 0.4, vy: 0, omega: 0.7 }, dt);
    expect(v.omega).toBe(0.7);
    expect(v.vx).toBeLessThan(0.4);
  });

  it('holds the requested heading while it ramps', () => {
    const v = slewBaseVelocity({ vx: 0, vy: 0, omega: 0 }, { vx: 0.3, vy: 0.4, omega: 0 }, dt);
    expect(Math.atan2(v.vy, v.vx)).toBeCloseTo(Math.atan2(0.4, 0.3), 12);
  });
});

describe('the ramp on the wire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks the commanded speed up to the stick over ~0.5 s and stops there', async () => {
    const ws = connect();
    // Full deflection, the case that matters: on the VR controller the same
    // stick is elbow-pitch while the grip is held, so an operator letting go of
    // the grip to walk releases it with the stick already at the stop.
    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);

    const first = (locoMove.mock.calls[0] as unknown as number[])[0];
    expect(first).toBeLessThan(MAX_MPS / 4);

    await hold(ws, { vx: 99, vy: 0, omega: 0 }, 1000);
    const speeds = (locoMove.mock.calls as unknown as number[][]).map((c) => c[0]);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    }
    expect(speeds.at(-1)).toBeCloseTo(MAX_MPS, 6);

    // And once it has arrived the ramp stops driving the tick: the client's own
    // ~10 Hz stream is what refreshes the TTL from here, so this adds no RPCs.
    const settled = locoMove.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(locoMove.mock.calls.length).toBe(settled);
  });

  it('abandons the ramp when the client goes silent, instead of accelerating alone', async () => {
    // `issueBase` refreshes `MOVE_TTL_S` on every tick the ramp runs, so the ramp
    // was its own dead-man reset: one `{move}` from a hard-pushed stick followed
    // by silence — Wi-Fi gone, headset off, tab throttled, the exact cases the
    // TTL exists for — had the agent walking the robot up to full speed BY
    // ITSELF, then coasting the TTL on top. About a quarter of a metre of
    // unattended travel, against a documented promise of a stop within 0.35 s.
    const ws = connect();
    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    const opening = (locoMove.mock.calls[0] as unknown as number[])[0];

    // Silence from here. The dead-man is 350 ms; give it a full second.
    await vi.advanceTimersByTimeAsync(1000);
    const speeds = (locoMove.mock.calls as unknown as number[][]).map((c) => c[0]);

    // It may coast out the remaining TTL, but it must never have reached the
    // speed the abandoned stick was asking for.
    expect(Math.max(...speeds)).toBeLessThan(MAX_MPS);
    // And it must stop issuing entirely.
    const quiet = locoMove.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(locoMove.mock.calls.length).toBe(quiet);
    expect(opening).toBeLessThan(MAX_MPS / 4);
  });

  it('ends a diagonal push at the limit, on the heading that was asked for', async () => {
    const ws = connect();
    await hold(ws, { vx: 99, vy: 99, omega: 0 }, 1000);

    const [vx, vy] = locoMove.mock.calls.at(-1) as unknown as number[];
    expect(Math.hypot(vx, vy)).toBeCloseTo(MAX_MPS, 6);
    expect(vx).toBeCloseTo(vy, 9);
  });

  it('a stop mid-ramp goes out at once and abandons the ramp', async () => {
    const ws = connect();
    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(100);
    send(ws, { move: { vx: 0, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);

    expect(locoMove.mock.calls.at(-1) as unknown as number[]).toEqual([0, 0, 0, 0]);
    const afterStop = locoMove.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(locoMove.mock.calls.length).toBe(afterStop);
  });
});

describe('frames that are not objects', () => {
  it('survives a valid-JSON non-object instead of taking the agent down with it', () => {
    // `JSON.parse` accepts all of these, and every branch in the handler reaches
    // for `'key' in msg` — which throws `TypeError: Cannot use 'in' operator` on
    // each one. The throw escaped `ws.on('message')`, and nothing in the process
    // installs an `uncaughtException` handler, so one of these frames on an
    // unauthenticated socket killed the agent that was driving the robot.
    const ws = connect();
    for (const frame of ['null', '123', '"x"', 'true', '[1,2]']) {
      expect(() => ws.emit('message', Buffer.from(frame))).not.toThrow();
    }
    // Still alive and still driving.
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    expect(locoMove).toHaveBeenCalled();
  });

  it('ignores malformed JSON, as before', () => {
    const ws = connect();
    expect(() => ws.emit('message', Buffer.from('{not json'))).not.toThrow();
    expect(locoMove).not.toHaveBeenCalled();
  });
});

describe('an E-Stop raised somewhere other than this socket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets the ramp, so the first move after the reset is not a full-speed shove', async () => {
    // THE BUG: only the socket's own `{estop}` handler zeroed `commanded`.
    // A latch raised by the fleet console, the safety monitor, a zone trigger or
    // another teleop socket left `commanded` holding the pre-stop velocity for
    // the whole latch, so the first `{move}` after the reset hit
    // `slewBaseVelocity`'s `speedTo <= speedFrom` shortcut and went straight out
    // at full speed — bypassing the acceleration limit at the exact moment the
    // ramp exists for.
    const { ws, state } = connectWithState();
    await hold(ws, { vx: 99, vy: 0, omega: 0 }, 1000);
    const steady = (locoMove.mock.calls.at(-1) as unknown as number[])[0];
    expect(steady).toBeCloseTo(MAX_MPS, 6);

    state.isEStopTriggered.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(100);
    state.isEStopTriggered.mockReturnValue(false);

    locoMove.mockClear();
    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    const first = (locoMove.mock.calls[0] as unknown as number[])[0];
    expect(first).toBeLessThan(MAX_MPS / 4);
  });

  it('never delivers a queued walk after the latch goes up', async () => {
    // THE CRITICAL ONE. `pendingMove` is a latest-wins slot drained when the
    // in-flight RPC resolves, and `locoMove` is allowed to block for SECONDS
    // (the sidecar's timeout is `duration + 5 s`). Nothing used to clear that
    // slot, so a stop could be overtaken by a walk that was already queued when
    // it happened — re-armed with a fresh TTL.
    const { ws, state } = connectWithState();
    let release: (v: { ok: boolean }) => void = () => {};
    locoMove.mockImplementationOnce(() => new Promise((r) => { release = r; }));

    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });   // stalls in flight
    await vi.advanceTimersByTimeAsync(0);
    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });   // lands in pendingMove
    await vi.advanceTimersByTimeAsync(1);

    // The latch goes up somewhere ELSE — fleet console, safety monitor, a
    // second operator. This socket is not told; it discovers it on the tick.
    state.isEStopTriggered.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(100);

    locoMove.mockClear();
    release({ ok: true });                             // the stalled RPC answers
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(100);

    const motion = (locoMove.mock.calls as unknown as number[][]).filter(
      (c) => c[0] !== 0 || c[1] !== 0 || c[2] !== 0,
    );
    expect(motion).toEqual([]);
  });

  it('never delivers a queued walk behind the stop that closes the socket', async () => {
    // Same slot, the other trigger. `cleanup()` sends its zero directly — and the
    // drain then re-commanded the walk behind it, defeating the dead-man at the
    // exact moment nobody is watching any more.
    const ws = connect();
    let release: (v: { ok: boolean }) => void = () => {};
    locoMove.mockImplementationOnce(() => new Promise((r) => { release = r; }));

    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    send(ws, { move: { vx: 99, vy: 0, omega: 0 } });
    await vi.advanceTimersByTimeAsync(1);

    ws.emit('close');
    locoMove.mockClear();
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(1);

    const motion = (locoMove.mock.calls as unknown as number[][]).filter(
      (c) => c[0] !== 0 || c[1] !== 0 || c[2] !== 0,
    );
    expect(motion).toEqual([]);
  });

  it('reports the refusal again on a SECOND latch, not once per socket lifetime', async () => {
    // `errorsSent` is a per-socket latch so a robot with no locomotion sidecar
    // cannot emit ten frames a second. `estop_latched` is the one code in it
    // that describes a CLEARABLE condition, and leaving it latched meant the
    // second latch of a long VR session produced no frame at all — the client
    // had no signal whatsoever that its input was being discarded.
    const { ws, state } = connectWithState();

    state.isEStopTriggered.mockReturnValue(true);
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    expect(ws.messagesOfType('error')).toHaveLength(1);

    state.isEStopTriggered.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(100);

    state.isEStopTriggered.mockReturnValue(true);
    send(ws, { move: { vx: 0.3, vy: 0, omega: 0 } });
    const errors = ws.messagesOfType('error');
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.code === 'estop_latched')).toBe(true);
  });
});
