/**
 * @file ik.test.ts
 * @description The arm solver: does it get there, does it stay inside the
 *              joints, does it hold up at the stream rate, and does the
 *              measurement TASK-216 asks for still hold.
 * @feature teleop
 */

import { describe, it, expect } from 'vitest';
import { solveIk } from '../ik.js';
import { forwardKinematics } from '../kinematics.js';
import { G1_ARM_CHAINS, type Side } from '../g1-chains.generated.js';
import { ARM_MOBILITY, ARM_REST } from '../wrist-teleop.js';

/** Deterministic; a flaky IK test is worse than no IK test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/** Three genuinely different arm configurations to start a reach from. */
const STARTS: Record<Side, number[][]> = {
  left: [
    [0.25, 0.25, 0, 0.9, 0, 0, 0],       // the rest pose
    [-1.2, 0.1, 0.4, 1.6, 0.5, -0.4, 0.3], // arm up and back
    [0.9, 1.1, -0.8, 0.2, -0.9, 0.6, -0.5], // arm out and low
  ],
  right: [
    [0.25, -0.25, 0, 0.9, 0, 0, 0],
    [-1.2, -0.1, -0.4, 1.6, -0.5, 0.4, -0.3],
    [0.9, -1.1, 0.8, 0.2, 0.9, -0.6, 0.5],
  ],
};

describe('reaching a point', () => {
  it.each(['left', 'right'] as const)(
    '%s: lands within 3 cm of a fixed point from three starting configurations',
    (side) => {
      // The acceptance criterion, as close to literally as a unit test gets: one
      // point in front of the chest, three arm poses, the same answer.
      const chain = G1_ARM_CHAINS[side];
      const target: [number, number, number] = [0.34, side === 'left' ? 0.16 : -0.16, 0.06];
      const answers: number[][] = [];
      for (const start of STARTS[side]) {
        const result = solveIk(chain, { position: target }, start, {
          restPose: ARM_REST[side],
          mobility: ARM_MOBILITY,
        });
        expect(result.positionError).toBeLessThan(0.03);
        answers.push(result.q);
      }
      // "Repeatably" is the other half of the criterion: three different starts
      // must not leave the arm in three unrelated postures, or the operator
      // sees the elbow flip about while their hand holds still.
      for (let i = 1; i < answers.length; i++) {
        const a = forwardKinematics(chain, answers[0]!).tip;
        const b = forwardKinematics(chain, answers[i]!).tip;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.03);
      }
    },
  );

  it('tracks a moving point the way a hand moves', () => {
    const chain = G1_ARM_CHAINS.left;
    const centre = [0.35, 0.18, 0.08];
    let q = ARM_REST.left.slice();
    const errors: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t = i / 20;
      const target: [number, number, number] = [
        centre[0]! + 0.08 * Math.sin(t * 1.3),
        centre[1]! + 0.08 * Math.sin(t * 0.9 + 1),
        centre[2]! + 0.08 * Math.sin(t * 1.7 + 2),
      ];
      const result = solveIk(chain, { position: target }, q, {
        restPose: ARM_REST.left, mobility: ARM_MOBILITY,
      });
      q = result.q;
      if (i > 5) errors.push(result.positionError);
    }
    expect(percentile(errors, 0.95)).toBeLessThan(0.01);
  });

  it('gets as close as it can to a target it cannot reach, and says so', () => {
    // Not an error: an operator with longer arms than the robot puts their hand
    // out of the robot's reach several times a minute, and the right answer is
    // a hand at full stretch pointing the right way.
    const chain = G1_ARM_CHAINS.left;
    const far: [number, number, number] = [1.5, 0.2, 0.1];
    const result = solveIk(chain, { position: far }, ARM_REST.left, { restPose: ARM_REST.left });
    expect(result.converged).toBe(false);
    expect(result.positionError).toBeGreaterThan(0.5);
    expect(result.q.every((v) => Number.isFinite(v))).toBe(true);
    // And it got closer than it started, rather than diverging.
    const before = forwardKinematics(chain, ARM_REST.left).tip;
    const startError = Math.hypot(far[0] - before[0], far[1] - before[1], far[2] - before[2]);
    expect(result.positionError).toBeLessThan(startError);
  });
});

describe('joint limits', () => {
  it('never returns a joint outside its advertised range', () => {
    // Over the whole random target space, including targets that can only be
    // approached by pushing something into a stop.
    const rnd = lcg(7);
    for (const side of ['left', 'right'] as const) {
      const chain = G1_ARM_CHAINS[side];
      for (let i = 0; i < 200; i++) {
        const target: [number, number, number] = [
          -0.4 + rnd() * 1.2, -0.6 + rnd() * 1.2, -0.6 + rnd() * 1.2,
        ];
        const result = solveIk(chain, { position: target }, ARM_REST[side], {
          restPose: ARM_REST[side],
        });
        for (let j = 0; j < chain.links.length; j++) {
          const link = chain.links[j]!;
          expect(result.q[j]!).toBeGreaterThanOrEqual(link.lower - 1e-12);
          expect(result.q[j]!).toBeLessThanOrEqual(link.upper + 1e-12);
        }
      }
    }
  });

  it('reports `clamped` for a pose resting on a stop, and not for a comfortable one', () => {
    const chain = G1_ARM_CHAINS.left;
    // Up and out to the left: the shoulder ROLL runs out (its upper limit is
    // 2.2515 rad) before the hand gets there. Most unreachable targets are
    // limited by the arm's length rather than by a stop, which is why this one
    // is specific — `clamped` is meant to be rare and to mean something.
    const pinned = solveIk(chain, { position: [0.294, 0.533, 0.613] }, ARM_REST.left, {
      restPose: ARM_REST.left,
    });
    expect(pinned.clamped).toBe(true);
    const roll = chain.links[1]!;
    expect(pinned.q[1]!).toBeCloseTo(roll.upper, 4);
    const easy = solveIk(chain, { position: [0.32, 0.16, 0.05] }, ARM_REST.left, {
      restPose: ARM_REST.left,
    });
    expect(easy.converged).toBe(true);
    expect(easy.clamped).toBe(false);
  });

  it('clamps a seed that is already outside the limits', () => {
    const chain = G1_ARM_CHAINS.left;
    const wild = chain.links.map((l) => l.upper + 5);
    const result = solveIk(chain, { position: [0.3, 0.15, 0.05] }, wild, {});
    for (let j = 0; j < chain.links.length; j++) {
      expect(result.q[j]!).toBeLessThanOrEqual(chain.links[j]!.upper + 1e-12);
    }
  });
});

