---
id: TASK-186
aliases:
- TASK-186
title: Push/slide success reward for unitree_sim_isaaclab (unblocks unseen-behavior closed-loop ablations)
slug: push-slide-reward-unitree-sim-isaaclab
status: in-progress
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- synthetic-data
- vla
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-17
updated: 2026-08-29
status_note: 'Reward written and carried as 0003-neodem-push-slide-reward.patch; gate logic
  verified offline (14/14) with verify_push_reward_gates.py. NOT yet run inside Isaac — the
  four in-sim controls are written down but unexecuted. Two findings that change the shape of
  the work: (1) the scene object is a 0.018 x 0.35 m rod, which analytically tips rather than
  slides for any contact above ~1.2 cm, so the push may be physically unachievable in this
  scene; (2) the stock pick-place reward is already dead in the wholebody task (absolute
  world-box thresholds vs a warehouse-scene object 3 m outside them), so it publishes a
  constant -1.0. depends_on [[TASK-185]] dropped: it is done, and the consumer harness it
  named is gone (see [[TASK-225]]).'
---

## Where this stands (2026-08-29)

The reward is built and passes all 14 offline gate checks. **It has never once run**,
so nothing it computes has been observed. The tier-B controls were driven for the
first time on 2026-08-28 and **none of the four can be scored**, for three
independent reasons — none of them in the scoring logic. Merged as #273.

Fix them in this order; the order is not arbitrary:

1. **The reward is dead code in `*Wholebody*` tasks.** `env.step()` is never called,
   so `reward_manager.compute()` never runs. Until this is fixed, defect 2 is
   unobservable and the hand-body regex stays unverified — which is why it goes first.
2. **Two quaternion-ordering bugs** (Isaac Lab 3.0 is `(x, y, z, w)`): the tilt gate
   and `_yaw_from_quat` -> `_command_dir`.
3. **The object does not rest on the table** — it lay on its side all session.

**The pushability question this task exists to answer is still unmeasured.** The
sweep that was meant to settle it produced a void verdict. Risk 5 (does DDS carry the
reward values) *is* answered: no — a 900 s watch on `rt/rewards_state` came back empty.

## Description

Add a **push/slide success reward** to `unitree_sim_isaaclab` so that language instructions like
"Push the red cup to the left side of the table without lifting it" can be scored closed-loop.
The sim only rewarded pick-and-place, which made the unseen-behavior half of the DreamGen
ablation ([[TASK-187]], formerly [[TASK-185]] step 5b) impossible to measure.

## What was built (2026-08-28)

Everything lives in `robot-agent/hardware/isaac_sim_patches/`, following that directory's
convention: NeoDEM's changes to the third-party sim are carried as patch files, **never** as
edits to the checkout at
`$UNITREE_ROOT/unitree_sim_isaaclab` (pinned at `e30c25b`).

- **`0003-neodem-push-slide-reward.patch`** — a *second* patch rather than more hunks in
  `0001`, because `0001` is mandatory (without it the wholebody task does not move) while
  `0003` is evaluation-only and inert unless `--reward_mode push` is passed. They touch
  disjoint files; both orders `git apply --check` clean against `e30c25b`. Three hunks:
  - new `tasks/common_rewards/base_reward_push_cylindercfg.py`
  - `sim_main.py` — `--reward_mode` + eight `--push_*` flags, config hand-off next to the
    existing `_reward_interval` block, and `env._push_reward_reset = True` beside each
    `event_manager.trigger("reset_*_self", env)`
  - `tasks/g1_tasks/move_cylinder_g1_29dof_dex3_wholebody/mdp/rewards.py` — dispatcher
- **`verify_push_reward_gates.py`** — offline (no Isaac, no GPU) check of the scoring logic.
- **`push_reward_controls.py`** — DDS harness: watch `rt/rewards_state`, reset the episode,
  switch the commanded direction between rollouts.
- **`README.md`** — the new hunks documented in the existing voice, plus the four in-sim
  controls and both hazards below.

### The four gates, and why the TASK-185 failure cannot recur

| Gate | Rule | Default |
|---|---|---|
| 1 direction | credited displacement projected on the commanded axis ≥ `min_travel`, `abs(off-axis) ≤ ratio × on-axis`; the axis is frozen at the episode baseline | 0.15 m, 0.4 |
| 2 never lifted | sticky veto once `z − z₀` exceeds `max_lift` | 0.03 m |
| 3 still upright | sticky veto once tilt from world +z exceeds `max_tilt_deg` | 20° |
| 4 contact-driven | displacement is credited only while a hand body is within `contact_radius` of the object's surface; motion with no hand near it accrues as `free_travel` and vetoes past `max_free_travel` | 0.12 m, 0.05 m |

