---
id: "TASK-229"
aliases: []
title: "The policy's action vector reaches the wrong joints"
slug: "the-policys-action-vector-reaches-the-wrong-joints"
status: "todo"
priority: 1
owner: ""
projects: []
customers: []
tags: ["core", "vla", "agent-mode", "sim"]
sprint: ""
depends_on: ["[[TASK-226]]"]
due_date: ""
created: "2026-08-29"
updated: "2026-08-29"
---

# The policy's action vector reaches the wrong joints

## Description

`vla_skill` (TASK-226) is wired end to end on the planner side, but the last
step — turning the policy's action vector into joint targets — maps it onto the
wrong joints and skips the grip decoder. A `g1_apple_pnp` rollout on a G1 EDU
would command the **legs** with arm trajectories and never move a finger. Today
this is hidden because `G1_READ_ONLY=1` makes the sidecar answer `403` and the
rollout fails at step 1; the moment the write path is opened, it becomes a fall.

## Details

### Current state

The policy returns a **31-dim** action, contract
`[L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3]`
(`vla-server/configs/g1_apple_pnp.yaml`, `groot_action_keys`).

`HardwareClient.sendActionVector` (`robot-agent/src/hardware/HardwareClient.ts:1107`)
maps `action[i] -> jointOrder[i]` **positionally**, where `jointOrder` is the
43-DOF `g1-edu` config in body order (legs 12, waist 3, arms 14, hands 14 —
`robot-agent/src/robot/joint-configs/g1-edu.config.ts:68`). The two orders are
unrelated:

| action[i] means | lands on `jointOrder[i]` |
| --- | --- |
| left shoulder pitch | `left_hip_pitch_joint` |
| left-hand grip code | `waist_pitch_joint` |
| waist yaw | `right_wrist_yaw_joint` |
| — (vector ends at 31) | both hands, never written |

It logs `action length 31 ≠ 43 joints — mapping overlap of 31` and proceeds.

Two further defects on the same path:

1. **The grip decoder is missing.** `action[14:21]` is a normalised grip *code*,
   not radians — two free scalars quantised to n/255, with the code slots
   scrambled relative to the joint slots, so an identity pass-through cannot work
   even in principle. `vla-training/eval/hand_grip_decoder.py` is the reference;
   `vla-training/eval/run_apple_eval.py:221` applies it every step. Measured cost
   of skipping it, same command vector through the replay gate:
   **0/15 transports (median lift 0.0 mm) vs 13/15 (median lift 72.6 mm)**.
   `_data/apple_pnp/CONTRACT.md` line 40 places the conversion in the eval runner
   or the vla-server unnormaliser and **deliberately not in the env** — the env
   and the real robot both receive radians. The robot agent is the runner here,
   so the decoder belongs on this path.

2. **The left hand's slot order is not NeoDEM's.** The Dex3 left/right asymmetry
   is real hardware (`robot-agent/hardware/sim_g1_dds/joints.py:25`): the DDS /
   dataset left hand is `[thumb_0, thumb_1, thumb_2, middle_0, middle_1,
   index_0, index_1]` while `dex3HandJoints()` emits thumb→index→middle for
   *both* sides. So NeoDEM's left-hand block has index and middle **swapped**
   relative to the dataset. Any index-based mapping gets this wrong; only a
   by-name mapping is safe.

3. **The observation is wrong in the same four slots.** This was initially assumed
   correct and is not. `getStateNow` (`HardwareClient.ts`) reads name-keyed joints
   and reorders them into `jointOrder`, which agrees with `STATE_JOINT_NAMES` at
   39 of 43 indices — and disagrees at exactly 32, 33, 34, 35:

   | index | contract (`STATE_JOINT_NAMES`) | NeoDEM `jointOrder` |
   | --- | --- | --- |
   | 32 | `left_hand_middle_0_joint` | `left_hand_index_0_joint` |
   | 33 | `left_hand_middle_1_joint` | `left_hand_index_1_joint` |
   | 34 | `left_hand_index_0_joint` | `left_hand_middle_0_joint` |
   | 35 | `left_hand_index_1_joint` | `left_hand_middle_1_joint` |

   Both lists hold the same 43 names as a set; only the left hand's index/middle
   pair is transposed, for the same reason as defect 2. The right hand agrees
   exactly. So the policy is told the left index finger is where the middle
   finger is — during the grasp, which is the only moment it matters. The fix
   must correct **both** directions, and a test must pin the state order the same
   way it pins the action order.

The authoritative tables already live in this repo, in Python:
`robot-agent/hardware/sim_evaluator/envs/g1_apple_env.py` — `ACTION_JOINT_NAMES`
(31, in order) and `STATE_JOINT_NAMES` (43).

### Robot Agent

**New** `robot-agent/src/vla/action-contracts.ts`:

- `G1_APPLE_ACTION_JOINT_NAMES: readonly string[]` — the 31 names, mirroring
  `ACTION_JOINT_NAMES` character for character.
- `decodeLeftHandGrip(code: number[]): number[]` — a port of
  `decode_left_hand`, including the OPEN/CLOSE endpoint tables, the
  `gmax_obs = 0.5*(c[5]/0.40 + c[6]/0.70)` redundancy fold, the `thumb_0`
  constant, and the MJCF limit clamp.
- `resolveActionContract(robotType, actionLength)` returning either a contract
  (`{names, decode}`) or `null`.
- Contract selection **fails closed**: a 43-DOF robot with an action length that
  matches no contract must return `null`, and the caller must end the rollout.
  Falling back to the positional map is the defect this task removes.
- SO-101 and every other current embodiment keep today's positional behaviour.

**Modify** `robot-agent/src/hardware/HardwareClient.ts`: add a name-keyed send
(or have `sendActionVector` consult the contract) so `SkillExecutor` posts a
joint dict built by name, never by index.

