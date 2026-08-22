/**
 * @file keyboard-teleop-wrists.test.ts
 * @description Socket-level tests for the teleop endpoint's IK paths: `{wrists}`
 *              (arm IK + the trigger's grasp axis) and `{hands}` (DexPilot
 *              finger retargeting). Same harness as `keyboard-teleop.test.ts` —
 *              a fake `ws` EventEmitter driven through a stub
 *              RobotStateManager — but the stub is a G1 EDU built from the
 *              generated chain table, and it CLAMPS like the real
 *              `setTeleopJoint` does while recording what was asked for as well
 *              as what was applied. That split is the point: it is what lets a
 *              test tell "the clamp kept the solver honest" from "the solver
 *              stayed inside on its own".
 * @feature teleop
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

// Mocked so no test in this file can reach a real sidecar: socket cleanup and
// `{estop}` both command the base, and `locoMove` would otherwise fetch
// localhost.
const locoMove = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; error?: string; locoDisabled?: boolean }> => ({ ok: true })),
);
vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: { locoMove },
  getSidecarUrl: () => 'http://localhost:0',
}));

import { createKeyboardTeleopWebSocket } from '../keyboard-teleop.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import { peekTeleopModes, resetTeleopModes } from '../../teleop/teleop-mode.js';
import { ARM_REST } from '../../teleop/wrist-teleop.js';
import { jointNames as fingerJointNames } from '../../teleop/dexpilot.js';
import { G1_ARM_CHAINS, G1_FINGER_CHAINS, type Side } from '../../teleop/g1-chains.generated.js';
import type { RobotStateManager, TeleopErrorListener } from '../../robot/state.js';
import type { JointConfig } from '../../robot/types.js';

/** The seven arm joints per side, in the order the solver writes them. */
const ARM_JOINTS: Record<Side, string[]> = {
  left: G1_ARM_CHAINS.left.links.map((l) => l.joint),
  right: G1_ARM_CHAINS.right.links.map((l) => l.joint),
};
/** The seven Dex3 joints per side, in `FingerRetargeter.jointNames()` order. */
const FINGER_JOINTS: Record<Side, string[]> = {
  left: fingerJointNames('left'),
  right: fingerJointNames('right'),
};

/**
 * A wrist pose the left arm can actually reach, as the wire carries it:
 * metres from the EYE point, +x forward, +y left, +z up. Solves to ~0.35 mm of
 * position error from the rest pose, so a test that sees no motion is seeing a
 * refusal, not a solver that gave up.
 */
const LEFT_REACHABLE = [0.17, 0.2, -0.37];
/** Its mirror. `y` flips; nothing else does. */
const RIGHT_REACHABLE = [0.17, -0.2, -0.37];

/**
 * Four fingertips in the HAND's own frame, metres, origin at the wrist joint —
 * an adult hand held open, thumb abducted.
 *
 * Human anthropometry, not the robot's dimensions. The retargeting compares
 * these against a Dex3 whose fingertips sit 215 mm from the chain root and
 * whose thumb rests splayed 110 mm across the palm, and a fixture written at
 * the robot's scale is how an open hand came out as a fist with every test
 * passing.
 */
const OPEN_HAND = {
  wrist: [0, 0, 0],
  thumb: [0.098, 0.022, 0.058],
  index: [0.176, 0, 0.013],
  middle: [0.190, 0, -0.010],
};

/** The same hand closed: fingertips in to the palm, thumb over them. */
const CLOSED_HAND = {
  wrist: [0, 0, 0],
  thumb: [0.100, 0.055, 0.020],
  index: [0.070, 0.075, 0.014],
  middle: [0.072, 0.082, -0.008],
};

/** A fake ws connection: an EventEmitter that records what was sent. */
class FakeWs extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: unknown[] = [];
  /** The keepalive probe (real `ws` always has this; the fake must too). */
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

/** One `setTeleopJoint` call, before and after the joint's own limits. */
interface JointWrite {
  joint: string;
  requested: number;
  /** What the clamp let through — `null` for a joint this robot does not have. */
  applied: number | null;
}

/**
 * A stub RobotStateManager over an arbitrary joint config.
 *
 * `setTeleopJoint` mirrors the real one exactly: clamp to the advertised
 * limits, return what was stored, return `null` for an unknown name. Anything
 * looser would make every "stayed inside its limits" assertion in this file
 * vacuous, because the assertion would be about the stub rather than about the
 * solver.
 */