The invalidated proxy (lateral travel ≥ 0.08 m with lift ≤ 0.06 m) read **only the object's
trajectory**, and every quantity in it is equally producible by lifting, knocking or sweeping.
Gates 2 and 4 make trajectory alone insufficient by construction:

- a *place* is up-and-over, so gate 2 latches a veto before any transport distance can become
  success. The proxy measured lift **net** (start vs end), which for a place is ≈ 0 — that is
  exactly why `place` runs outscored `push` runs. Gate 2 is a running maximum, not a net.
- a *knock* or *swept launch* moves the object after the hand has left; that travel lands in
  `free_travel`, a different accumulator from the credited push, and vetoes past 5 cm.
- the commanded axis is frozen at the baseline, so the robot cannot turn to make an arbitrary
  displacement read as "left".

`verify_push_reward_gates.py` asserts this executably: the lift-and-place trajectory is
disqualified **and** the old proxy is shown accepting the same trajectory. 14/14 checks pass.

### Thresholds taken from this task's original proposal, and one that was changed

Kept: on-axis ≥ 0.15 m; lift ≤ 0.03 m (tightened from the proxy's 0.06 as proposed); a tilt cap;
a contact requirement. Changed: the proposal's "reject displacement occurring with no hand near
the object" is implemented as **per-sample attribution**, not an end-of-episode check — the
credited push and the object's total travel are separate accumulators. An end-of-episode
"was a hand near it" test would pass for a launch, because a hand *is* near it at the moment of
the swipe.

The **contact sensor was deliberately not used** for gate 4. `contact_forces` is declared
without `filter_prim_paths_expr`
(`tasks/g1_tasks/move_cylinder_g1_29dof_dex3_wholebody/move_cylinder_g1_29dof_dex3_hw_env_cfg.py:45`),
so it reports a net force per robot body and cannot attribute a contact to the *object* rather
than to the table or the floor. Proximity to the object's surface is the signal that actually
means what gate 4 needs.

## Two findings that were not in the original task

### 1. The scene's object probably cannot be pushed at all

`tasks/common_scene/base_scene_pickplace_cylindercfg_wholebody.py:56-77` — the object is a
cylinder of radius **0.018 m** and height **0.35 m**, mass 0.4 kg: a pencil-shaped rod standing
on end, ~10:1 aspect. Static friction 1.5 with `friction_combine_mode="max"` against the env's
1.0 (`…_wholebody.py:69-75`, `move_cylinder_g1_29dof_dex3_hw_env_cfg.py:156-159`), so µ ≈ 1.5.

Quasi-statically, a horizontal force at height `h` slides such an object rather than tipping it
only while `µ·m·g·h < m·g·r`, i.e. `h < r/µ = 0.018/1.5 ≈ 0.012 m`. Any contact more than ~1.2 cm
above the table tips it; a Dex3 palm cannot reach that band without hitting the table.

**This is an analytic bound, not a measurement.** Control (a) settles it. If it holds, the honest
options are to lower the object's friction or to give the push task a low-aspect object (a puck)
— and either changes the scene, so push results would no longer be comparable with the `place`
control that shares it. Do **not** relax `max_tilt_deg` to make the number move: that re-admits
"knocked over" as success, which is the failure this task exists to fix.

### 2. The stock pick-place reward is already dead in the wholebody task

`base_reward_pickplace_cylindercfg.py:51-54` gates on absolute world boxes `x ∈ (−0.42, 1.0)`,
`y ∈ (0.2, 0.7)`, written for the fixed-base scene whose object starts at `(−0.35, 0.40, 0.84)`
(`base_scene_pickplace_cylindercfg.py:95`). The wholebody scene starts the object at
`(−2.585, −2.790, 0.84)` in a warehouse (`…_wholebody.py:58`) — outside that box in both axes. So
in `Isaac-Move-Cylinder-G129-Dex3-Wholebody` the stock reward publishes a **constant −1.0** and
can never publish `1.0`, whatever the robot does. Any `place` baseline read off `rt/rewards_state`
in that task is a constant, not a measurement. The push reward is displacement-relative and
immune to this class of bug. (Verified by reading the configs; not confirmed on a live capture.)

## Tier B was run on 2026-08-28 — and the controls cannot be scored yet

The sim was booted against this patch and all four controls were driven. **None of them can be
scored**, for three independent reasons, none of which is in the reward's scoring logic. Full
write-up with line citations in `robot-agent/hardware/isaac_sim_patches/README.md` under
"In-sim controls — RUN 2026-08-28".

1. **The reward is never called in a Wholebody task — it is dead code there.**
   `sim_main.py:476-479` sets `use_rl_action_mode = True` for any `*Wholebody*` task;
   `layeredcontrol/robot_control_system.py:120-127` then skips `env.step(action)` entirely, and
   `env.step()` is what runs the reward manager. The wholebody provider hand-rolls physics
   (`action_provider_wh_dds.py:637-641`: `write_data_to_sim` / `sim.step` / `scene.update` /
   `observation_manager.compute()`) and never calls `reward_manager.compute()`. The one manual
   call site, `sim_main.py:559-561`, is commented out. `grep -rn 'env\.step('` across
   `action_provider/`, `sim_main.py` and `tools/` returns nothing.
   Evidence it really did not run: the reward prints `[push_reward] hand bodies` and
   `[push_reward] baseline` unconditionally on first call, and neither appears in a 1137-line
   session log — nor the `-2.0` throw path, nor any traceback. Independently,
   `push_reward_controls.py watch` ran the full 900 s from the minute the sim booted and
   reported `received 0 messages; final value None`.
   **This also supersedes finding 2 below**: the stock pick-place reward does not publish a
   constant −1.0 in this task, it publishes nothing at all.

2. **Two quaternion-ordering bugs in the reward.** Isaac Lab 3.0 returns `root_quat_w` as
   **(x, y, z, w)** — `IsaacLab30/.../assets/rigid_object/base_rigid_object_data.py:409-413`,
   with `root_quat_w` a shorthand for `root_link_quat_w` at :658-661. The reward assumes
   (w, x, y, z) twice:
   - gate 3: `cos_tilt = 1 - 2*(q[:,1]**2 + q[:,2]**2)` reads `y, z` as if they were `x, y`, so
     `max_tilt_deg` vetoes on a garbage angle;
   - `_yaw_from_quat` (:234-237) — its docstring says "(w, x, y, z) order" — feeds `_command_dir`,
     so a robot-frame `--push_direction left` does not point left.
   Confirmed empirically too: the rod lay on its side all session (true tilt exactly 90°, and a
   cylinder on its side keeps its axis horizontal however it rolls), and across all 12 sweep
   trials the xyzw reading was 90.0° every time while the wxyz reading wandered 27.8°–103.2°.
   Note patch 0004 (TASK-203) already unpacks `qx, qy, qz, qw` correctly and cites the same
   source line, so TASK-203's yaw/heading numbers are unaffected — this is confined to the reward.

3. **The object does not rest on the table.** Six seconds after boot, untouched, its pose was
   `pos=[-2.4832, -2.9629, 0.0180]`. `z = 0.0180` is exactly the rod's radius — where a cylinder's
   centre sits lying on its side on the TASK-223 ground plane at z=0. A `CylinderCfg` origin is the
   cylinder's **centre**, so spawning a 0.35 m rod at `z = 0.84`
   (`base_scene_pickplace_cylindercfg_wholebody.py:58`) puts its base at 0.665 — about 0.175 m
   inside a table whose top is at 0.84. PhysX ejects it and it lands on the floor.
   Until this is fixed no push/place/lift experiment in this scene means anything.

**Consequence for the pushability question (old finding 1): still unmeasured.** The height sweep
ran, but its verdict is void — an 8 N push on a rod already lying down just launches it 15–50 m.
Do not quote those numbers.

**What the run did establish.** The patch loads and boots; `--reward_mode push` is accepted and
reaches `env._reward_mode`. Controls (b), (c) and (d) turn out to be drivable *without* a robot,
because their assertions ride on gate 2 (lift) and gate 3 (tilt), which read object pose and need
no hand proximity — `neodem_push_probe.py` drives all three plus the height sweep in one boot.
Only control (a) still needs teleop or a policy, because gate 4 credits displacement only while a
hand is within `contact_radius_m`.

## What remains unverified

In descending order of risk:

1. **The reward has still never actually executed** (defect 1 above). Applies cleanly, compiles,
   loads and boots; that is all.
2. **`hand_body_patterns` may not match the real Dex3 USD.** The link names live in a
   crate-compressed USD token table (`assets/robots/g1-29dof_wholebody_dex3/…usd`) and are not
   readable without Isaac. The reward resolves them by regex, prints the resolved list once at
   startup, and raises `HandBodyResolutionError` with the full `body_names` list if they do not
   resolve — that exception is re-raised out of `compute_reward` rather than folded into the
   `-2.0` path, so it reaches the log. **Check that line first.** If it is empty, fix the
   patterns — do not widen `contact_radius_m`. Keep them a **single alternation**:
   `robot.find_bodies` → `resolve_matching_names` demands a one-to-one pattern↔body mapping and
   rejects `[".*hand.*", ".*wrist.*", ".*palm.*"]` outright, because `left_hand_palm_link`
   matches two of them.
3. **`contact_radius_m = 0.12` is a guess** about where the hand link origins sit relative to a
   real contact.
4. **Whether the rod is physically pushable** (finding 1).
5. ~~**Whether DDS carries the new values end to end.**~~ **ANSWERED 2026-08-28: it does not.**
   `rt/rewards_state` received 0 messages across a 900 s watch covering the whole session —
   because nothing computes a value to publish (defect 1). Re-check once defect 1 is fixed.

## Test Strategy

Two tiers. Tier A is done. Tier B was **run on 2026-08-28** and is blocked on the three defects
above — see "Tier B was run" for what that run established and what it did not.

**A — offline, already run (14/14 pass, ~1 s, no GPU):**

```bash
UNITREE_SIM_ROOT=$UNITREE_ROOT/unitree_sim_isaaclab \
  /home/humanoid/anaconda3/envs/tv/bin/python \
  robot-agent/hardware/isaac_sim_patches/verify_push_reward_gates.py
```

Covers slide / lift-and-place / knock / idle / launch / wrong-direction / off-axis, and asserts
that the trajectory the TASK-185 proxy accepted is disqualified here. Its `find_bodies` stub
reproduces `resolve_matching_names`' strict one-to-one rule, including both of its `ValueError`
paths, so the hand-body scenario can actually fail — a permissive stub is what let a
three-pattern default that Isaac Lab rejects pass an earlier run of this same check.

**B — in sim, RUN 2026-08-28, not scorable.** The four controls (slide → fires;
lift-and-place → must not fire; knock over → must not fire; do nothing → must not fire), with
the exact launch, watch and reset commands, are in
`robot-agent/hardware/isaac_sim_patches/README.md` under "In-sim controls — RUN 2026-08-28",
along with why none of them can be scored yet.

`neodem_push_probe.py` in the checkout drives controls (b), (c) and (d) plus a contact-height
sweep in a single boot, armed by `NEODEM_PUSH_PROBE` and inert otherwise. Its state machine has
its own offline check (26/26, ~1 s, no GPU), worth running first because a probe that dies
mid-boot costs a serialised GPU slot:

```bash
UNITREE_SIM_ROOT=$UNITREE_ROOT/unitree_sim_isaaclab \
  /home/humanoid/anaconda3/envs/tv/bin/python \
  robot-agent/hardware/isaac_sim_patches/verify_push_probe_offline.py
```

The arm motion in the first three controls is the only unscripted part: the checkout has no
scripted arm driver (`action_provider/create_action_provider.py:10-26` implements `dds`,
`dds_wholebody` and `replay` only, and a Wholebody task is forced onto `dds_wholebody` at
`sim_main.py:409-412`), so joints come from teleop or a policy. Writing such a driver is a
separate task.

**C — the ablation cell** (re-run TASK-185's cell and confirm the `place`-instructed control no
longer outscores the `push`-instructed run) **cannot be run yet, and its original consumer is
gone.** The task previously pointed at `$UNITREE_ROOT/_data/task185/eval_g1_sim_groot_success.py`
(`--mode push`, the invalid proxy) on the retired Windows box. That harness no longer exists —
see [[TASK-225]], which is porting the train + closed-loop-eval harness to Linux and re-fetching
the data. Whatever replaces it should consume `rt/rewards_state` directly (values: `1.0` success,
`0.0` in progress, `-1.0` disqualified, `-2.0` the reward term itself threw) and must **not**
re-derive a proxy from `rt/sim_state`.