**Modify** `robot-agent/src/vla/skill-executor.ts`: resolve the contract once per
run, next to `fetchVlaConfig`, and fail the run with a clear message when the
robot is 43-DOF and no contract matches.

### Key files

- `robot-agent/src/vla/action-contracts.ts` (new)
- `robot-agent/src/vla/__tests__/action-contracts.test.ts` (new)
- `robot-agent/src/hardware/HardwareClient.ts`
- `robot-agent/src/vla/skill-executor.ts`
- `robot-agent/hardware/sim_evaluator/envs/g1_apple_env.py` (read-only — the
  source of truth the test parses)
- `vla-training/eval/hand_grip_decoder.py` (read-only — the reference)

## Test Strategy

1. **Provenance test** — parse `ACTION_JOINT_NAMES` out of `g1_apple_env.py` and
   assert the TS table equals it, in order. Same pinning trick
   `agent-mode/__tests__/vla-skills.test.ts` uses for the trained prompts: the
   defect this prevents has no symptom.
2. **Decoder parity** — golden vectors generated by the Python reference,
   asserted to `1e-9`. Must include both saturated corners, an asymmetric
   `(ga, gb)`, and a vector with inconsistent duplicates so the redundancy fold
   is exercised.
3. **The mis-map regression** — assert `left_shoulder_pitch_joint` receives
   `action[0]` and that **no** leg joint appears in the dict at all. This test
   fails before the fix.
4. **Hand slot order** — assert `left_hand_middle_0_joint` takes `action[17]`
   and `right_hand_index_0_joint` takes `action[24]`, i.e. that the left/right
   asymmetry survives.
5. **Fail-closed** — a 43-DOF robot with a 6-dim action returns `null` and the
   rollout ends with a message naming the mismatch, rather than writing anything.
6. **Replay parity on a real rollout** — golden vectors prove the port is
   arithmetically faithful on inputs someone chose; they cannot prove it is
   faithful on what a policy emits. A continuous policy breaks the grip code's
   redundancy on every step (`c[0] != c[1]`, `c[5]/0.40 != c[6]/0.70`), and each
   of those disagreements is resolved by the averaging and the `max()` fold — a
   port that dropped either would still pass a hand-written suite. So replay a
   recorded GR00T rollout through the contract and hold it to the reference
   exactly. Fixture:
   `robot-agent/src/vla/__tests__/fixtures/g1-apple-rollout-seed0.json`.
7. **Live** — GR00T PolicyServer + vla-server on this box, a rollout with the
   robot placed at the table. Recorded.

## Acceptance Criteria

- [ ] No joint dict built by `SkillExecutor` ever contains a leg joint
- [ ] The left-hand grip code is decoded; the decoder matches the Python
      reference to 1e-9 on golden vectors
- [ ] Index/middle asymmetry is honoured on both hands, by name
- [ ] An unmatched action length on a 43-DOF robot ends the rollout instead of
      writing a positional guess
- [ ] SO-101 behaviour is unchanged
- [ ] The 43-dim observation is assembled in `STATE_JOINT_NAMES` order, pinned by
      a test that reads the Python source at test time
- [ ] Typecheck and the full robot-agent suite pass

## Found while fixing this — the rate limiter on the same path

`SkillExecutor.clipAction` (`skill-executor.ts:1874`) is the safety rate limiter
between the policy and the robot: "no joint moves more than `MAX_DELTA_DEGREES`
from its last applied value. Prevents servo stalls from bad VLA predictions."
Two things are wrong with it on a G1, and they cancel each other out, which is
why neither has a symptom:

1. **Its units are SO-101's.** `MAX_DELTA_DEGREES = 5` (`skill-executor.ts:85`)
   is compared against a delta in whatever unit the action carries. SO-101
   actions are degrees, so 5 is a real limit there. A G1's are **radians**, and
   5 rad is 286° — larger than any joint's whole range. On this robot the
   limiter is **inert**: `limited === delta` on every step, so
   `clipped[i] === action[i]` and the function returns its input.

2. **Its seed is in the wrong space.** `lastActionForClip` is seeded from
   `hardwareClient.getStateNow()` — 43 values in `STATE_JOINT_NAMES` order —
   and then compared index-by-index against a **31**-value action in
   `ACTION_JOINT_NAMES` order. On step 0 that pairs left shoulder pitch with
   left hip pitch. From step 1 on it is replaced by the previous action, so the
   spaces agree and only the first step is mismatched.

Defect 1 is the only reason defect 2 is harmless: because the clamp never binds,
the mismatched seed is never used to alter a value. Fixing the units alone —
which looks like a one-character improvement — would turn the first commanded
pose into "the leg's angle, plus 5 degrees". Fix the seed first, or fix both
together, and never only the constant.

Seeding correctly is cheap once the contract exists: both name tables are known,
so the 43-dim state can be projected into the 31-dim action space by name.
Retuning the limit itself is a separate decision with its own measurement — at
5 Hz a plausible policy moves faster than 5°/step, so a naive conversion would
throttle a working rollout.

## Not verified / open questions

- **The right hand's action block.** The reference runner decodes the LEFT hand
  only and passes `action[21:28]` through raw. Whether the right block is also a
  grip code is undocumented; in the apple task the right hand is idle, so the
  measured 13/15 was obtained with the raw pass-through. Mirror the reference
  exactly and record the question rather than inventing a second decoder.
- **`thumb_0`** carries no information in the code (R² = 0.011) and is held at
  its global steady mean, costing ~0.094 rad rms on that joint alone.
- Whether the waist block should be commanded at all — the campaign notes say
  the waist is parked, not commandable, in the Wholebody path.