function makeStateStub(joints: JointConfig[], seed: Record<string, number>) {
  const limits = new Map(joints.map((j) => [j.name, j] as const));
  const positions: Record<string, number> = { ...seed };
  const teleopErrorListeners = new Set<TeleopErrorListener>();
  const writes: JointWrite[] = [];

  return {
    writes,
    /** Joint names in call order — what "and no other joint" asserts against. */
    jointsWritten: (): string[] => writes.map((w) => w.joint),
    /** The value ASKED FOR for a joint, most recent last. */
    requestedFor: (joint: string): number[] =>
      writes.filter((w) => w.joint === joint).map((w) => w.requested),
    limitsFor: (joint: string): JointConfig | undefined => limits.get(joint),

    enableTeleop: vi.fn(() => ({ ...positions })),
    disableTeleop: vi.fn(),
    homeTeleopJoints: vi.fn(),
    applyTeleopDelta: vi.fn().mockReturnValue(0),
    setTeleopJoint: vi.fn((joint: string, value: number): number | null => {
      const limit = limits.get(joint);
      if (!limit) {
        writes.push({ joint, requested: value, applied: null });
        return null;
      }
      const applied = Math.max(limit.limitLower, Math.min(limit.limitUpper, value));
      writes.push({ joint, requested: value, applied });
      positions[joint] = applied;
      return applied;
    }),
    getTeleopPositions: vi.fn(() => ({ ...positions })),
    getActiveJointConfig: vi.fn(() => joints),
    getState: vi.fn().mockReturnValue({ robotType: 'g1-edu' }),
    isEStopTriggered: vi.fn().mockReturnValue(false),
    getEStopState: vi.fn().mockReturnValue({ status: 'armed', reason: null }),
    triggerEmergencyStop: vi.fn(),
    onTeleopError: vi.fn((l: TeleopErrorListener) => {
      teleopErrorListeners.add(l);
      return () => teleopErrorListeners.delete(l);
    }),
  };
}

type StateStub = ReturnType<typeof makeStateStub>;

/**
 * A G1 EDU whose joint limits come from the SAME generated table the solver
 * plans against — not from numbers retyped here, which would let the two drift
 * apart and hide exactly the disagreement `setTeleopJoint`'s clamp exists to
 * catch.
 */
function makeG1Stub(): StateStub {
  const joints: JointConfig[] = [];
  const seed: Record<string, number> = {};
  for (const side of ['left', 'right'] as const) {
    G1_ARM_CHAINS[side].links.forEach((link, i) => {
      // `axis` is part of the config type but the teleop socket never reads it;
      // the chain table owns the geometry.
      joints.push({
        name: link.joint, axis: 'z',
        limitLower: link.lower, limitUpper: link.upper, defaultPosition: 0,
      });
      // Seeded from the sim's own idle pose, so the first solve of a session
      // starts where the arm is standing — the same reason the rig needs no
      // calibration step.
      seed[link.joint] = ARM_REST[side][i]!;
    });
    for (const finger of ['thumb', 'index', 'middle'] as const) {
      for (const link of G1_FINGER_CHAINS[side][finger].links) {
        joints.push({
          name: link.joint, axis: 'z',
          limitLower: link.lower, limitUpper: link.upper, defaultPosition: 0,
        });
        seed[link.joint] = 0;
      }
    }
  }
  return makeStateStub(joints, seed);
}

/** An SO-101 arm: five joints and a gripper, and not one G1 chain among them. */
function makeSo101Stub(): StateStub {
  const names = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const joints: JointConfig[] = names.map((name) => ({
    name, axis: 'z', limitLower: -2, limitUpper: 2, defaultPosition: 0,
  }));
  return makeStateStub(joints, Object.fromEntries(names.map((n) => [n, 0])));
}

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
  locoMove.mockClear();
  locoMove.mockImplementation(async () => ({ ok: true }));
  // The control lock is a refcounted process-wide singleton; sockets left open
  // by an earlier test would keep holders alive.
  controlOwnerLock.reset();
  // The mode tracker is module-level state shared by every socket in the
  // process. Without this, a mode marked by an earlier test is still "seen"
  // here and the mode assertions pass no matter what this test does.
  resetTeleopModes();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  controlOwnerLock.reset();
  resetTeleopModes();
});

