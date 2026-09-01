/**
 * @file action-contracts.test.ts
 * @description TASK-229: the action vector reaches the joints it names. Pins
 *              the 31-dim action and 43-dim state tables against the Python
 *              source of truth, the left-hand grip decoder against the Python
 *              reference to 1e-9, the Dex3 left/right slot asymmetry, and the
 *              refusal that replaced the positional guess.
 * @feature vla
 * @status test
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G1_APPLE_ACTION_JOINT_NAMES,
  G1_APPLE_RIGHT_HAND_SLICE,
  G1_APPLE_STATE_JOINT_NAMES,
  decodeLeftHandGrip,
  requiresActionContract,
  resolveActionContract,
  resolveStateJointOrder,
  supportedActionLengths,
  projectStateIntoActionSpace,
} from '../action-contracts.js';
import { getJointConfig } from '../../robot/joint-configs/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLE_ENV_PY = path.resolve(HERE, '../../../hardware/sim_evaluator/envs/g1_apple_env.py');

// ── provenance ──────────────────────────────────────────────────────────────

/**
 * Read one `NAME = [ "a", "b", ... ]` list literal out of the Python.
 * Deliberately unclever: these are flat lists of double-quoted names and
 * nothing else, and a parser that could handle more could also silently handle
 * the wrong thing.
 */
