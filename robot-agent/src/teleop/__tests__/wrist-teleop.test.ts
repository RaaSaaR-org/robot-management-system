/**
 * @file wrist-teleop.test.ts
 * @description The part of arm IK that touches the robot: where the warm start
 *              comes from, what happens when a solve cannot be trusted, and how
 *              fast the answer is allowed to reach the joints.
 * @feature teleop
 */

import { describe, it, expect } from 'vitest';
import type { RobotStateManager } from '../../robot/state.js';
import { G1_ARM_CHAINS, HEAD_SITE_IN_TORSO } from '../g1-chains.generated.js';
import { forwardKinematics } from '../kinematics.js';
import { ARM_REST, MAX_WRIST_RADIUS_M, WristTeleop, parseWristPose } from '../wrist-teleop.js';

const ARM_JOINTS = G1_ARM_CHAINS.left.links.map((l) => l.joint);

/**
 * A robot that records what it was told and clamps like the real one.
 *
 * The clamp matters: without it a test cannot tell "the solver stayed inside
 * the limits" from "the clamp is still in the path", and the second is what
 * TASK-216 asks to be proved.
 */
function fakeRobot(seedPose: Record<string, number> = {}) {
  const positions: Record<string, number> = { ...seedPose };
  const writes: { joint: string; value: number }[] = [];
  const limits = new Map(
    (['left', 'right'] as const).flatMap((side) =>
      G1_ARM_CHAINS[side].links.map((l) => [l.joint, l] as const),
    ),
  );
  const robot = {
    getTeleopPositions: () => ({ ...positions }),
    setTeleopJoint: (joint: string, value: number): number | null => {
      const link = limits.get(joint);
      if (!link) return null;
      const clamped = Math.min(link.upper, Math.max(link.lower, value));
      positions[joint] = clamped;
      writes.push({ joint, value: clamped });
      return clamped;
    },
  } as unknown as RobotStateManager;
  return { robot, positions, writes };
}

/** A clock the test drives, so the rate limiter is deterministic. */
function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

/** A reachable target for the left arm, expressed the way the wire does. */
function targetFor(q: number[]): { position: [number, number, number]; rotation: null } {
  const tip = forwardKinematics(G1_ARM_CHAINS.left, q).tip;
  return { position: tip, rotation: null };
}