describe('keyboard-teleop {wrists} — one side solves, and only that side moves', () => {
  it('writes the seven LEFT arm joints, in chain order, and nothing else', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });

    expect(state.jointsWritten()).toEqual(ARM_JOINTS.left);
    // Names, not counts: a solver that wrote the RIGHT arm's seven joints would
    // pass a count assertion while driving the wrong arm.
    expect(state.jointsWritten()).not.toContain('right_shoulder_pitch_joint');
    expect(ws.messagesOfType('state').length).toBeGreaterThanOrEqual(1);
  });

  it('the solved pose respects every joint limit without the clamp having to act', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });

    // Guards the loop below against passing on an empty list.
    expect(state.writes).toHaveLength(ARM_JOINTS.left.length);
    for (const write of state.writes) {
      const limit = state.limitsFor(write.joint)!;
      expect(write.requested).toBeGreaterThanOrEqual(limit.limitLower);
      expect(write.requested).toBeLessThanOrEqual(limit.limitUpper);
      // Asked for == applied: the solver's own limit handling did the work.
      // If this ever fails, the chain table and the joint config disagree.
      expect(write.applied).toBe(write.requested);
    }
  });

  it('both sides in one message drive both arms', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE }, right: { p: RIGHT_REACHABLE } } });

    expect(state.jointsWritten()).toEqual([...ARM_JOINTS.left, ...ARM_JOINTS.right]);
  });

  it('takes the first key it recognises, so a combined frame drops the second', () => {
    // ONE KEY PER FRAME is this socket's protocol for all nine message kinds
    // and predates the wrist stream — `{move}` + `{positions}` behaves the same
    // way. The `HandsMessage` JSDoc used to promise the opposite ("a message
    // may carry either or both"), which is a trap: a client written against it
    // gets working arms and permanently frozen fingers with no diagnostic. The
    // browser sends two `send()` calls, and the doc now says so.
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, {
      wrists: { left: { p: LEFT_REACHABLE } },
      hands: { left: CLOSED_HAND },
    });

    const written = state.jointsWritten();
    expect(written).toEqual(ARM_JOINTS.left);
    expect(written.some((j) => j.includes('hand'))).toBe(false);
  });
});

describe('keyboard-teleop {wrists} — a latched E-Stop discards the pose', () => {
  it('writes NOTHING and says why', () => {
    const state = makeG1Stub();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE }, right: { p: RIGHT_REACHABLE } } });

    // The whole point of the latch: a stopped robot does not move an arm,
    // however well-formed the pose that arrives.
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(ws.messagesOfType('error')[0]).toMatchObject({
      type: 'error',
      code: 'estop_latched',
    });
    // And nothing was recorded as having driven the robot, so a recording made
    // across a latch cannot claim IK demonstrations that never happened.
    expect(peekTeleopModes()).toEqual([]);
  });

  it('keeps refusing while the latch is held, however hard the client streams', () => {
    const state = makeG1Stub();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect(state);

    for (let i = 0; i < 5; i++) sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });

    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    // Once, not five times — `errorsSent` latches the code for the socket.
    expect(ws.messagesOfType('error')).toHaveLength(1);
  });

  it('discards a grip as well as the arm — the hand is part of the robot', () => {
    const state = makeG1Stub();
    state.isEStopTriggered.mockReturnValue(true);
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE, grip: 1 } } });

    expect(state.setTeleopJoint).not.toHaveBeenCalled();
  });
});

describe('keyboard-teleop {wrists} — an embodiment with no arm chain', () => {
  it('says ik_unsupported exactly once, and never writes a joint', () => {
    const state = makeSo101Stub();
    const ws = connect(state);

    for (let i = 0; i < 4; i++) sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });

    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    // A client streaming at 20 Hz would otherwise be told twenty times a second
    // that its robot is not a G1 — an answer that does not change while the
    // socket is open.
    const errors = ws.messagesOfType('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ik_unsupported' });
    expect(peekTeleopModes()).toEqual([]);
  });
});

describe('keyboard-teleop {wrists} — an unusable side HOLDS, and the other still drives', () => {
  /** Every way a side can fail to be a pose. All of them mean "hold". */
  const unusable: Array<[string, unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['p missing', { q: [0, 0, 0, 1] }],
    ['p non-numeric', { p: ['0.17', '0.2', '-0.37'] }],
    ['p of two elements', { p: [0.17, 0.2] }],
    ['p five metres from the eye', { p: [5, 0, 0] }],
  ];

  for (const [name, left] of unusable) {
    it(`left ${name}: the left arm is untouched and the right arm still moves`, () => {
      const state = makeG1Stub();
      const ws = connect(state);

      sendMsg(ws, { wrists: { left, right: { p: RIGHT_REACHABLE } } });

      // HOLD, not home and not mirror: a hand whose tracking dropped mid-take
      // leaves the arm exactly where it was.
      for (const joint of ARM_JOINTS.left) {
        expect(state.jointsWritten()).not.toContain(joint);
      }
      // The other half of the contract — one bad side must not veto the good
      // one, or losing a glove would freeze both arms.
      expect(state.jointsWritten()).toEqual(ARM_JOINTS.right);
    });
  }

  it('both sides unusable writes nothing at all and marks no mode', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: [5, 0, 0] }, right: null } });

    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(peekTeleopModes()).toEqual([]);
  });
});