describe('robustness', () => {
  it('answers a non-finite seed with a real pose rather than NaN', () => {
    const chain = G1_ARM_CHAINS.left;
    const result = solveIk(chain, { position: [0.3, 0.15, 0.05] },
      [Number.NaN, Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0], {});
    expect(result.q.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('tracks orientation without giving up position', () => {
    // The regression that named this file's design: with orientation as a
    // CO-EQUAL task the 95th percentile position error over random targets was
    // 272 mm. Position is primary and orientation lives in its null space.
    const chain = G1_ARM_CHAINS.left;
    const rnd = lcg(99);
    const errors: number[] = [];
    for (let i = 0; i < 150; i++) {
      const q = chain.links.map((l) => l.lower + rnd() * (l.upper - l.lower));
      const pose = forwardKinematics(chain, q);
      const result = solveIk(chain, { position: pose.tip, rotation: pose.tipRot },
        ARM_REST.left, { restPose: ARM_REST.left, mobility: ARM_MOBILITY });
      errors.push(result.positionError);
    }
    expect(percentile(errors, 0.95)).toBeLessThan(0.03);
  });

  it('keeps the elbow near the rest posture when it has a choice', () => {
    // Seven joints for three constraints leaves four spare. Without the
    // null-space pull the solver spends them wherever the arithmetic lands,
    // which for an operator looks like the elbow wandering while their hand
    // holds still.
    const chain = G1_ARM_CHAINS.left;
    const target: [number, number, number] = [0.3, 0.16, 0.05];
    // From a CONTORTED seed. Seeded at the rest pose the two are the same
    // measurement: a minimum-norm step from rest already stays near rest, so
    // the comparison would prove nothing about the null-space term.
    const seed = [-1.2, 0.9, -1.4, 1.9, 1.2, -0.9, 1.1];
    const withPull = solveIk(chain, { position: target }, seed,
      { restPose: ARM_REST.left, restGain: 0.2 });
    const without = solveIk(chain, { position: target }, seed, { restGain: 0 });
    const drift = (q: number[]) =>
      q.reduce((acc, v, i) => acc + Math.abs(v - ARM_REST.left[i]!), 0);
    expect(drift(withPull.q)).toBeLessThanOrEqual(drift(without.q) + 1e-9);
    expect(withPull.positionError).toBeLessThan(0.01);
  });
});

describe('the time budget', () => {
  // TASK-216: "Solve time stays under 15 ms at the 95th percentile on the dev
  // machine, measured and recorded in the PR." The threshold below is
  // deliberately far looser than what is measured (0.08 ms warm, 0.24 ms cold
  // on an M-series laptop) — this test's job is to catch an order-of-magnitude
  // regression on any machine CI happens to run on, not to police jitter.
  const BUDGET_MS = 15;

  it('solves a warm-started frame far inside the budget', () => {
    const chain = G1_ARM_CHAINS.left;
    let q = ARM_REST.left.slice();
    const times: number[] = [];
    for (let i = 0; i < 400; i++) {
      const t = i / 20;
      const target: [number, number, number] = [
        0.35 + 0.08 * Math.sin(t * 1.3), 0.18 + 0.08 * Math.sin(t * 0.9), 0.08 + 0.08 * Math.sin(t * 1.7),
      ];
      const started = performance.now();
      const result = solveIk(chain, { position: target }, q, {
        restPose: ARM_REST.left, mobility: ARM_MOBILITY,
      });
      times.push(performance.now() - started);
      q = result.q;
    }
    expect(percentile(times, 0.95)).toBeLessThan(BUDGET_MS);
  });

  it('is cheaper warm than cold, which is the whole reason for the seed', () => {
    const chain = G1_ARM_CHAINS.left;
    const rnd = lcg(5);
    let warmIterations = 0;
    let coldIterations = 0;
    let q = ARM_REST.left.slice();
    for (let i = 0; i < 200; i++) {
      // Millimetres apart, the way consecutive frames of a real hand are.
      const target: [number, number, number] = [
        0.34 + 0.002 * rnd(), 0.16 + 0.002 * rnd(), 0.06 + 0.002 * rnd(),
      ];
      const warm = solveIk(chain, { position: target }, q, { restPose: ARM_REST.left });
      warmIterations += warm.iterations;
      q = warm.q;
      const cold = solveIk(chain, { position: target }, ARM_REST.left, { restPose: ARM_REST.left });
      coldIterations += cold.iterations;
    }
    expect(warmIterations).toBeLessThan(coldIterations);
  });
});
