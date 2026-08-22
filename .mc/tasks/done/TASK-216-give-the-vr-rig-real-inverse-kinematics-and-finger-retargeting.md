---
id: TASK-216
aliases:
- TASK-216
title: Give the VR rig real inverse kinematics and finger retargeting
slug: give-the-vr-rig-real-inverse-kinematics-and-finger-retargeting
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- '[[TASK-215]]'
due_date: ''
created: 2026-08-22
updated: 2026-08-22
---


# Give the VR rig real inverse kinematics and finger retargeting

## Description

The operator's hand should go where the robot's hand goes. Today the VR rig maps
controller *orientation* onto individual joints with fixed gains and never reads
the controller's position at all, so the robot mimics the wrist angle rather than
reaching for the thing the operator is reaching for. Add position-aware arm IK
and per-finger retargeting, so a recorded episode contains a demonstration
someone could learn a manipulation policy from.

## Details

### Why now — what already exists (verified 2026-08-22, `main` @ `5673e731`)

**The current mapping is explicitly an MVP and says so.**
`app/src/features/robots/components/tabs/vr/vrRetarget.ts:3-8` states there is no
inverse kinematics. `retargetArm()` (lines 378-440) maps:

| Input | Joint |
|---|---|
| controller pitch, inverted | `<side>_shoulder_pitch_joint` |
| controller yaw − robot heading | `<side>_shoulder_yaw_joint` |
| controller roll | `<side>_wrist_roll_joint` |
| thumbstick X | `<side>_shoulder_roll_joint` |
| thumbstick Y | `<side>_elbow_joint` |
| trigger 0..1 | all four flexion joints together |

**`pose.transform.position` is never read.** `VrTeleopRig.tsx:250-254` and
`413-420` take `frame.getPose(...)` and consume `.orientation` only. The rig has
no notion of where the hand is in space. Reaching forward does nothing; the
elbow is on a thumbstick.

**The hand is one number.** `HAND_FLEXION_SUFFIXES` drives `thumb_1`, `thumb_2`,
`index_1`, `middle_1` from the single trigger axis, and
`HAND_ABDUCTION_SUFFIXES` (`thumb_0`, `index_0`, `middle_0`) is commanded to
rest. The Dex3-1 has 7 actuated joints per hand; we use one degree of freedom.

**`wrist_yaw` is driven by nothing**, deliberately (`vrRetarget.ts:355-361`), and
on a G1 EDU with hands `wrist_pitch` is uncommanded too.

**What is good and must survive.** `softRange()` (lines 192-211) intersects the
soft range with the advertised joint limits and **never widens** them, then
stretches to include the rest pose. Non-finite input emits no command for that
joint — never NaN, never a jump. `vrRetarget.ts` is pure and has 645 lines of
tests. Turning is closed-loop physical body rotation with no stick yaw, an
anti-sickness decision (`VRTeleopModal.tsx:134`). None of that changes.

### How it is done in 2026 (research summary, links are the sources)