describe('keyboard-teleop {wrists} — the trigger as a grasp axis', () => {
  /** The finger writes from the most recent message, in call order. */
  function fingerWrites(state: StateStub): JointWrite[] {
    return state.writes.filter((w) => FINGER_JOINTS.left.includes(w.joint));
  }

  it('grip absent writes no finger joint at all', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });

    // Fingers being driven some other way — or not at all — is the default,
    // and leaving them alone is the right answer for both.
    expect(fingerWrites(state)).toEqual([]);
  });

  it('a grip number writes the seven Dex3 joints of that side too', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE, grip: 1 } } });

    expect(fingerWrites(state).map((w) => w.joint).sort()).toEqual([...FINGER_JOINTS.left].sort());
    // The right hand was never mentioned, so it is never written.
    for (const joint of FINGER_JOINTS.right) {
      expect(state.jointsWritten()).not.toContain(joint);
    }
  });

  it('open and closed are different poses, and both stay inside the limits', () => {
    const open = makeG1Stub();
    sendMsg(connect(open), { wrists: { left: { p: LEFT_REACHABLE, grip: 0 } } });
    const closed = makeG1Stub();
    sendMsg(connect(closed), { wrists: { left: { p: LEFT_REACHABLE, grip: 1 } } });

    const openBy = new Map(fingerWrites(open).map((w) => [w.joint, w]));
    const closedBy = new Map(fingerWrites(closed).map((w) => [w.joint, w]));

    for (const joint of FINGER_JOINTS.left) {
      const o = openBy.get(joint)!;
      const c = closedBy.get(joint)!;
      const limit = open.limitsFor(joint)!;
      for (const write of [o, c]) {
        expect(write.requested).toBeGreaterThanOrEqual(limit.limitLower);
        expect(write.requested).toBeLessThanOrEqual(limit.limitUpper);
        // Unclamped: `gripPose` reads the closing limit off the chain table, so
        // full grip lands short of the stop rather than being sawn off by the
        // clamp. A commanded joint sitting on its mechanical stop is heat, not
        // grip.
        expect(write.applied).toBe(write.requested);
      }
      // The thumb's first joint is rotation, not flexion — sweeping it with the
      // trigger would close the thumb INTO the fingers instead of around
      // whatever is between them, so it is deliberately the one joint the
      // trigger leaves alone.
      if (joint === FINGER_JOINTS.left[0]) {
        expect(Math.abs(o.requested)).toBe(0);
        expect(Math.abs(c.requested)).toBe(0);
      } else {
        expect(Math.abs(o.requested)).toBe(0);
        expect(Math.abs(c.requested)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('keyboard-teleop {hands} — DexPilot finger retargeting', () => {
  it('four valid keypoints write the seven finger joints of that side', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { hands: { left: OPEN_HAND } });

    expect(state.jointsWritten()).toEqual(FINGER_JOINTS.left);
    for (const write of state.writes) {
      const limit = state.limitsFor(write.joint)!;
      expect(write.requested).toBeGreaterThanOrEqual(limit.limitLower);
      expect(write.requested).toBeLessThanOrEqual(limit.limitUpper);
    }
    expect(ws.messagesOfType('state').length).toBeGreaterThanOrEqual(1);
  });

  it('three of four keypoints write NOTHING', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    const { middle: _dropped, ...partial } = OPEN_HAND;
    sendMsg(ws, { hands: { left: partial } });

    // All four or none: retargeting three fresh vectors against a fourth point
    // that is a frame stale shows up as one finger lagging the others, which is
    // far harder to notice than a hand that simply does not move.
    expect(state.setTeleopJoint).not.toHaveBeenCalled();
    expect(peekTeleopModes()).toEqual([]);
  });
});

describe('keyboard-teleop — the recorder is told which retargeting drove the robot', () => {
  it('{wrists} marks ik', () => {
    const ws = connect(makeG1Stub());
    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });
    expect(peekTeleopModes()).toContain('ik');
  });

  it('{positions} marks orientation — joint angles the BROWSER computed', () => {
    const ws = connect(makeG1Stub());
    sendMsg(ws, { positions: { left_elbow_joint: 0.4 } });
    expect(peekTeleopModes()).toContain('orientation');
    expect(peekTeleopModes()).not.toContain('ik');
  });

  it('{hands} marks hand-tracking', () => {
    const ws = connect(makeG1Stub());
    sendMsg(ws, { hands: { left: OPEN_HAND } });
    expect(peekTeleopModes()).toContain('hand-tracking');
  });

  it('a session that used two modes says both', () => {
    const ws = connect(makeG1Stub());
    sendMsg(ws, { positions: { left_elbow_joint: 0.4 } });
    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE } } });
    // An operator who switches mid-take must not produce a dataset labelled
    // with whichever mode they happened to open with.
    expect(peekTeleopModes()).toEqual(['ik', 'orientation']);
  });
});