describe('parseWristPose', () => {
  it('moves a head-relative pose into the torso frame', () => {
    const parsed = parseWristPose({ p: [0.3, 0.1, -0.2] });
    expect(parsed).not.toBeNull();
    expect(parsed!.position[0]).toBeCloseTo(0.3 + HEAD_SITE_IN_TORSO[0], 9);
    expect(parsed!.position[1]).toBeCloseTo(0.1 + HEAD_SITE_IN_TORSO[1], 9);
    expect(parsed!.position[2]).toBeCloseTo(-0.2 + HEAD_SITE_IN_TORSO[2], 9);
  });

  it('reads the wire quaternion as (x, y, z, w)', () => {
    // The one place the order changes. A quarter turn about +z on the wire must
    // come back as a quarter turn about +z, not about +x.
    const parsed = parseWristPose({ p: [0.2, 0, 0], q: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
    expect(parsed!.rotation).not.toBeNull();
    const m = parsed!.rotation!;
    // +x maps to +y under a quarter turn about z.
    expect(m[0]!).toBeCloseTo(0, 9);
    expect(m[3]!).toBeCloseTo(1, 9);
  });

  it('refuses anything that is not a whole pose', () => {
    expect(parseWristPose(null)).toBeNull();
    expect(parseWristPose({})).toBeNull();
    expect(parseWristPose({ p: [0, 0] })).toBeNull();
    expect(parseWristPose({ p: ['a', 0, 0] })).toBeNull();
    expect(parseWristPose({ p: [Number.NaN, 0, 0] })).toBeNull();
    expect(parseWristPose({ p: [0, 0, Number.POSITIVE_INFINITY] })).toBeNull();
  });

  it('refuses a hand further from the head than an arm reaches', () => {
    // Not a reach limit — the solver handles unreachable targets. This catches
    // a unit mistake (millimetres sent as metres) and a tracking glitch, both of
    // which would otherwise drive the arm to full extension.
    expect(parseWristPose({ p: [MAX_WRIST_RADIUS_M + 0.01, 0, 0] })).toBeNull();
    expect(parseWristPose({ p: [MAX_WRIST_RADIUS_M - 0.01, 0, 0] })).not.toBeNull();
  });

  it('keeps the pose when the quaternion is unusable, rather than dropping both', () => {
    // Position is what the operator aims. A degenerate orientation costs the
    // secondary task, not the reach.
    const parsed = parseWristPose({ p: [0.2, 0, 0], q: [0, 0, 0, 0] });
    expect(parsed).not.toBeNull();
    expect(parsed!.rotation).toBeNull();
  });
});

describe('the warm start', () => {
  it('comes from where the arm ACTUALLY IS, not from the rest pose', () => {
    // THIS IS WHY THE RIG NEEDS NO CALIBRATION. `enableTeleop()` seeds its joint
    // map from the sidecar's measured pose; the first solve of a session starts
    // there, so the operator sees the arm move away from where it is standing
    // rather than snap to a default first. Seeding from ARM_REST instead would
    // reintroduce exactly the startup pose-match `xr_teleoperate` requires.
    const measured = Object.fromEntries(ARM_JOINTS.map((j, i) => [j, [-0.9, 0.7, -1.1, 1.7, 0.6, -0.5, 0.4][i]!]));
    const { robot, writes } = fakeRobot(measured);
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    // A target only a few millimetres from where the arm already is.
    const here = forwardKinematics(G1_ARM_CHAINS.left, ARM_JOINTS.map((j) => measured[j]!)).tip;
    const report = teleop.solve('left', {
      position: [here[0] + 0.002, here[1], here[2]],
      rotation: null,
    });
    expect(report.held).toBeUndefined();
    // Every joint stayed within a whisker of where it was measured. From the
    // rest pose the same solve would have moved several of them by a radian.
    for (const write of writes) {
      expect(Math.abs(write.value - measured[write.joint]!)).toBeLessThan(0.1);
    }
  });

  it('holds and says so when the robot cannot report the arm', () => {
    const { robot, writes } = fakeRobot({}); // no joints reported at all
    const teleop = new WristTeleop(robot, clock().now);
    const report = teleop.solve('left', targetFor(ARM_REST.left.slice()));
    expect(report.held).toBe('no-seed');
    expect(writes).toHaveLength(0);
  });

  it('holds when a joint the chain needs is missing from the report', () => {
    const partial = Object.fromEntries(ARM_JOINTS.slice(0, 6).map((j) => [j, 0]));
    const { robot, writes } = fakeRobot(partial);
    const teleop = new WristTeleop(robot, clock().now);
    expect(teleop.solve('left', targetFor(ARM_REST.left.slice())).held).toBe('no-seed');
    expect(writes).toHaveLength(0);
  });
});

describe('writing to the robot', () => {
  const measured = Object.fromEntries(ARM_JOINTS.map((j, i) => [j, ARM_REST.left[i]!]));

  it('writes the seven joints of the side it was given and nothing else', () => {
    const { robot, writes } = fakeRobot({ ...measured });
    const teleop = new WristTeleop(robot, clock().now);
    teleop.solve('left', targetFor([0.3, 0.3, 0, 1.0, 0, 0, 0]));
    expect(new Set(writes.map((w) => w.joint))).toEqual(new Set(ARM_JOINTS));
  });

  it('goes through the joint clamp, not around it', () => {
    // The acceptance criterion: "IK output that would violate an advertised
    // joint limit is clamped AT THE JOINT". Proved by writing through a robot
    // whose limits are TIGHTER than the chain table's — the solver cannot know
    // about those, so anything inside them got there through `setTeleopJoint`.
    const positions: Record<string, number> = { ...measured };
    const writes: { joint: string; value: number }[] = [];
    const tight = 0.05;
    const robot = {
      getTeleopPositions: () => ({ ...positions }),
      setTeleopJoint: (joint: string, value: number): number | null => {
        if (!ARM_JOINTS.includes(joint)) return null;
        const clamped = Math.min(tight, Math.max(-tight, value));
        positions[joint] = clamped;
        writes.push({ joint, value: clamped });
        return clamped;
      },
    } as unknown as RobotStateManager;
    const teleop = new WristTeleop(robot, clock().now);
    teleop.solve('left', targetFor([1.2, 0.9, -0.5, 1.8, 0, 0, 0]));
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(Math.abs(write.value)).toBeLessThanOrEqual(tight);
    // And what the clamp returned is what the next frame starts from, so the
    // rate limiter is not measuring against a pose the robot never held.
    for (const [i, joint] of ARM_JOINTS.entries()) {
      expect(teleop.lastCommanded('left')![i]!).toBe(positions[joint]!);
    }
  });

  it('leaves the other arm alone', () => {
    const both = {
      ...measured,
      ...Object.fromEntries(G1_ARM_CHAINS.right.links.map((l, i) => [l.joint, ARM_REST.right[i]!])),
    };
    const { robot, writes } = fakeRobot(both);
    const teleop = new WristTeleop(robot, clock().now);
    teleop.solve('left', targetFor([0.3, 0.3, 0, 1.0, 0, 0, 0]));
    expect(writes.some((w) => w.joint.startsWith('right_'))).toBe(false);
  });
});

describe('the rate limit', () => {
  const measured = Object.fromEntries(ARM_JOINTS.map((j, i) => [j, ARM_REST.left[i]!]));

  it('turns a jump into a sweep', () => {
    // The acceptance criterion "the robot never jumps". The solver is perfectly
    // happy to hand back a pose two radians away — that is what it does on the
    // first frame after tracking is regained somewhere new.
    const { robot } = fakeRobot({ ...measured });
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    // First solve establishes the clock; nothing to limit against yet.
    teleop.solve('left', targetFor(ARM_REST.left.slice()));
    const before = teleop.lastCommanded('left')!.slice();

    c.advance(50); // one frame at 20 Hz
    const far = targetFor([-1.4, 1.4, -1.2, 2.0, 1.0, -1.0, 1.0]);
    const report = teleop.solve('left', far);
    expect(report.slewing).toBe(true);
    const after = teleop.lastCommanded('left')!;
    // 3 rad/s for 50 ms is 0.15 rad, and no joint may have moved further.
    for (let i = 0; i < after.length; i++) {
      expect(Math.abs(after[i]! - before[i]!)).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });

  it('does not hand a client that went quiet a whole session of allowance', () => {
    // A backgrounded tab, a headset taken off, a stalled socket: the gap is
    // real time but it is not motion the operator asked for.
    const { robot } = fakeRobot({ ...measured });
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    teleop.solve('left', targetFor(ARM_REST.left.slice()));
    const before = teleop.lastCommanded('left')!.slice();

    c.advance(10_000); // ten seconds of silence
    teleop.solve('left', targetFor([-1.4, 1.4, -1.2, 2.0, 1.0, -1.0, 1.0]));
    const after = teleop.lastCommanded('left')!;
    // Capped at the 0.2 s window, so 0.6 rad — not 30.
    for (let i = 0; i < after.length; i++) {
      expect(Math.abs(after[i]! - before[i]!)).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('lets a hand moving at human speed through untouched', () => {
    const { robot } = fakeRobot({ ...measured });
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    let slewed = 0;
    const centre = forwardKinematics(G1_ARM_CHAINS.left, ARM_REST.left).tip;
    for (let i = 0; i < 100; i++) {
      c.advance(50);
      const t = i / 20;
      const report = teleop.solve('left', {
        position: [centre[0] + 0.06 * Math.sin(t), centre[1] + 0.06 * Math.sin(t * 1.3), centre[2] + 0.06 * Math.sin(t * 0.7)],
        rotation: null,
      });
      if (report.slewing) slewed++;
    }
    // A couple of limited frames while it catches up from rest is fine; a rate
    // limit that bites during ordinary motion would just be lag.
    expect(slewed).toBeLessThan(10);
  });

  it('measures from what was COMMANDED, so the limit cannot be outrun', () => {
    // Running the limiter from the solver's seed instead lets the arm advance a
    // full allowance every frame no matter how far behind it is — which is the
    // limit doing nothing at all.
    const { robot } = fakeRobot({ ...measured });
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    const far = targetFor([-1.4, 1.4, -1.2, 2.0, 1.0, -1.0, 1.0]);
    teleop.solve('left', far);
    const start = teleop.lastCommanded('left')!.slice();
    for (let i = 0; i < 3; i++) {
      c.advance(50);
      teleop.solve('left', far);
    }
    const after = teleop.lastCommanded('left')!;
    for (let i = 0; i < after.length; i++) {
      expect(Math.abs(after[i]! - start[i]!)).toBeLessThanOrEqual(3 * 0.15 + 1e-9);
    }
  });

  it('limits the SECOND arm of a two-handed frame too', () => {
    // Both hands travel in one `{wrists}` message, and the handler solves them
    // back to back within the same millisecond. With one shared clock the
    // second side saw dt = 0, which the code read as "unlimited" — so on every
    // frame of two-handed teleop the right arm was written with the solver's
    // raw output and told the caller `slewing: false`. Measured at 0.85 rad in
    // one 50 ms tick against the 0.15 rad the left arm got.
    const measuredBoth = {
      ...Object.fromEntries(G1_ARM_CHAINS.left.links.map((l, i) => [l.joint, ARM_REST.left[i]!])),
      ...Object.fromEntries(G1_ARM_CHAINS.right.links.map((l, i) => [l.joint, ARM_REST.right[i]!])),
    };
    const { robot } = fakeRobot(measuredBoth);
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    const tipOf = (side: 'left' | 'right', q: number[]) =>
      ({ position: forwardKinematics(G1_ARM_CHAINS[side], q).tip, rotation: null });

    // Frame one establishes both clocks.
    teleop.solve('left', tipOf('left', ARM_REST.left.slice()));
    teleop.solve('right', tipOf('right', ARM_REST.right.slice()));
    const before = {
      left: teleop.lastCommanded('left')!.slice(),
      right: teleop.lastCommanded('right')!.slice(),
    };

    // Frame two: 50 ms later, both sides in the same tick of the clock.
    c.advance(50);
    const far = {
      left: tipOf('left', [-1.4, 1.4, -1.2, 2.0, 1.0, -1.0, 1.0]),
      right: tipOf('right', [-1.4, -1.4, 1.2, 2.0, -1.0, 1.0, -1.0]),
    };
    const reports = {
      left: teleop.solve('left', far.left),
      right: teleop.solve('right', far.right),
    };
    for (const side of ['left', 'right'] as const) {
      const after = teleop.lastCommanded(side)!;
      expect(reports[side].slewing).toBe(true);
      for (let i = 0; i < after.length; i++) {
        expect(Math.abs(after[i]! - before[side][i]!)).toBeLessThanOrEqual(0.15 + 1e-9);
      }
    }
  });

  it('gives a frame repeated inside one millisecond no allowance at all', () => {
    // The same hole from the other side: a client that sends the same frame
    // twice back to back used to advance the arm twice, because "no time has
    // passed" was read as "no limit".
    const { robot } = fakeRobot({ ...measured });
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    const far = targetFor([-1.4, 1.4, -1.2, 2.0, 1.0, -1.0, 1.0]);
    c.advance(50);
    teleop.solve('left', far);
    const after1 = teleop.lastCommanded('left')!.slice();
    teleop.solve('left', far); // same millisecond
    const after2 = teleop.lastCommanded('left')!;
    for (let i = 0; i < after2.length; i++) {
      expect(after2[i]!).toBeCloseTo(after1[i]!, 12);
    }
  });

  it('starts over after a reset', () => {
    const { robot } = fakeRobot({ ...measured });
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    teleop.solve('left', targetFor(ARM_REST.left.slice()));
    expect(teleop.lastCommanded('left')).not.toBeNull();
    teleop.reset();
    expect(teleop.lastCommanded('left')).toBeNull();
  });
});

describe('orientation, end to end through the wire', () => {
  it('lands the palm on the rotation the wire asked for', () => {
    // The only test in the repo that carries a rotation from a WIRE QUATERNION
    // all the way to a commanded pose. Everything else either solves position
    // only or reads `positionError` back, which is exactly why the whole
    // orientation half of the solver could be deleted with the suite green.
    //
    // It pins the (x, y, z, w) -> (w, x, y, z) boundary as well: a swapped
    // order is a different rotation and shows up here as tens of degrees.
    const chain = G1_ARM_CHAINS.left;
    // A target whose orientation the position task does NOT reach on its own:
    // seeded from a pose across the workspace, position-only tracking lands on
    // the point with the palm turned right round. That is the whole point of
    // choosing it — a target the arm happens to arrive at correctly proves
    // nothing about the orientation task.
    const goal = [1.202, 0.873, 0.405, 1.046, -0.559, -0.116, 1.116];
    const from = [0.111, 0.318, -1.558, -0.734, 0.826, 0.332, 0.093];
    const pose = forwardKinematics(chain, goal);
    // Back onto the wire: head-relative position, and the tip rotation as the
    // browser would send it.
    const q = mat3ToQuatXyzw(pose.tipRot);
    const wire = {
      p: [
        pose.tip[0] - HEAD_SITE_IN_TORSO[0],
        pose.tip[1] - HEAD_SITE_IN_TORSO[1],
        pose.tip[2] - HEAD_SITE_IN_TORSO[2],
      ],
      q,
    };
    const parsed = parseWristPose(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.rotation).not.toBeNull();

    const measured = Object.fromEntries(chain.links.map((l, i) => [l.joint, from[i]!]));
    const { robot } = fakeRobot(measured);
    const c = clock();
    const teleop = new WristTeleop(robot, c.now);
    // Two seconds of tracking at 20 Hz, exactly as the socket drives it — the
    // rate limit has to walk the arm across the workspace first.
    for (let i = 0; i < 40; i++) {
      c.advance(50);
      teleop.solve('left', parsed!);
    }
    const landed = forwardKinematics(chain, teleop.lastCommanded('left')! as number[]);
    const degrees = angleBetween(landed.tipRot, pose.tipRot) * 180 / Math.PI;
    // 3.1 degrees measured. With `rotationWeight` at zero the same reach lands
    // 178 degrees out — the palm turned right over — and reading the wire
    // quaternion as (w, x, y, z) instead of (x, y, z, w) lands 67 degrees out.
    expect(degrees).toBeLessThan(15);
    // And it did not buy that with position: still on the point.
    const off = Math.hypot(
      landed.tip[0] - pose.tip[0], landed.tip[1] - pose.tip[1], landed.tip[2] - pose.tip[2],
    );
    expect(off).toBeLessThan(0.005);
  });
});

/** A rotation matrix as the wire's (x, y, z, w). Row-major, like `Mat3`. */
function mat3ToQuatXyzw(m: number[]): [number, number, number, number] {
  const trace = m[0]! + m[4]! + m[8]!;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m[7]! - m[5]!) / s, (m[2]! - m[6]!) / s, (m[3]! - m[1]!) / s, 0.25 * s];
  }
  if (m[0]! > m[4]! && m[0]! > m[8]!) {
    const s = Math.sqrt(1 + m[0]! - m[4]! - m[8]!) * 2;
    return [0.25 * s, (m[1]! + m[3]!) / s, (m[2]! + m[6]!) / s, (m[7]! - m[5]!) / s];
  }
  if (m[4]! > m[8]!) {
    const s = Math.sqrt(1 + m[4]! - m[0]! - m[8]!) * 2;
    return [(m[1]! + m[3]!) / s, 0.25 * s, (m[5]! + m[7]!) / s, (m[2]! - m[6]!) / s];
  }
  const s = Math.sqrt(1 + m[8]! - m[0]! - m[4]!) * 2;
  return [(m[2]! + m[6]!) / s, (m[5]! + m[7]!) / s, 0.25 * s, (m[3]! - m[1]!) / s];
}

/** The angle of the rotation taking `a` to `b`, radians. */
function angleBetween(a: number[], b: number[]): number {
  // trace(Aᵀ B) = 1 + 2 cos(theta)
  let trace = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) trace += a[j * 3 + i]! * b[j * 3 + i]!;
  }
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
}