[`xr_teleoperate`](https://github.com/unitreerobotics/xr_teleoperate) solves
exactly this problem and is worth copying at the algorithm level even though its
transport and sim story do not suit us (see [[TASK-215]] for why we keep our own
rig).

**Arms — Pinocchio + CasADi + IPOPT.** `teleop/robot_control/robot_arm_ik.py`
(~91 KB), class `G1_29_ArmIK`. It builds a reduced model with legs and waist
locked (`buildReducedRobot`), adds `L_ee` / `R_ee` operational frames at the
wrist-yaw joints, and solves a CasADi NLP over `q` minimising translational plus
rotational error (`cpin.log3`) with regularisation and a smoothness term against
the previous solution. Solver: `ipopt.max_iter: 30`, `tol 1e-4`,
`warm_start_init_point: yes`. Output is filtered by a `WeightedMovingFilter`.
v1.5 added a pickle cache of the reduced model because URDF loading was slow.
Notably **not** `pink`.

**Fingers — DexPilot via `dex-retargeting`.**
[`silencht/dex-retargeting`](https://github.com/silencht/dex-retargeting) (MIT),
config `assets/unitree_hand/unitree_dex3.yml`: `type: DexPilot`,
`wrist_link_name: base_link`, tips `thumb_tip` / `index_tip` / `middle_tip`,
`scaling_factor: 1.0`, `low_pass_alpha: 0.2`. Input is tip-minus-origin
*vectors* built from 25 hand keypoints (human indices 0/4/9/14/19/24). Watch out:
**the left and right `target_joint_names` orderings differ** (left lists middle
before index, right lists index before middle) and `hand_retargeting.py` reorders
into hardware DDS order with explicit index maps. Getting this backwards
silently mirrors the fingers.

**Hand tracking is a different input, not a better one.** `televuer` delivers 25
joints × 4×4 per hand over the Vuer WebSocket. In WebXR terms that is
`XRHand` + `XRFrame.fillPoses` — available in the Quest browser without any of
Unitree's Python stack. But `xr_teleoperate` refuses `--input-mode controller`
for `dex3` (hand tracking only), and its Quest 3 hand mode is precisely where the
WebSocket-drop bug lives ([#296](https://github.com/unitreerobotics/xr_teleoperate/issues/296)),
while controller mode keeps working. So: controllers stay the reliable path,
hand tracking is added alongside.

**Where the IK runs is the real design question.**
[#120](https://github.com/unitreerobotics/xr_teleoperate/issues/120) reports
IPOPT taking **80–170 ms on a Jetson** against **~4 ms on an x86 host**. That is
the difference between usable and unusable, and it is the strongest argument
against putting a heavyweight solver anywhere near the robot's onboard compute.

### Design decisions (settled — do not re-litigate during implementation)

1. **IK runs in the robot agent, not the browser and not the sidecar.** The
   browser sends a wrist *pose* (position + orientation, both wrists, ~20 Hz);
   the agent solves and writes joint targets. This keeps the solver off the
   headset's battery, off the sim's physics thread, and in a process where we can
   cache the reduced model.
2. **The socket gains a pose message; `{positions}` stays.** Add
   `{wrists:{left?:{p:[x,y,z],q:[x,y,z,w]}, right?:…}}` to
   `/ws/keyboard-teleop`. `{positions}` remains the low-level path — the
   keyboard rig, the gamepad hook and `useSimulatedVrInput` all use it and must
   keep working unchanged.
3. **The soft-range and limit discipline survives IK.** The solver's output goes
   through the same clamp-to-advertised-limits path. An IK solution that violates
   a joint limit is rejected at the joint, not trusted because a solver produced
   it.
4. **A failed or slow solve holds the last good pose.** It does not fall back to
   the orientation mapping mid-episode — silently switching retargeting strategy
   inside a recorded demonstration would poison the data.
5. **Fingers get real per-joint targets.** Trigger-as-one-axis stays as the
   controller fallback; hand tracking drives all 7 joints per hand through
   DexPilot.
6. **Both input modes are recorded.** [[TASK-215]] writes `action` = commanded
   joints, which is correct for either mode, but the episode metadata must name
   which input mode produced it. A dataset mixing orientation-mapped and
   IK-solved demonstrations without saying so is a trap.

### Robot Agent

**New: `robot-agent/src/teleop/arm-ik.ts` + a Python solver process.**

TypeScript has no Pinocchio. Two options, decide by measuring:

- **(a) Python sidecar process**, `robot-agent/hardware/arm_ik_service.py`,
  pinocchio + casadi + ipopt, one HTTP or ZMQ round trip per solve. Matches
  `xr_teleoperate`'s proven solver exactly. Adds a process and a hop.
- **(b) In-agent numerical IK** — damped least squares over the 7-DOF arm chain
  using the MJCF we already have. No new dependency, no hop, worse convergence
  on hard poses.

Prototype (b) first and measure against (a): if damped least squares holds under
10 ms and tracks a reach-and-grasp without visible lag, it is the better answer
for us because it removes a process from the critical path. If it does not, take
(a) and cache the reduced model as `xr_teleoperate` learned to.

**New: finger retargeting.** With hand tracking, map the 25 WebXR hand joints to
Dex3 targets. Port the DexPilot vector formulation rather than importing
`dex-retargeting` (it pulls torch, and
[#167](https://github.com/unitreerobotics/xr_teleoperate/issues/167) documents a
torch/Isaac conflict we have no reason to inherit). **Take the left/right joint
ordering from `unitree_dex3.yml` and pin it with a test** — this is the mistake
that silently mirrors a hand.

**Extend** `robot-agent/src/api/keyboard-teleop.ts` with the `{wrists}` message,
its own error code, and the same E-Stop gating every other motion message has.

### Frontend

- `VrTeleopRig.tsx`: read `pose.transform.position` alongside `.orientation`
  (the pose is already fetched at lines 250-254 — the position is being
  discarded, not missing) and send `{wrists}`.
- Wrist poses must be expressed relative to the robot's torso, not the XR
  reference space. `xr_teleoperate`'s `tv_wrapper.py` documents the equivalent
  transform chain, including its head→waist offset of +0.15 m in x and +0.45 m
  in z; ours differs because our origin is placed by `VrOrigin.tsx`, which
  already measures where the headset actually ended up.
- Add `XRHand` support behind the existing store config
  (`VRTeleopModal.tsx:204-213` currently disables every hand feature) and a
  toggle in the modal. Controllers stay the default.
- `vrRetarget.ts` keeps its current job as the controller fallback. Do not delete
  it; it is 645 lines of tested behaviour and the fallback path.

## Acceptance Criteria

- [ ] Moving the controller forward in space moves the robot's hand forward.
- [ ] A reach to a fixed point in the scene lands within 3 cm, repeatably, from
      three different starting arm configurations.
- [ ] Solve time stays under 15 ms at the 95th percentile on the dev machine
      (Apple Silicon, no NVIDIA), measured and recorded in the PR.
- [ ] A solve that fails or exceeds its budget holds the previous pose; the robot
      never jumps and never silently reverts to orientation mapping.
- [ ] IK output that would violate an advertised joint limit is clamped at the
      joint, and a test proves the clamp is still in the path.
- [ ] With hand tracking on, closing individual fingers moves the corresponding
      Dex3 joints — and a test pins left/right ordering so a mirrored hand fails
      CI rather than shipping.
- [ ] Controller mode still works end to end with hand tracking unavailable.
- [ ] `{positions}` still drives the robot: keyboard rig, gamepad hook and
      `useSimulatedVrInput` are untouched and their tests still pass.
- [ ] Episode metadata from [[TASK-215]] names the input mode.

## Test Strategy

**Unit (pure, frontend).** Wrist pose → torso frame transform: known input,
known output, including a rotated and translated origin. Hand-joint → DexPilot
vector construction against a captured `XRHand` frame.

**Unit (robot agent).** Solver: reachable target converges; unreachable target
fails cleanly rather than diverging; a limit-violating target comes back clamped;
warm start from the previous solution beats cold start on solve time. Finger
retargeting: left and right orderings both pinned, explicitly, in one test that
would fail if they were swapped.

**Integration.** Against the running sim: script a reach to a known world point
in `g1_dex3_pickplace_scene.xml` and assert the fingertip body lands within
tolerance, read back through `/state`.

**Regression.** The full existing VR suite (2,619 LOC) must pass untouched. If a
test needs changing, the change is the finding — say so in the PR rather than
editing the assertion.

**Manual, with the headset.** Pick up the bottle in
`g1_dex3_pickplace_scene.xml`. That is the honest test and no unit test replaces
it: the current rig cannot do it, and if the new one cannot either, this task is
not done.

## Out of scope — v2, explicitly

- Whole-body control. Legs and waist stay out of the operator's hands.
- Bimanual coordination constraints. Each arm solves independently.
- Force feedback and bilateral teleop. `robot-agent/src/api/bilateral-teleop.ts`
  is `@deprecated TASK-117` and stays that way.
- Adopting `dex-retargeting` as a dependency. Port the formulation; do not import
  the torch stack.
- Real hardware. Sim only, same as [[TASK-215]].

## Notes

Depends on [[TASK-215]] only for the episode-metadata field naming the input
mode; the IK work itself is independent and could start in parallel. If 215 is
not done, record the input mode anyway and let 215 pick it up.

The thing to watch: our current rig has one genuine advantage over
`xr_teleoperate` that must not be lost. Ours has no calibration step and no
startup pose match — `VrOrigin.tsx` measures where the headset ended up and
closes the residual, so the operator just puts the headset on. `xr_teleoperate`
requires the operator to manually match the robot's arm pose before pressing `r`
or the arms jump. Adding IK is exactly the change that could reintroduce that
problem, so the seeding path in `enableTeleop()`
(`robot-agent/src/robot/state.ts:1329-1344`, which deliberately seeds from the
robot's *measured* pose rather than defaults) matters more after this task, not
less.