describe('keyboard-teleop {positions} — the old path is untouched', () => {
  it('writes every numeric target verbatim, skips the rest, and names unknown joints', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, {
      positions: { left_elbow_joint: 0.4, no_such_joint: 0.2, bogus: 'nope' },
    });

    expect(state.setTeleopJoint).toHaveBeenCalledWith('left_elbow_joint', 0.4);
    expect(state.setTeleopJoint).toHaveBeenCalledWith('no_such_joint', 0.2);
    expect(state.setTeleopJoint).not.toHaveBeenCalledWith('bogus', expect.anything());
    expect(state.setTeleopJoint).toHaveBeenCalledTimes(2);
    // The sim rejects the WHOLE pose over one unknown name, so a client built
    // against the wrong embodiment needs to be told which name it was.
    expect(ws.messagesOfType('error')[0]).toMatchObject({ code: 'unknown_joints' });
    expect(ws.messagesOfType('error')[0].message).toContain('no_such_joint');
    expect(ws.messagesOfType('state').length).toBeGreaterThanOrEqual(1);
  });

  it('the stub clamps like the real setTeleopJoint, so "unclamped" means something', () => {
    const state = makeG1Stub();
    const ws = connect(state);

    // Pins the harness itself: without a clamp here, every `applied ===
    // requested` assertion above would hold no matter what the solver produced.
    sendMsg(ws, { positions: { left_elbow_joint: 99 } });

    const write = state.writes[0]!;
    expect(write.requested).toBe(99);
    expect(write.applied).toBe(state.limitsFor('left_elbow_joint')!.limitUpper);
  });
});

describe('keyboard-teleop — handing the fingers back and forth', () => {
  const fingerJoints = new Set(FINGER_JOINTS.left);
  const fingerWrites = (state: StateStub) =>
    state.writes.filter((w) => fingerJoints.has(w.joint));

  it('lets tracked fingers win while they are arriving', () => {
    // Two sources for the same seven joints. Whichever message landed second
    // would win if both were allowed to write, which at 20 Hz is a coin toss
    // per frame and looks like fingers twitching.
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { hands: { left: OPEN_HAND } });
    state.writes.length = 0;
    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE, grip: 1 } } });

    expect(fingerWrites(state)).toEqual([]);
  });

  it('gives the trigger back once tracked fingers stop arriving', () => {
    // THE BUG THIS PINS. The gate was "is there a retargeter for this side",
    // and the retargeter is created on the first `{hands}` message and never
    // destroyed — so an operator who tried hand tracking once, watched it drop
    // out the way Quest hand tracking does, and went back to the controllers
    // had the trigger silently ignored for the rest of the session, with the
    // fingers frozen wherever the last tracked frame left them.
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { hands: { left: OPEN_HAND } });
    // Long enough that the hand counts as gone, and still a tiny fraction of
    // how long an operator would take to notice and pick a controller up.
    vi.advanceTimersByTime(600);
    state.writes.length = 0;
    sendMsg(ws, { wrists: { left: { p: LEFT_REACHABLE, grip: 1 } } });

    expect(fingerWrites(state).map((w) => w.joint).sort()).toEqual([...FINGER_JOINTS.left].sort());
  });

  it('keeps the two hands independent', () => {
    // Tracking one hand while holding a controller in the other is a real way
    // to work, and a per-socket flag would have taken the trigger off both.
    const state = makeG1Stub();
    const ws = connect(state);

    sendMsg(ws, { hands: { left: OPEN_HAND } });
    state.writes.length = 0;
    sendMsg(ws, {
      wrists: {
        left: { p: LEFT_REACHABLE, grip: 1 },
        right: { p: RIGHT_REACHABLE, grip: 1 },
      },
    });

    const written = new Set(state.writes.map((w) => w.joint));
    for (const joint of FINGER_JOINTS.left) expect(written.has(joint)).toBe(false);
    for (const joint of FINGER_JOINTS.right) expect(written.has(joint)).toBe(true);
  });
});
