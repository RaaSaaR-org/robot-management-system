/**
 * @file action-contracts-replay.test.ts
 * @description Replays a real GR00T rollout through the action contract and holds
 *              it to the Python reference, value for value (TASK-229).
 * @feature vla
 *
 * ## Why a recorded rollout and not more golden vectors
 *
 * The hand-written vectors in `action-contracts.test.ts` prove the decoder is
 * arithmetically faithful on inputs someone chose. They cannot prove it is
 * faithful on what a policy emits. The grip code carries only two free scalars
 * but spends seven slots on them, and the redundancy is exact only in the
 * dataset: a continuous policy breaks it on every step — `c[0] != c[1]`,
 * `c[5]/0.40 != c[6]/0.70` — and every one of those disagreements is resolved by
 * the averaging and the `max()` fold. Nobody writes those by hand, and a port
 * that dropped either would still pass a hand-written suite.
 *
 * So the fixture is a recording, not a construction: 73 steps sampled from a
 * 240-step apple rollout that GR00T Recipe A actually ran against the MuJoCo
 * evaluator on 2026-08-29, biased towards the steps where the grip is moving,
 * because a uniform sample of a reach-then-grasp trajectory is mostly reach.
 * `expected` is what `vla-training/eval/hand_grip_decoder.py` — the reference
 * every measured number in the campaign was produced with — derived from the
 * same chunk.
 *
 * The bar is EXACT, not `toBeCloseTo`. Both sides are float64 over the same
 * inputs and there is no reordering in between, so any difference at all is a
 * difference in the arithmetic. An early run of this comparison did show
 * 2.9e-8, and it was neither implementation: the recorder had assigned the
 * decoder's float64 output back into a float32 array. That is worth knowing
 * about — a tolerance of 1e-6 here would have hidden it, and it is exactly the
 * size of error a genuinely wrong constant produces.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { G1_APPLE_ACTION_JOINT_NAMES, resolveActionContract } from '../action-contracts.js';

interface Fixture {
  provenance: Record<string, unknown>;
  action_joint_names: string[];
  steps: Array<{ i: number; action: number[]; expected: Record<string, number> }>;
}

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'g1-apple-rollout-seed0.json',
);

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;

describe('action contract, replayed against a real GR00T rollout', () => {
  it('the fixture was recorded against the same joint table this build ships', () => {
    // Compared before any value is, because a parity run over two differently
    // ordered tables compares the wrong pairs and passes for the wrong reason.
    expect(fixture.action_joint_names).toEqual([...G1_APPLE_ACTION_JOINT_NAMES]);
  });

  it('the fixture actually covers the grasp', () => {
    // A recording that sampled only the reach would exercise the decoder solely
    // at its open endpoint, where an identity pass-through also happens to be
    // right. Guard the sample, not just the comparison.
    const thumb1 = fixture.steps.map((s) => s.expected.left_hand_thumb_1_joint);
    const travel = Math.max(...thumb1) - Math.min(...thumb1);
    expect(travel).toBeGreaterThan(0.1);
  });

  it('reproduces the reference joint targets exactly, on every sampled step', () => {
    const contract = resolveActionContract('g1_edu', G1_APPLE_ACTION_JOINT_NAMES.length);
    expect(contract).not.toBeNull();

    let compared = 0;
    for (const step of fixture.steps) {
      const got = contract!.toJointTargets(step.action);
      // Same joint SET, so a contract that silently dropped or invented a joint
      // cannot pass by having every value it does emit be right.
      expect(Object.keys(got).sort()).toEqual(Object.keys(step.expected).sort());
      for (const [name, want] of Object.entries(step.expected)) {
        // Reported per value rather than via a summed max, so a failure names
        // the joint and the step instead of a number.
        expect({ step: step.i, name, value: got[name] }).toEqual({
          step: step.i,
          name,
          value: want,
        });
        compared++;
      }
    }
    expect(compared).toBe(fixture.steps.length * G1_APPLE_ACTION_JOINT_NAMES.length);
  });

  it('never commands a leg, on any step of a real rollout', () => {
    const contract = resolveActionContract('g1_edu', G1_APPLE_ACTION_JOINT_NAMES.length);
    for (const step of fixture.steps) {
      const legs = Object.keys(contract!.toJointTargets(step.action)).filter((n) =>
        /_(hip|knee|ankle)_/.test(n),
      );
      expect(legs).toEqual([]);
    }
  });
});
