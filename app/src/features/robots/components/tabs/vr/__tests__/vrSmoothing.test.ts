/**
 * @file vrSmoothing.test.ts
 * @description Tests for the frame-rate-independent pose filter and the target
 *              store reducers (seed, prune, advance).
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  smoothTowards,
  seedTargets,
  pruneReleased,
  advanceTargets,
  POSE_TAU_S,
  MAX_SMOOTH_DT_S,
} from '../vrSmoothing';
import { SMOOTHING } from '../vrConstants';

describe('smoothTowards', () => {
  it('reproduces the old per-frame feel exactly at 72 Hz', () => {
    // POSE_TAU_S was chosen so nothing changes on the frame rate the old
    // constant was tuned at: 1 - exp(-(1/72) / 0.0483) = 0.24990.
    const alpha = 1 - Math.exp(-(1 / 72) / POSE_TAU_S);
    expect(alpha).toBeCloseTo(SMOOTHING, 3);
  });

  it('gives the SAME response at 120 Hz as at 72 Hz over the same elapsed time', () => {
    const run = (hz: number): number => {
      let v = 0;
      for (let i = 0; i < hz; i += 1) v = smoothTowards(v, 1, POSE_TAU_S, 1 / hz);
      return v;
    };
    expect(run(120)).toBeCloseTo(run(72), 6);
  });

  it('closes almost all of the gap after a 200 ms stall, instead of a quarter of it', () => {
    // The old fixed 0.25 closed 25% of the gap however long the frame took, so
    // the arm lagged the hand through a GC pause and then lurched.
    expect(smoothTowards(0, 1, POSE_TAU_S, 0.2)).toBeGreaterThan(0.98);
  });

  it('moves toward the target monotonically and never overshoots', () => {
    let v = 0;
    for (let i = 0; i < 500; i += 1) {
      const next = smoothTowards(v, 1, POSE_TAU_S, 1 / 72);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBeCloseTo(1, 9);
  });

  it('clamps an absurd dt rather than trusting the caller clock', () => {
    expect(smoothTowards(0, 1, POSE_TAU_S, 1e9)).toBe(
      smoothTowards(0, 1, POSE_TAU_S, MAX_SMOOTH_DT_S),
    );
  });

  it('snaps when there is no history to filter from (the seed case)', () => {
    expect(smoothTowards(Number.NaN, 0.7, POSE_TAU_S, 1 / 72)).toBe(0.7);
    expect(smoothTowards(undefined as unknown as number, 0.7, POSE_TAU_S, 1 / 72)).toBe(0.7);
  });

  it('holds on a bad target — one dropped frame must not move the arm', () => {
    expect(smoothTowards(0.3, Number.NaN, POSE_TAU_S, 1 / 72)).toBe(0.3);
    expect(smoothTowards(0.3, Infinity, POSE_TAU_S, 1 / 72)).toBe(0.3);
  });

  it('holds when no time has passed', () => {
    expect(smoothTowards(0.3, 1, POSE_TAU_S, 0)).toBe(0.3);
    expect(smoothTowards(0.3, 1, POSE_TAU_S, -1)).toBe(0.3);
    expect(smoothTowards(0.3, 1, POSE_TAU_S, Number.NaN)).toBe(0.3);
  });

  it('treats a zero or negative tau as "no filter", not a divide by zero', () => {
    expect(smoothTowards(0.3, 1, 0, 1 / 72)).toBe(1);
    expect(smoothTowards(0.3, 1, -1, 1 / 72)).toBe(1);
    expect(smoothTowards(0.3, 1, Number.NaN, 1 / 72)).toBe(1);
  });
});

describe('seedTargets', () => {
  it('seeds an unknown joint from the robot pose so the first sample is not an unfiltered step', () => {
    const out = seedTargets({}, { a: 1.2, b: -0.4 }, ['a', 'b']);
    expect(out).toEqual({ a: 1.2, b: -0.4 });
  });

  it('never overwrites a target it already holds', () => {
    const out = seedTargets({ a: 0.1 }, { a: 1.2 }, ['a']);
    expect(out.a).toBe(0.1);
  });

  it('leaves a joint the robot has not reported absent, so the filter snaps to it', () => {
    const out = seedTargets({}, {}, ['a']);
    expect('a' in out).toBe(false);
  });

  it('ignores a non-finite reported position', () => {
    expect('a' in seedTargets({}, { a: Number.NaN }, ['a'])).toBe(false);
  });

  it('does not mutate its input', () => {
    const targets = {};
    seedTargets(targets, { a: 1 }, ['a']);
    expect(targets).toEqual({});
  });

  it('seeds nothing for an empty joint list', () => {
    expect(seedTargets({ a: 1 }, { b: 2 }, [])).toEqual({ a: 1 });
  });
});

describe('pruneReleased', () => {
  it('drops a released arm so it stops being re-sent forever', () => {
    // THE BUG: the store was never pruned, so releasing the left grip left its
    // joints frozen in the store — and every subsequent RIGHT-arm frame re-sent
    // them, which silently undid Home one frame after it was pressed.
    const store = { left_elbow_joint: 0.4, right_elbow_joint: -0.2 };
    expect(pruneReleased(store, ['right_elbow_joint'])).toEqual({ right_elbow_joint: -0.2 });
  });

  it('keeps everything still engaged', () => {
    const store = { a: 1, b: 2 };
    expect(pruneReleased(store, ['a', 'b'])).toEqual(store);
  });

  it('empties the store when both arms are released', () => {
    expect(pruneReleased({ a: 1, b: 2 }, [])).toEqual({});
  });

  it('ignores engaged joints that are not in the store yet', () => {
    expect(pruneReleased({ a: 1 }, ['a', 'never-seen'])).toEqual({ a: 1 });
  });

  it('does not mutate its input', () => {
    const store = { a: 1, b: 2 };
    pruneReleased(store, ['a']);
    expect(store).toEqual({ a: 1, b: 2 });
  });
});

describe('advanceTargets', () => {
  const robotPositions = { left_elbow_joint: 1.0 };

  it('starts from the robot pose and filters from there', () => {
    const out = advanceTargets({
      targets: {},
      want: { left_elbow_joint: 2.0 },
      robotPositions,
      dt: 1 / 72,
    });
    // Seeded at 1.0, then one filtered step of 25% toward 2.0.
    expect(out.left_elbow_joint).toBeCloseTo(1.25, 3);
  });

  it('converges on the commanded pose', () => {
    let targets = {};
    for (let i = 0; i < 300; i += 1) {
      targets = advanceTargets({
        targets,
        want: { left_elbow_joint: 2.0 },
        robotPositions,
        dt: 1 / 72,
      });
    }
    expect((targets as Record<string, number>).left_elbow_joint).toBeCloseTo(2.0, 6);
  });

  it('prunes before it filters, so a released arm leaves the stream entirely', () => {
    const out = advanceTargets({
      targets: { left_elbow_joint: 0.4, right_elbow_joint: 0.9 },
      want: { right_elbow_joint: 0.9 },
      robotPositions: {},
      dt: 1 / 72,
    });
    expect(Object.keys(out)).toEqual(['right_elbow_joint']);
  });

  it('re-seeds from the robot pose when an arm is re-engaged after a release', () => {
    // The arm moved (or was homed) while released; picking it up again must
    // start from where it IS, not from the pose it was frozen at.
    const released = advanceTargets({
      targets: { left_elbow_joint: 2.0 },
      want: {},
      robotPositions: {},
      dt: 1 / 72,
    });
    expect(released).toEqual({});
    const reengaged = advanceTargets({
      targets: released,
      want: { left_elbow_joint: 2.0 },
      robotPositions: { left_elbow_joint: 0 },
      dt: 1 / 72,
    });
    expect(reengaged.left_elbow_joint).toBeCloseTo(0.5, 3);
  });

  it('emits nothing when nothing is commanded', () => {
    expect(advanceTargets({ targets: { a: 1 }, want: {}, robotPositions: {}, dt: 1 / 72 })).toEqual({});
  });

  it('holds the store when dt is zero', () => {
    const out = advanceTargets({
      targets: { a: 0.5 },
      want: { a: 9 },
      robotPositions: {},
      dt: 0,
    });
    expect(out.a).toBe(0.5);
  });

  it('honours a caller-supplied tau', () => {
    const out = advanceTargets({
      targets: { a: 0 },
      want: { a: 1 },
      robotPositions: {},
      dt: 1,
      tau: 1e-6,
    });
    expect(out.a).toBeCloseTo(1, 9);
  });
});