function pythonList(source: string, name: string): string[] {
  const m = new RegExp(`^${name}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(source);
  if (!m) throw new Error(`${name} not found in ${APPLE_ENV_PY}`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

/** Resolve a `NAME = ( A + B + C )` concatenation into the names it composes. */
function pythonConcat(source: string, name: string): string[] {
  const m = new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, 'm').exec(source);
  if (!m) throw new Error(`${name} not found in ${APPLE_ENV_PY}`);
  return m[1]!
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .flatMap((list) => pythonList(source, list));
}

describe('the joint tables', () => {
  // Not skipped when the file is missing, unlike the server-side drift check in
  // agent-mode/__tests__/vla-skills.test.ts: g1_apple_env.py lives inside THIS
  // package, so its absence is a broken checkout, not an unchecked-out peer.
  const source = fs.readFileSync(APPLE_ENV_PY, 'utf8');

  it('are the contract g1_apple_env.py declares, in order', () => {
    // The pin exists because drift here has no symptom. The sidecar is
    // name-keyed and skips any key it does not know, so a renamed or reordered
    // entry does not throw, does not warn, and does not move the joint — the
    // rollout just quietly gets worse.
    expect(G1_APPLE_ACTION_JOINT_NAMES).toEqual(pythonConcat(source, 'ACTION_JOINT_NAMES'));
    expect(G1_APPLE_STATE_JOINT_NAMES).toEqual(pythonConcat(source, 'STATE_JOINT_NAMES'));
    expect(G1_APPLE_ACTION_JOINT_NAMES).toHaveLength(31);
    expect(G1_APPLE_STATE_JOINT_NAMES).toHaveLength(43);
  });

  it('keeps the Dex3 left/right asymmetry the hardware actually has', () => {
    // Pinned against the Python's own per-limb lists AND as literal indices, so
    // that editing one side alone is visible from either direction.
    const left = pythonList(source, 'LEFT_HAND_JOINT_NAMES');
    const right = pythonList(source, 'RIGHT_HAND_JOINT_NAMES');
    expect(left[3]).toBe('left_hand_middle_0_joint');
    expect(right[3]).toBe('right_hand_index_0_joint');

    expect(G1_APPLE_ACTION_JOINT_NAMES.indexOf('left_hand_middle_0_joint')).toBe(17);
    expect(G1_APPLE_ACTION_JOINT_NAMES.indexOf('right_hand_index_0_joint')).toBe(24);
    // Slot 3 of each hand block, i.e. the first non-thumb joint, is where the
    // two hands disagree: 14 + 3 = 17 on the left, 21 + 3 = 24 on the right.
    expect(G1_APPLE_ACTION_JOINT_NAMES.slice(14, 21)).toEqual(left);
    expect(G1_APPLE_ACTION_JOINT_NAMES.slice(21, 28)).toEqual(right);
  });
});

// ── the decoder ─────────────────────────────────────────────────────────────

/**
 * Golden vectors produced by calling the real `decode_left_hand` in
 * `vla-training/eval/hand_grip_decoder.py` — measured output, not hand-derived,
 * so a port that is merely plausible fails here. Slot order is the LEFT order
 * `[thumb_0, thumb_1, thumb_2, middle_0, middle_1, index_0, index_1]`.
 */
const GOLDEN: ReadonlyArray<{ name: string; code: number[]; radians: number[] }> = [
  {
    // The all-zero code is the OPEN endpoint, not zero. A missing decoder is
    // caught by this vector alone: a zero action is not a zero joint target.
    name: 'open_all_zero',
    code: [0, 0, 0, 0, 0, 0, 0],
    radians: [-0.07438, 0.06824, 0.06162, -0.07636, -0.05852, -0.08516, -0.08469],
  },
  {
    name: 'closed_both_ga1_gb1',
    code: [-1, -1, -1, -1, 0, 0.4, 0.7],
    radians: [-0.07438, 0.20552, 0.47074, -0.69452, -0.83696, -0.72598, -0.77278],
  },
  {
    // ga=1, gb=0 — the vector that separates INDEX from MIDDLE. An
    // implementation using NeoDEM's thumb→index→middle order closes the wrong
    // finger here and cannot pass both this and its mirror below.
    name: 'asym_ga1_gb0',
    code: [-1, -1, 0, 0, -0.5, 0.4, 0.7],
    radians: [-0.07438, 0.20552, 0.47074, -0.07636, -0.05852, -0.72598, -0.77278],
  },
  {
    name: 'asym_ga0_gb1',
    code: [0, 0, -1, -1, 0.5, 0.4, 0.7],
    radians: [-0.07438, 0.20552, 0.47074, -0.69452, -0.83696, -0.08516, -0.08469],
  },
  {
    // Non-endpoint interpolation: catches a port that snaps to open/closed.
    name: 'mid_ga0.5_gb0.25',
    code: [-0.5, -0.5, -0.25, -0.25, -0.125, 0.2, 0.35],
    radians: [
      -0.07438, 0.13688, 0.26617999999999997, -0.2309, -0.25313, -0.40557, -0.428735,
    ],
  },
  {
    // The same grip on the real n/255 teleop quantisation grid — the exact
    // float a replayed dataset frame carries.
    name: 'mid_quantised_ga128_255_gb64_255',
    code: [
      -0.5019607843137255, -0.5019607843137255, -0.25098039215686274,
      -0.25098039215686274, -0.12549019607843137, 0.20078431372549022,
      0.3513725490196078,
    ],
    radians: [
      -0.07438, 0.13714917647058822, 0.2669821960784314, -0.2315060392156863,
      -0.25389317647058823, -0.40682650980392154, -0.43008419607843135,
    ],
  },
  {
    // Deliberately inconsistent — the shape a continuous policy actually emits.
    // c[0] != c[1], c[2] != c[3], and c[5]/0.40 disagrees with c[6]/0.70.
    // Exercises BOTH the duplicate averaging and the gmax lower-bound fold:
    // gmax = 0.80 exceeds either finger scalar, so the thumb closes further
    // than ga or gb alone would say. c[4] = 0.17 contradicts everything and is
    // ignored. Reading only c[0], or skipping the fold, changes these numbers.
    name: 'inconsistent_continuous_policy',
    code: [-0.62, -0.7, -0.3, -0.34, 0.17, 0.3, 0.595],
    radians: [
      -0.07438, 0.178064, 0.388916, -0.2741712, -0.3076208, -0.5081011999999999,
      -0.5388293999999999,
    ],
  },
  {
    // The fold in isolation: both duplicate pairs say 0, c[5]/c[6] say 0.8. The
    // fingers stay at OPEN while the thumb goes to 80% closed. An
    // implementation computing gmax as max(ga, gb) returns the all-OPEN pose.
    name: 'gmax_fold_dominates_open_fingers',
    code: [0, 0, 0, 0, 0, 0.32000000000000006, 0.5599999999999999],
    radians: [
      -0.07438, 0.178064, 0.38891600000000004, -0.07636, -0.05852, -0.08516, -0.08469,
    ],
  },
  {
    // Every component driven far out of range. The result is exactly the
    // fully-closed pose: the [0,1] clip absorbs it and the MJCF clamp is a
    // no-op. That clamp can never fire for any finite code — verified
    // analytically and over 40 000 malformed codes, max pre-clamp violation
    // 0.0 — so [0,1] is the bound that actually holds, and a test asserting
    // the MJCF clamp fires would be untestable.
    name: 'past_mjcf_limit_attempt',
    code: [-5, -5, -5, -5, 0, 5, 7],
    radians: [-0.07438, 0.20552, 0.47074, -0.69452, -0.83696, -0.72598, -0.77278],
  },
  {
    // Upper clip: ga = 1.7 saturates at CLOSE instead of overshooting past it.
    name: 'out_of_range_ga_1.7',
    code: [-1.7, -1.7, -0.5, -0.5, -0.6, 0.68, 1.19],
    radians: [-0.07438, 0.20552, 0.47074, -0.38544, -0.44774, -0.72598, -0.77278],
  },
  {
    // Lower clip: ga = -0.4 pins the index pair at OPEN with no sign flip past
    // the open endpoint. c[0] is POSITIVE here (ga is stored negated), which
    // also catches an implementation taking an absolute value instead.
    name: 'negative_out_of_range',
    code: [0.4, 0.4, -0.3, -0.3, 0.35, 0.12, 0.21],
    radians: [
      -0.07438, 0.109424, 0.184356, -0.261808, -0.292052, -0.08516, -0.08469,
    ],
  },
];

describe('decodeLeftHandGrip', () => {
  it.each(GOLDEN)('matches the Python reference on $name', ({ code, radians }) => {
    const out = decodeLeftHandGrip(code);
    expect(out).toHaveLength(7);
    for (let i = 0; i < 7; i++) {
      expect(out[i]).toBeCloseTo(radians[i]!, 9);
    }
  });

  it('holds thumb_0 constant, because the code carries none of it', () => {
    // R² = 0.011 against the code. Any expectation that thumb_0 varies is
    // wrong; the best memoryless answer is its global steady mean.
    const values = GOLDEN.map((g) => decodeLeftHandGrip(g.code)[0]);
    expect(new Set(values)).toEqual(new Set([-0.07438]));
  });

  it('refuses a code that is not 7 long rather than padding it', () => {
    expect(() => decodeLeftHandGrip([0, 0, 0])).toThrow(/7 elements, got 3/);
    expect(() => decodeLeftHandGrip(new Array(43).fill(0))).toThrow(/got 43/);
  });
});

// ── the regression ──────────────────────────────────────────────────────────

/** A 31-vector whose every element is its own index, so a mis-map is readable. */
const INDEXED_ACTION = Array.from({ length: 31 }, (_, i) => i);

describe('the g1_edu apple contract', () => {
  const contract = resolveActionContract('g1_edu', 31);

  it('resolves at all', () => {
    expect(contract).not.toBeNull();
    expect(contract!.kind).toBe('named');
    expect(contract!.id).toBe('g1_apple_pnp_31');
  });

  it('commands the arms and NEVER a leg', () => {
    // The defect: `action[i] -> jointOrder[i]` put action[0] (left shoulder
    // pitch) on `left_hip_pitch_joint` and the rest of the arm on the rest of
    // the leg, on a humanoid standing on those joints. Both halves are
    // asserted — the right joint present, and no leg joint present at all.
    const joints = contract!.toJointTargets(INDEXED_ACTION);
    expect(joints['left_shoulder_pitch_joint']).toBe(INDEXED_ACTION[0]);
    expect(joints['right_shoulder_pitch_joint']).toBe(INDEXED_ACTION[7]);

    const legs = Object.keys(joints).filter((n) => /hip|knee|ankle/.test(n));
    expect(legs).toEqual([]);
  });

  it('writes every one of the 43 joints it should and nothing else', () => {
    const joints = contract!.toJointTargets(INDEXED_ACTION);
    expect(Object.keys(joints).sort()).toEqual([...G1_APPLE_ACTION_JOINT_NAMES].sort());
    // Both hands are written. Under the positional map the vector ran out at
    // 31 of 43 joints and neither hand was ever addressed.
    expect(Object.keys(joints).filter((n) => n.includes('_hand_'))).toHaveLength(14);
    // The waist is commanded, not dropped: it carries a constant ~-0.12 rad
    // lean whose absence cost ~52 mm of lateral offset in the Isaac gate
    // (2/15 transports, vs 7/15 once the waist was right).
    expect(joints['waist_yaw_joint']).toBe(INDEXED_ACTION[28]);
    expect(joints['waist_pitch_joint']).toBe(INDEXED_ACTION[30]);
  });

  it('decodes the left hand and passes the right hand through raw', () => {
    const joints = contract!.toJointTargets(INDEXED_ACTION);
    const expectedLeft = decodeLeftHandGrip(INDEXED_ACTION.slice(14, 21));
    expect(joints['left_hand_thumb_0_joint']).toBeCloseTo(expectedLeft[0]!, 12);
    expect(joints['left_hand_middle_0_joint']).toBeCloseTo(expectedLeft[3]!, 12);
    expect(joints['left_hand_index_0_joint']).toBeCloseTo(expectedLeft[5]!, 12);
    // Nothing in the left block survives as the raw action value — a decoder
    // that silently passed through would have left 14..20 intact.
    expect(joints['left_hand_thumb_0_joint']).not.toBe(14);

    // The right block is UNMODIFIED, mirroring run_apple_eval.py:221, which
    // decodes the left hand only. That is the configuration the measured 13/15
    // transports were obtained in; the right block is exactly 0 in all 171 625
    // training frames, so this dataset can neither confirm nor refute that it
    // is a code. Reusing the left decoder here would apply endpoint tables
    // fitted to the left hand, in the left slot order, to the right hand.
    for (let i = G1_APPLE_RIGHT_HAND_SLICE.start; i < G1_APPLE_RIGHT_HAND_SLICE.end; i++) {
      expect(joints[G1_APPLE_ACTION_JOINT_NAMES[i]!]).toBe(INDEXED_ACTION[i]);
    }
  });

  it('honours the left/right index-middle asymmetry by name', () => {
    const joints = contract!.toJointTargets(INDEXED_ACTION);
    // Left: slot 3 of the hand block is MIDDLE (index 14 + 3 = 17).
    expect(G1_APPLE_ACTION_JOINT_NAMES[17]).toBe('left_hand_middle_0_joint');
    // Right: slot 3 is INDEX (index 21 + 3 = 24).
    expect(G1_APPLE_ACTION_JOINT_NAMES[24]).toBe('right_hand_index_0_joint');
    expect(joints['right_hand_index_0_joint']).toBe(24);
    expect(joints['right_hand_middle_0_joint']).toBe(26);
    // On the left the value is decoded, so assert which SLOT it came from
    // rather than the raw number: middle_0 must take the decoder's slot 3.
    const decoded = decodeLeftHandGrip(INDEXED_ACTION.slice(14, 21));
    expect(joints['left_hand_middle_0_joint']).toBe(decoded[3]);
    expect(joints['left_hand_index_0_joint']).toBe(decoded[5]);
  });

  it('refuses an action of the wrong width rather than mapping the overlap', () => {
    expect(() => contract!.toJointTargets(new Array(43).fill(0))).toThrow(/31 action elements/);
  });
});

// ── fail closed ─────────────────────────────────────────────────────────────

describe('a G1 EDU with no matching contract', () => {
  it('resolves to null instead of a positional guess', () => {
    expect(requiresActionContract('g1_edu')).toBe(true);
    expect(resolveActionContract('g1_edu', 6)).toBeNull();
    expect(resolveActionContract('g1_edu', 28)).toBeNull();
    expect(resolveActionContract('g1_edu', 43)).toBeNull();
    // 43 is the interesting one: it is the robot's own joint count, so the old
    // path would have mapped it silently and cleanly onto every joint it has,
    // legs included, with no warning at all.
  });

  it('names the widths it does know, so the refusal is actionable', () => {
    expect(supportedActionLengths('g1_edu')).toEqual([31]);
  });
});

// ── everything else is untouched ────────────────────────────────────────────

describe('SO-101', () => {
  const order = getJointConfig('so101').map((j) => j.name);

  it('keeps the positional mapping it has always had', () => {
    const contract = resolveActionContract('so101', order.length);
    expect(contract).not.toBeNull();
    expect(contract!.kind).toBe('positional');
    expect(contract!.names).toEqual(order);

    const action = order.map((_, i) => i * 1.5);
    const joints = contract!.toJointTargets(action);
    expect(Object.keys(joints)).toEqual(order);
    order.forEach((name, i) => expect(joints[name]).toBe(action[i]));
  });

  it('maps the overlap on a mismatched width, and never fails closed', () => {
    // Fail-closed is for the LEGGED embodiments only. Making a 6-DOF arm refuse
    // would break a working robot to fix a different one.
    expect(requiresActionContract('so101')).toBe(false);
    const contract = resolveActionContract('so101', 3);
    expect(contract!.kind).toBe('positional');
    expect(contract!.toJointTargets([7, 8, 9])).toEqual({
      [order[0]!]: 7,
      [order[1]!]: 8,
      [order[2]!]: 9,
    });
  });

  it('has no state reordering applied to it', () => {
    expect(resolveStateJointOrder('so101')).toBeNull();
    expect(resolveStateJointOrder('g1')).toBeNull();
    expect(resolveStateJointOrder('h1')).toBeNull();
  });
});

// ── the observation direction ───────────────────────────────────────────────

describe('resolveStateJointOrder', () => {
  it('gives a G1 EDU the contract order, not its own joint order', () => {
    expect(resolveStateJointOrder('g1_edu')).toEqual(G1_APPLE_STATE_JOINT_NAMES);
  });

  it('differs from the joint config in exactly the four left-hand slots', () => {
    // The whole reason this function exists. 39 of 43 indices agree, and the
    // four that do not are the left hand's index/middle pair — so the policy
    // was told the left index finger's angle was the middle finger's, during
    // the grasp. Pinned as literal indices AND as names: if the joint config is
    // ever reordered to match, this test must be revisited deliberately, not
    // pass by accident.
    const configOrder = getJointConfig('g1_edu').map((j) => j.name);
    const contractOrder = resolveStateJointOrder('g1_edu')!;
    expect(contractOrder).toHaveLength(configOrder.length);
    expect([...contractOrder].sort()).toEqual([...configOrder].sort());

    const differing = contractOrder
      .map((n, i) => (n === configOrder[i] ? -1 : i))
      .filter((i) => i >= 0);
    expect(differing).toEqual([32, 33, 34, 35]);
    expect(contractOrder.slice(32, 36)).toEqual([
      'left_hand_middle_0_joint',
      'left_hand_middle_1_joint',
      'left_hand_index_0_joint',
      'left_hand_index_1_joint',
    ]);
    expect(configOrder.slice(32, 36)).toEqual([
      'left_hand_index_0_joint',
      'left_hand_index_1_joint',
      'left_hand_middle_0_joint',
      'left_hand_middle_1_joint',
    ]);
  });
});

// ── the NaN fold, where Math.max and Python's max part company ───────────────

describe('decodeLeftHandGrip on a non-finite code', () => {
  it('discards a NaN in the redundancy slots, exactly as the reference does', () => {
    // Python's builtin `max` is a left-to-right fold of `>`, and NaN never
    // compares greater, so `max(ga, gb, nan)` returns the finite winner.
    // `Math.max` returns NaN if ANY argument is NaN. The port used Math.max,
    // so a NaN confined to code slot 5 or 6 — which leaves ga and gb intact —
    // poisoned the two thumb flexion joints while the reference produced a
    // perfectly good half-closed thumb from the finger scalars.
    //
    // Expected values are `decode_left_hand` on this exact input, run against
    // vla-training/eval/hand_grip_decoder.py.
    const out = decodeLeftHandGrip([-0.5, -0.5, -0.5, -0.5, 0.0, NaN, 0.35]);
    const reference = [
      -0.07438, 0.13688, 0.26617999999999997, -0.38544, -0.44774, -0.40557, -0.428735,
    ];
    for (let i = 0; i < 7; i++) expect(out[i]).toBeCloseTo(reference[i]!, 9);
    // The point of the test, stated directly: nothing NaN reaches a joint.
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('still propagates a NaN the reference propagates, in ga or gb', () => {
    // Not every NaN is discarded: one in slots 0..3 lands in `ga`/`gb`, which
    // ARE the running maximum's first arguments, and Python returns NaN there
    // too. Parity means matching this as well — the fix is a faithful port of
    // `max`, not a NaN scrubber, and a guard against non-finite policy output
    // belongs on the whole action vector, not inside one block's decoder.
    const out = decodeLeftHandGrip([NaN, -0.5, -0.5, -0.5, 0, 0.2, 0.35]);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(Number.isNaN(out[5])).toBe(true);
  });
});

// ── fail closed on ANY robot that stands on its joints ──────────────────────

describe('a legged embodiment with no named contract', () => {
  // The first cut of this guard asked "does this robot have 43 joints", which
  // is the same untrusted input that produced the defect: ROBOT_TYPE is an env
  // var, `getSidecarUrl()` sends 'g1' to the SAME sidecar port a G1 EDU uses,
  // and g1_sidecar.py's /action accepts every leg-joint name. So a G1 EDU
  // mis-declared as 'g1' took a 31-dim apple action, resolved a positional
  // contract, and wrote twelve leg joints behind one console.warn.
  it('refuses a 31-dim apple action on a 29-DOF g1', () => {
    expect(requiresActionContract('g1')).toBe(true);
    expect(resolveActionContract('g1', 31)).toBeNull();
  });

  it('refuses on h1 too, including at its own joint count', () => {
    expect(requiresActionContract('h1')).toBe(true);
    expect(resolveActionContract('h1', 31)).toBeNull();
    expect(resolveActionContract('h1', getJointConfig('h1').length)).toBeNull();
  });

  it('names no supported width for an embodiment that cannot host the contract', () => {
    // The refusal message says "known: none" rather than claiming 31 works.
    expect(supportedActionLengths('g1')).toEqual([]);
    expect(supportedActionLengths('h1')).toEqual([]);
    expect(supportedActionLengths('g1_edu')).toEqual([31]);
  });

  it('leaves the legless embodiments exactly as they were', () => {
    expect(requiresActionContract('so101')).toBe(false);
    expect(requiresActionContract('generic')).toBe(false);
  });
});

// ── the rate limiter's seed ─────────────────────────────────────────────────

describe('projectStateIntoActionSpace', () => {
  const contract = resolveActionContract('g1_edu', 31)!;
  /** A 43-dim observation whose every element is its own index. */
  const STATE = Array.from({ length: 43 }, (_, i) => i);

  it('puts each action slot next to its OWN joint, not the one at its index', () => {
    const seed = projectStateIntoActionSpace('g1_edu', contract, STATE);
    expect(seed).not.toBeNull();
    expect(seed).toHaveLength(31);
    // action[0] is left_shoulder_pitch, which is state index 15 — not 0, which
    // is left_hip_pitch. That pairing is what the clip used to rate-limit
    // against, and the two ranges are 5.20 rad apart at their extremes, i.e.
    // past the 5.0 bound the clip applies to radians.
    const stateOrder = resolveStateJointOrder('g1_edu')!;
    contract.names.forEach((name, i) => {
      const v = seed![i];
      if (v === null) return;
      expect(v).toBe(stateOrder.indexOf(name));
    });
    expect(seed![0]).toBe(15);
    expect(seed![0]).not.toBe(0);
  });

  it('refuses to seed the seven grip-CODE slots with radians', () => {
    const seed = projectStateIntoActionSpace('g1_edu', contract, STATE)!;
    for (let i = 14; i < 21; i++) expect(seed[i]).toBeNull();
    // Everything else is a real angle, including the RIGHT hand, which the
    // contract passes through raw and whose slots therefore ARE radians.
    for (let i = 21; i < 31; i++) expect(seed[i]).not.toBeNull();
  });

  it('gives up rather than guessing when the shapes do not line up', () => {
    expect(projectStateIntoActionSpace('g1_edu', contract, [1, 2, 3])).toBeNull();
    const positional = resolveActionContract('so101', 6)!;
    expect(projectStateIntoActionSpace('so101', positional, [0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
