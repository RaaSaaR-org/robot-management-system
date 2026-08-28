# isaac_sim_patches — NeoDEM's changes to `unitree_sim_isaaclab`

Unitree's Isaac Lab sim (`unitree_sim_isaaclab`) is a **third-party checkout**,
not a submodule and not vendored here. Seven NeoDEM changes, in two required patch
files, are needed before the G1 wholebody DDS task runs at a usable control
rate with a robot that stays on the floor — and, before two of them, it does
not move at all. They live here as patches so a fresh checkout can be brought
to a working state without rediscovering them.

Three further patches are optional and evaluation-only: `0003` adds a push/slide
success reward (TASK-186), `0005` adds the tier-B harness that drives that
reward's controls (TASK-186), and `0004` adds the gait instrumentation that proved
the G1 walks (TASK-203 step 2). Neither changes dynamics or anything the policy
observes.

## Applying

```bash
cd "$UNITREE_ROOT/unitree_sim_isaaclab"
git checkout e30c25b                       # the pinned upstream commit
P=/path/to/robot-management-system/robot-agent/hardware/isaac_sim_patches
git apply $P/0001-neodem-g1-wholebody-sim.patch
git apply $P/0002-task223-missing-ground-plane.patch
git apply $P/0003-neodem-push-slide-reward.patch   # optional; only for scoring pushes
git apply $P/0004-task203-gait-instrumentation.patch # optional; measuring the gait
git apply $P/0005-task186-tierb-scene-probe.patch  # optional; driving 0003's controls
git apply $P/0006-task203-steps45-instrumentation.patch # optional; head z + policy-side cmd
```

**`0001` and `0002` are both required** (`0003` is optional — see below).
`0001` is what makes the task run at all; `0002` gives
the robot a floor to stand on and fixes the IMU quaternion it publishes — and
`isaac_gait_probe.py`'s default `--quat-order xyzw` is only the correct reading
once `0002` is applied, so running the probe against a `0001`-only sim silently
reproduces TASK-223's false `base upright FAIL`. **Even both are not
sufficient** — see the Isaac Lab 3.0 port warning immediately below.

| | |
|---|---|
| Upstream | `https://github.com/unitreerobotics/unitree_sim_isaaclab` |
| Pinned commit | `e30c25b` (detached HEAD) |
| Isaac Sim / Lab | 6.0.1 / 6.1.14, conda env `unitree_sim_env6` |
| Patches | `0001-neodem-g1-wholebody-sim.patch` (3 hunks), `0002-task223-missing-ground-plane.patch` (4 hunks), `0003-neodem-push-slide-reward.patch` (optional, evaluation-only), `0004-task203-gait-instrumentation.patch` (optional, observation-only), `0005-task186-tierb-scene-probe.patch` (optional, purely additive, inert unless armed), `0006-task203-steps45-instrumentation.patch` (optional, purely additive) |
| Files touched by 0001 + 0002 | `action_provider/action_provider_wh_dds.py` (4 hunks), `tasks/common_observations/camera_state.py`, `tasks/common_observations/g1_29dof_state.py`, `tasks/common_scene/base_scene_pickplace_cylindercfg_wholebody.py` |
| Files touched by 0003 | `sim_main.py`, `tasks/g1_tasks/move_cylinder_g1_29dof_dex3_wholebody/mdp/rewards.py`, new `tasks/common_rewards/base_reward_push_cylindercfg.py` |
| Files touched by 0004 | `action_provider/action_provider_wh_dds.py` (4 hunks) |
| Files touched by 0005 | `sim_main.py` (2 hunks, both additions), new `neodem_push_probe.py` |
| Files touched by 0006 | `action_provider/action_provider_wh_dds.py` (3 hunks, all additions) |

`git apply` against a different upstream commit may reject. The seven hunks in
`0001` + `0002` are independent of one another, and each is documented below by
the symptom it fixes, so a reject can be re-applied by hand.

## ⚠ The checkout carries an uncommitted Isaac Lab 3.0 port that is NOT in these patches

As of 2026-08-28, `git -C "$UNITREE_ROOT/unitree_sim_isaaclab" status --porcelain` reports
**30 modified files**, not the four `0001` + `0002` touch. The rest are an Isaac Sim 6.0.1 /
Isaac Lab 3.0 migration (`sim.physx` -> `sim.physics`, `ProxyArray.torch` on the
`common_observations/*_state.py` reads, the `InitialStateCfg.rot` quaternion reorder in
`tasks/common_config/robot_configs.py`), written up in
`$UNITREE_ROOT/g1_quest_teleop/docs/STATUS.md` under R19.

**A fresh checkout brought to `e30c25b` + `0001` + `0002` will therefore NOT run**, and any result
reproduced from TASK-204 / TASK-223 was obtained against the working tree, not against this
patch set. Capturing that port here is unfinished work.

## `0002-task223-missing-ground-plane.patch` (TASK-223)

Applies on top of `0001` and of the port above. **Verified by three sim boots on 2026-08-28**,
and the committed patch reverse-applies cleanly against the checkout that produced the
measurements (`git apply --check -R`), so what is written here is what actually ran.

### The finding: there was no floor

The G1 was not failing to balance. It was **free-falling**. The wholebody scene shipped a
`# Ground plane` heading with nothing under it, so nothing was under the robot's `z = 0.8`
spawn:

| step | `z` | `projected_gravity` | |
|---|---|---|---|
| 0 | +0.7865 | (−0.000, +0.000, −1.000) | upright |
| 25 | −0.7542 | (−0.031, +0.044, −0.999) | still upright, already below the floor |
| 550 | −599.31 | | |
| 4475 | −39338.16 | | |

Δ`z` grows by 0.0037 m/step — exactly `g·dt²` at the task's 50 Hz of simulated time. Textbook
free fall, from step 0, for as long as the sim runs. `projected_gravity` stays (0, 0, −1) for
the first ~100 steps: the robot is *perfectly upright* the whole way down, and only tumbles
later as flailing limbs impart angular momentum with nothing to push against. **Every
"why can't it balance" hypothesis was being tested on a robot with nothing to balance on.**

The warehouse USD *does* carry a collidable floor — `/Lab/Structure/floor`, a 4-point quad at
world `z = 0`, `physics:approximation="none"`, `collisionEnabled=True`, whose xy extent covers
the spawn at (−3.9, −2.818). But it is spawned at `/World/envs/env_.*/Room`, **inside** the
cloned env, while the task sets `replicate_physics=True`. Upstream's own (commented-out) ground
in the *non*-wholebody scene sits at `/World/GroundPlane` — outside `/World/envs` — which is the
placement that survives cloning.

**After the fix:** `z` holds in [0.7825, 0.7919] — a 9 mm band — for the entire run,
`projected_gravity` (0, 0, −1), no joint within 0.02 rad of a limit, leg velocities decaying to
0.24 rad/s. Over DDS, `isaac_gait_probe.py --no-command` run for 43 s reports
`base upright PASS`, `knees/ankles off their limits PASS`, roll 0.007 rad, pitch 0.044 rad,
*"never — stayed upright"*, with every leg joint static to three decimals.

⚠ **Superseded 2026-08-28 — it does walk.** This section used to end "it stands; it does not
yet walk", on the evidence that a `vx = 0.5` command produced a forward lean (pitch 0.08 vs
0.045 at rest) and no stepping. **That was a defect in `isaac_gait_probe.py`, not in the sim.**
The probe published the velocity command at 20 Hz while the policy consumes — and *clears* —
it at 50 Hz, so the commanded `vx` was in front of the policy for only about a third of steps
and zero for the rest. Publishing at 100 Hz, as the vendor's own `send_commands_keyboard.py`
always did, the same sim walks at 0.570 m/s. See "0004 — gait instrumentation" below.

### The hunks

1. `action_provider_wh_dds.py` — `obs_scales`, env-selectable. This was TASK-223's lead 1 and
   **it is refuted.** The hypothesis was sound on paper: upstream ships all `1.0` and
   `assets/model/policy.onnx` has no normalisation layer of its own (7 nodes: `Gemm`/`Elu` ×3 +
   `Gemm`, no metadata), so those six numbers are the only normalisation the policy ever sees —
   and Unitree locomotion policies train with `ang_vel` 0.25 / `joint_vel` 0.05. Once there was
   a floor, both arms were run:

   | `obs_scales` | result |
   |---|---|
   | all `1.0` (upstream, **default**) | stands rock solid, `z` in a 9 mm band |
   | 0.25 / 0.05 (Unitree) | **collapses** — `z` → ~0.07, `projected_gravity` → (−1, 0, 0) i.e. face down, ankles pinned 28–50 % of the run, knees thrashing in antiphase at 3.6 Hz |

   So upstream's all-`1.0` is correct for this checkpoint. The knob stays only so the
   measurement can be reproduced: `NEODEM_OBS_SCALES=unitree` selects the refuted arm.
2. `action_provider_wh_dds.py` — `_task223_log`. Prints, from inside the sim,
   `projected_gravity_b` (a convention-free uprightness test), root height, true roll/pitch from
   `root_quat_w` read as `(x,y,z,w)`, leg angles vs defaults, and — once, at step 0, before the
   first action is applied — the full articulation joint-name order. **This is what found the
   free fall.** It also closed leads 2 and 3 in one line: at step 0,
   `old_action_indices == list(range(29))` and every `action_to_indices` entry is ≤ 18 < 29, so
   the 29-vs-43 joint indexing is sound.
3. `tasks/common_observations/g1_29dof_state.py:370` —
   `ensure_quat_w_first(quat, assume_w_first=True)` -> `False`. **Symptom without it:** a
   perfectly upright, motionless base publishes `|roll| = pi` on `rt/lowstate`, so every
   "is it standing?" check fails unconditionally; the accelerometer and gyroscope on the same
   topic are rotated by a garbage matrix as well. Upstream's `True` was correct on Isaac Lab
   2.x, where the quaternion was `(w,x,y,z)`; Isaac Lab 3.0 returns `(x,y,z,w)`. Now validated
   end to end: with the robot standing, the probe reads roll 0.007 rad over DDS, matching the
   sim's own internal log — the two independent paths agree.
4. `tasks/common_scene/base_scene_pickplace_cylindercfg_wholebody.py` — **the missing ground
   plane.** `ground = AssetBaseCfg(prim_path="/World/GroundPlane", spawn=GroundPlaneCfg())`,
   placed outside `/World/envs` for the cloning reason above. This is the fix; hunks 1–3 are
   the instrumentation that found it and the measurement bug that hid it.

⚠ Even with hunk 3, this sim puts `imu_state.quaternion` on the wire as **(x, y, z, w)**
(`dds/g1_robot_dds.py:101`, the vendor's own `#[x,y,z,w]` comment), which is not the real
robot's order. `isaac_gait_probe.py --quat-order` selects the reading; there is no way to detect
it from the data, because every permutation of a unit quaternion is still a unit quaternion.


**Why 0003 is a separate file rather than more hunks in 0001.** They are not
the same kind of change and do not have the same audience. 0001 is *mandatory*
— without it the wholebody task does not move. 0003 is *evaluation-only*: it
changes nothing unless you pass `--reward_mode push`, and a run that does not
is bit-identical to upstream. Keeping them apart means a checkout that only
needs to drive the robot never carries the scoring code, and a reject in one
does not block the other. They touch disjoint files, so either order works —
verified: 0001 then 0003, and 0003 then 0001, both `git apply --check` clean
against `e30c25b`.

## What each hunk fixes, and how it fails without it

### 1. `action_provider_wh_dds.py` — warp `Device` is not a `torch.device`

Isaac Lab 3.0+ returns a warp `Device` from `env.device`; `torch.tensor(device=...)`
accepts only a `torch.device`. Wrapped as `torch.device(str(self.env.device))`.

**Symptom without it:** immediate `TypeError` on the first policy step.

### 2. `action_provider_wh_dds.py` — action tensor needs a leading env dimension

`_full_action_buf` is 1-D `(43,)`. Isaac Lab 6.1.14 requires `(1, 43)` and raises
`Shape mismatch: torch.Size([43]) != (1, 43)` — which `set_joint_position_target`'s
caller **swallows**. Older Isaac Lab accepted the unbatched form.

**Symptom without it:** the sim runs, DDS traffic looks healthy, no error is
printed, and the robot never moves. This one is expensive to debug precisely
because it is silent — that is why it is written down.

### 3. `camera_state.py` — camera copies ran on every control step (TASK-204)

`get_camera_image` did the GPU→host `.cpu().numpy()` copies for the head, left
and right cameras on **every** call, then used them only inside the
`frame_step == 0` branch and returned a constant placeholder either way. The
existing `write_interval_steps` knob gated only the shared-memory *write* — the
cheap half. The patch takes the early-out **before** the copies.

Behaviour-identical: on a non-capture frame nothing below the early-out is
consumed, and the return value is the same placeholder object.

**Symptom without it:** the sim advances ~14 control steps per second of wall
clock — real-time factor **0.28** — so any caller on wall clock (Agent Mode,
`isaac_loco_bridge.py`, teleop, episode recording) has its commands consumed
3.6× slower than it issues them, and falls further behind the longer it runs.

⚠ **This does not change the policy's control rate, and cannot.** `decimation = 4`
× `sim.dt = 0.005` fixes that at **50 Hz of simulated time** in every
configuration below. The patch buys real-time factor, which is what an external
closed-loop consumer needs; it buys the *policy* nothing. If you are chasing a
robot that will not walk, this knob is not the variable — see TASK-223.

## Measured effect of hunk 3

Per `get_action`, CUDA-synchronised, ~2000 samples per configuration, task
`Isaac-Move-Cylinder-G129-Dex3-Wholebody`, `num_envs=1`:

All rates are **wall clock**; simulated-time control rate is 50 Hz in every row.

| Configuration | obs | loop | wall-clock rate | RTF |
|---|---|---|---|---|
| Stock, `--device cuda` | 24.5 ms | 67.3 ms | 14.1 Hz | 0.28 |
| Stock, `--device cpu` | 39.0 ms | 55.4 ms | 17.5 Hz | 0.35 |
| Patched, `--camera_write_interval 2` | 21.6 ms | 34.4 ms | 29.9 Hz | 0.60 |
| Patched, `--camera_write_interval 6` | 9.9 ms | 21.2 ms | 46.0 Hz | 0.92 |
| **Patched, `--camera_write_interval 10`** | **7.8 ms** | **19.0 ms** | **52.2 Hz** | **1.04** |
| Cameras disabled entirely (upper bound) | 0.3 ms | 11.2 ms | 93 Hz | 1.86 |

Two things this measurement overturned, recorded so nobody re-derives them:

- **`env.sim.render()` costs 0.1 ms** — 0.15 % of the loop. It is not the
  bottleneck, and removing it buys nothing.
- **`--device cpu` is 3.4× faster than `--device cuda` on `sim.step`**
  (28.7 → 8.5 ms). GPU PhysX is a pessimisation at `num_envs=1`.

`--camera_write_interval` trades control rate against camera cadence: at 52 Hz
interval 10 yields ~5 Hz frames — fine for Agent Mode head snapshots, too slow
for VR teleop. It is a CLI flag, so pick per use case rather than once.

`observation_manager.compute()` is also the only publisher of robot joint state
to DDS in this mode, so it cannot simply be skipped — which is why the camera
term is throttled inside it rather than the whole observation pass.

## 0003 — push/slide success reward (TASK-186)

> Numbered 0003, not 0002: the 0002 slot is TASK-223's obs-scales/attitude
> patch. The two are independent — 0003 touches only the reward path and
> 0002 only the observation path — so they can be applied in either order,
> and neither depends on the other.

Three hunks, all inert unless `--reward_mode push` is passed.

### 4. new `tasks/common_rewards/base_reward_push_cylindercfg.py`

Publishes on the **same** `rt/rewards_state` channel and in the same shape as
the pick-place reward (`{"rewards":[r],"timestamp":t}`), so no consumer needs
changing. Values: `1.0` success (latched), `0.0` in progress, `-1.0`
disqualified (latched), `-2.0` the reward itself threw — deliberately not
`0.0`, because a scoring term that reports "nothing happened" when it is broken
is precisely how the bad proxy below survived a whole ablation.

One failure is excluded from `-2.0` and **crashes the run instead**: a
`HandBodyResolutionError`, i.e. `hand_body_patterns` not resolving against this
USD. Gate 4 cannot run without hand bodies, so the session could only publish
noise; the exception carries the offending patterns and the robot's full
`body_names`, which is what you need to write a working pattern. Note that
`robot.find_bodies` enforces a strict one-to-one pattern↔body mapping — it
raises both when two patterns match one body and when a pattern matches none —
so keep `hand_body_patterns` a **single alternation**
(`[".*(hand|wrist|palm).*"]`), never a list of independent patterns.

Four gates, all of which must hold:

| Gate | Rule | Default |
|---|---|---|
| 1 direction | credited displacement projected on the commanded axis ≥ `min_travel`, and `abs(off-axis) ≤ ratio × on-axis` | 0.15 m, 0.4 |
| 2 never lifted | sticky veto once `z − z₀` exceeds `max_lift` | 0.03 m |
| 3 still upright | sticky veto once object tilt from world +z exceeds `max_tilt_deg` | 20° |
| 4 contact-driven | displacement is only **credited** while a hand body is within `contact_radius` of the object's surface; displacement accrued with no hand near it accumulates as `free_travel` and vetoes past `max_free_travel` | 0.12 m, 0.05 m |

**How it fails without it:** there is no push signal at all, so the
unseen-behaviour half of the DreamGen ablation cannot be scored — TASK-185 had
to report it as unanswerable. What TASK-185 actually did was worse than nothing:
it derived a proxy from `rt/sim_state` (lateral travel ≥ 0.08 m with lift
≤ 0.06 m) and that proxy was **satisfied more often by `place`-instructed runs
(7–8/10) than by `push`-instructed runs (6/10)**. It measured flailing.

**Why that cannot recur here.** The proxy read only the object's trajectory.
Every quantity in it — how far the object moved, how high it ended up — is
equally producible by lifting it, by knocking it, or by sweeping an arm through
it. Gates 2 and 4 make trajectory alone insufficient by construction:

- A *place* is an up-and-over transport. The object rises well past 0.03 m
  while it is being carried, so gate 2 latches a veto **before** any of the
  transport distance can turn into success. The proxy's `lift` term was
  measured net (start vs end), which for a place is ≈ 0 — that is exactly why
  it passed. Gate 2 is a running maximum, not a net, so it cannot.
- A *knock* or a *swept launch* moves the object after the hand has left. That
  travel is attributed to `free_travel`, never to the credited push, and past
  5 cm it latches a veto. The credited push and the object's total travel are
  different accumulators; the proxy only had the latter.
- The commanded axis is **frozen at the episode baseline**, so the robot cannot
  turn to make an arbitrary displacement read as "left".

There is no trajectory that clears all four without a hand having stayed with
the object, on the table, along the instructed axis — which is the behaviour
the instruction names.

### 5. `sim_main.py` — CLI flags, config hand-off, and the reset hook

Adds `--reward_mode {pickplace,push}` (default `pickplace`) and
`--push_direction/--push_min_travel/--push_max_offaxis_ratio/--push_max_lift/`
`--push_max_tilt_deg/--push_contact_radius/--push_max_free_travel/--push_cfg_file`,
and writes them onto the env next to the existing `_reward_interval` block.

It also sets `env._push_reward_reset = True` beside each
`event_manager.trigger("reset_*_self", env)`.

**How it fails without the reset hook:** those triggers teleport the object
*without* calling `env.reset()`, so `episode_length_buf` never moves and the
reward has no way to see an episode boundary. Its baseline (start height, start
position, commanded axis) would stay pinned to the very first episode, and the
teleport back to the start would be integrated as ~0.2 m of hand-free travel —
so every episode after the first would come back `-1.0` for a reason that has
nothing to do with the robot. The reward carries a teleport heuristic
(`reset_jump_m`, 0.25 m in one sample) as a backstop, but that is a guess and
this is not.

### 6. `move_cylinder_g1_29dof_dex3_wholebody/mdp/rewards.py` — dispatcher

`compute_reward` now forwards to the push reward when `env._reward_mode ==
"push"` and to the stock pick-place reward otherwise. Only the **Dex3**
wholebody variant is patched — that is the G1 EDU platform this project
targets. The dex1 and inspire variants keep upstream behaviour; the dispatcher
is a six-line copy if they ever need it.

### Running a scoring session

Same invocation as below, plus the reward flags:

```bash
  ... sim_main.py --task Isaac-Move-Cylinder-G129-Dex3-Wholebody \
    --enable_dex3_dds --enable_wholebody_dds --robot_type g129 \
    --device cpu --headless --enable_cameras --camera_write_interval 10 \
    --reward_mode push --push_direction left --env_reward_interval 1
```

`--push_direction` takes `left|right|forward|backward` (robot frame, resolved
from the robot's yaw at the episode baseline) or `+x|-x|+y|-y` (world frame).

To change the commanded direction *between* rollouts without restarting Isaac
(a restart costs ~2 min), pass `--push_cfg_file /dev/shm/push.json` and have the
harness write e.g. `{"direction": "right"}` before each rollout — the file's
mtime is polled at 4 Hz and a change re-baselines the episode.

⚠ Use `--env_reward_interval 1` for scoring runs. The default of 5
(`sim_main.py:77`) samples the gates at 10 Hz rather than 50 Hz; the
accumulators are integrals over samples so it does not bias the verdict, but it
coarsens `free_travel` and can miss a brief tilt excursion.

### ⚠ The scene's object probably cannot be pushed at all

This is a property of the scene, not of the reward, and it is the first thing
to check if the reward never fires.

The object is a cylinder of **radius 0.018 m and height 0.35 m**, mass 0.4 kg
(`tasks/common_scene/base_scene_pickplace_cylindercfg_wholebody.py:56-77`) — a
pencil-shaped rod standing on end, ~10:1 aspect. Its static friction is 1.5 and
the combine mode is `max` against the env's 1.0
(`…_wholebody.py:69-75`, `move_cylinder_g1_29dof_dex3_hw_env_cfg.py:156-159`),
so µ ≈ 1.5.

Quasi-statically, a horizontal force applied at height `h` slides such an object
rather than tipping it only while `µ·m·g·h < m·g·r`, i.e. `h < r/µ =
0.018/1.5 ≈ **0.012 m**`. Any contact more than ~1.2 cm above the table tips it.
A Dex3 palm cannot reach that band without hitting the table.

**Unverified — this is an analytic bound, not a measurement.** Settle it with
control (a) below before concluding the reward is broken. If it holds, the
honest options are to lower the object's friction, or to give the push task a
low-aspect object (a puck) — and note that either changes the scene, so
push results would no longer be comparable with the `place` control that shares
it. Do **not** relax `max_tilt_deg` to make the number move: that re-admits
"knocked over" as success, which is the exact failure this task exists to fix.

### ⚠ The stock pick-place reward is already dead in this task

Separate pre-existing finding, recorded because it silently corrupts any
baseline read off `rt/rewards_state` in the wholebody task. The pick-place
reward gates on **absolute world-frame boxes** — valid area `x ∈ (−0.42, 1.0)`,
`y ∈ (0.2, 0.7)` (`base_reward_pickplace_cylindercfg.py:51-54`). Those were
written for the fixed-base scene, whose object starts at `(−0.35, 0.40, 0.84)`
(`base_scene_pickplace_cylindercfg.py:95`). The wholebody scene puts the object
at `(−2.585, −2.790, 0.84)` in a warehouse
(`base_scene_pickplace_cylindercfg_wholebody.py:58`) — outside that box in both
axes. So in `Isaac-Move-Cylinder-G129-Dex3-Wholebody` the stock reward publishes
a **constant −1.0** and can never publish `1.0`, regardless of what the robot
does. The push reward is displacement-relative and therefore immune to this
class of bug. (Verified by reading the configs; not yet confirmed on a live
`rt/rewards_state` capture.)

### Offline check of the gates

`verify_push_reward_gates.py` here drives synthetic trajectories through the
reward with `isaaclab` stubbed out — no Isaac, no GPU, ~1 s:

```bash
UNITREE_SIM_ROOT=$UNITREE_ROOT/unitree_sim_isaaclab \
  /home/humanoid/anaconda3/envs/tv/bin/python \
  robot-agent/hardware/isaac_sim_patches/verify_push_reward_gates.py
```

It covers slide/lift-and-place/knock/idle/launch/wrong-direction/off-axis and
asserts that the lift-and-place trajectory — the one the TASK-185 proxy
accepted — is disqualified. It pins the **scoring logic only**: it cannot tell
you whether the hand-link regex matches the real USD, whether the rod is
physically pushable, or whether DDS carries the value. Those need the in-sim
controls below. 14/14 checks pass as of this commit.

Its `find_bodies` stub is a behavioural port of Isaac Lab's
`isaaclab.utils.string.resolve_matching_names`, **including both of its
`ValueError`s** — one body matched by two patterns, and a pattern that matches
nothing. That is deliberate: the stub's first version accepted pattern lists
the real API rejects outright, which made the hand-body scenario unfailable and
let a default of `[".*hand.*", ".*wrist.*", ".*palm.*"]` — which raises on any
G1 with `left_hand_palm_link` — pass 13/13. Keep the stub strict; if it ever
disagrees with Isaac Lab, the stub is what is wrong.

### In-sim controls — RUN 2026-08-28, and they CANNOT be scored yet

⚠ **Read this before running anything below.** The sim was booted against this
patch on 2026-08-28 and the four controls were driven. **Not one of them can be
scored, for three independent reasons found in that run** — all three are
defects, none of them is in the reward's scoring logic, and the first one alone
makes the whole patch dead code in the only task that has the push scene.

The four control recipes further down are still correct and are kept as-is; they
become runnable once defects 1 and 3 are fixed.

#### Defect 1 — the reward is never called in a Wholebody task

**The reward function never executed.** It prints `[push_reward] hand bodies
(N): [...]` and `[push_reward] baseline (...)` unconditionally on its first
call; neither line appears anywhere in a 1137-line session log, and nor does
the `-2.0` "the reward threw" path or any traceback. `rt/rewards_state`
carried nothing to match. The reason is a code path, not a configuration:

* `sim_main.py:476-479` — any task with `Wholebody` in its name (or
  `--enable_wholebody_dds`) forces `action_source = "dds_wholebody"` **and**
  `control_config.use_rl_action_mode = True`.
* `layeredcontrol/robot_control_system.py:120-127` — `RobotController.step()`
  is `if self.config.replay_mode or self.config.use_rl_action_mode: pass` …
  `else: self.env.step(action)`. With the RL action mode on, **`env.step()` is
  never called**, and `env.step()` is what runs the reward manager.
* `action_provider_wh_dds.py:637-641` — the wholebody provider hand-rolls the
  physics instead: `scene.write_data_to_sim()` / `sim.step(render=False)` /
  `scene.update(dt=...)`, then `observation_manager.compute()`. There is no
  `reward_manager.compute()` anywhere in it.
* `sim_main.py:559-561` — the one place that could compute it by hand is
  `if (loop_count % reward_interval) == 0: pass`, with
  `# current_reward = get_step_reward_value(env)` **commented out**.

`grep -rn 'env\.step('` over `action_provider/`, `sim_main.py` and `tools/`
returns nothing at all. So `compute_reward` — this patch's and the stock
pick-place one alike — is unreachable in every `*Wholebody*` task.

This supersedes the claim in "⚠ The stock pick-place reward is already dead in
this task" above: that section says the stock reward publishes a constant
`-1.0`. It does not publish anything, because it is never invoked. The
world-box analysis in that section is still correct about what the reward
*would* return; it just never gets the chance.

**Smallest fix:** call the reward manager from the sim_main loop when the
wholebody provider is in charge — effectively reinstating line 561 as
`env.reward_manager.compute(dt=env.step_dt)` behind the existing
`reward_interval` gate. `tools/get_reward.py:get_current_rewards` already wraps
exactly that call and is already imported at `sim_main.py:140`.

#### Defect 2 — the reward reads the quaternion in the wrong order

Isaac Lab 3.0 returns `root_quat_w` as **(x, y, z, w)**, not (w, x, y, z):

    IsaacLab30/source/isaaclab/isaaclab/assets/rigid_object/base_rigid_object_data.py:409-413
        @leapp_tensor_semantics(kind=..., element_names=QUAT_XYZW_ELEMENT_NAMES)
        def root_link_quat_w(self):
            """Root link orientation (x, y, z, w) in simulation world frame."""
    …:658-661   root_quat_w is a shorthand for root_link_quat_w

`base_reward_push_cylindercfg.py` assumes wxyz in two places, so both are wrong:

| Where | Code | Consequence |
|---|---|---|
| gate 3, tilt | `cos_tilt = 1 - 2*(q[:,1]**2 + q[:,2]**2)` — treats `q[1], q[2]` as `x, y`; they are `y, z` | `max_tilt_deg` vetoes on a garbage angle |
| `_yaw_from_quat`:234-237 | docstring literally says "(w, x, y, z) order"; unpacks `w,x,y,z = quat[:,0..3]` | `_command_dir` rotates robot-frame directions by a wrong yaw, so `--push_direction left` does not point left |

Both were confirmed empirically as well as from the source. The rod spent the
session lying on its side (see defect 3), i.e. at a true tilt of exactly 90°,
and it slid without changing that — a cylinder on its side keeps its symmetry
axis horizontal however much it rolls. Across all 12 sweep trials the xyzw
reading was **90.0° every time** while the wxyz reading wandered between 27.8°
and 103.2°. A formula that varies while the quantity it measures is constant is
the wrong formula.

Note `action_provider_wh_dds.py:449-457` (patch 0004, TASK-203) already unpacks
`qx, qy, qz, qw` correctly and cites this same source line, so TASK-203's yaw
and heading measurements are unaffected. The bug is confined to this reward.

#### Defect 3 — the object does not rest on the table; it is on the floor

Six seconds after boot, with the robot standing still and nothing having
touched it, the object's pose was:

    [push_probe] home pose: pos=[-2.4832, -2.9629, 0.0180]
                            quat=[0.7071, -0.0014, -0.3599, -0.6087]

`z = 0.0180` is **exactly the rod's radius** (0.018 m), which is where a
cylinder's centre sits when it lies on its side on a plane at `z = 0` — the
TASK-223 ground plane. The quaternion reads exactly 90° of tilt under the
correct (xyzw) formula. So the rod is flat on the warehouse floor, not standing
on a table.

The spawn is the likely cause and is arithmetic, not physics:
`base_scene_pickplace_cylindercfg_wholebody.py:58` puts the object at
`z = 0.84`, but a `CylinderCfg` origin is the cylinder's **centre** and the rod
is 0.35 m tall — so its base spawns at `0.84 − 0.175 = 0.665`, roughly 0.175 m
*inside* a table whose top is at 0.84. PhysX resolves that interpenetration by
ejecting it, and it lands on the floor.

Until this is fixed, no push, place, or lift experiment in
`Isaac-Move-Cylinder-G129-Dex3-Wholebody` means anything: they all act on a rod
lying on open floor. **The pushability question is therefore still unmeasured.**
The height sweep did run to completion, but its verdict ("no swept height
produced a 0.20 m slide") is **void** — an 8 N push on a rod already lying down
just launches it 15–50 m across the map, which is what every trial recorded.
Do not quote those numbers.

Fixing this means changing the scene, and the warning under "the scene's object
probably cannot be pushed at all" applies: a `place` control that shares this
scene is equally affected, so both baselines move together.

#### What the run did establish

* The patch loads, the sim boots with it, and `--reward_mode push` is accepted
  and reaches `env._reward_mode` (`[env] reward mode: push (push_direction=left)`).
* Risk 2 from the task — "`hand_body_patterns` may not match the real Dex3 USD"
  — is **still open**. The regex never got the chance to resolve, because the
  reward never ran. The offline check confirms only that the pattern is legal
  under Isaac Lab's one-to-one rule, not that it matches this USD.
* Controls (b), (c) and (d) are drivable without a robot after all: their
  assertions ride on gate 2 (lift) and gate 3 (tilt), which read object pose and
  do not require hand proximity. `neodem_push_probe.py` drives all three. Only
  control (a) still needs teleop or a policy, because gate 4 credits
  displacement only while a hand is within `contact_radius_m`.

#### Reproducing

`neodem_push_probe.py` (in the checkout, armed by `NEODEM_PUSH_PROBE`, inert
otherwise) drives `idle` → `lift` → `knock` → `sweep` in one boot;
`verify_push_probe_offline.py` here exercises its state machine on the CPU in
~1 s, which is worth running first because a probe that dies mid-boot costs a
GPU slot. The launch used was:

```bash
NEODEM_PUSH_PROBE=all NEODEM_PUSH_PROBE_DELAY=300 \
  <the docker run below, plus --reward_mode push --env_reward_interval 1>
```

---

The four control recipes below are unchanged and still correct. Run them in
order once defects 1 and 3 are fixed; each is a fresh episode.

⚠ One `sim_main.py` at a time, and wait for `nvidia-smi` to return to its
~111 MiB baseline between runs (see the warning further down).

**Terminal 1 — the sim.** One launch serves all four controls.

```bash
docker run --rm --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e NEODEM_LOG_EVERY=5 \
  -e HOME=/home/humanoid -e PYTHONPATH= -e CYCLONEDDS_HOME=$UNITREE_ROOT/cyclonedds/install \
  --device /dev/dri --ipc=host --network host \
  -v /home/humanoid:/home/humanoid -w $UNITREE_ROOT/unitree_sim_isaaclab \
  neodem-isaac-host:latest \
  /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python -u sim_main.py \
    --task Isaac-Move-Cylinder-G129-Dex3-Wholebody \
    --enable_dex3_dds --enable_wholebody_dds --robot_type g129 \
    --device cpu --headless --enable_cameras --camera_write_interval 10 \
    --reward_mode push --push_direction left \
    --env_reward_interval 1 --push_cfg_file /dev/shm/neodem_push.json
```

On startup it must print, before anything else is judged:

```
[env] reward mode: push (push_direction=left)
[push_reward] hand bodies (N): [...]
[push_reward] baseline (...): direction=left world_dir=[0.0, 1.0] origin=[-2.585..., -2.789..., 0.84...]
```

If the `hand bodies` line names something that is not a hand, stop: the regex
needs fixing for this USD and every result below is meaningless. If it is
missing entirely, look for a `HandBodyResolutionError` — the patterns did not
resolve, the exception prints them next to the robot's full `body_names`, and
the run stops there rather than publishing `-2.0` forever.

**Terminal 2 — the reward, for the whole session.**

```bash
CYCLONEDDS_HOME=$UNITREE_ROOT/cyclonedds/install \
  /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python \
  robot-agent/hardware/isaac_sim_patches/push_reward_controls.py watch --seconds 900
```

**Terminal 3 — reset before each control.**

```bash
CYCLONEDDS_HOME=$UNITREE_ROOT/cyclonedds/install \
  /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python \
  robot-agent/hardware/isaac_sim_patches/push_reward_controls.py reset --category 1
```

| # | Control | Arm motion | Terminal 2 must show | A different result means |
|---|---|---|---|---|
| a | **slide** the cylinder 0.20 m to the robot's left, keeping the hand on it, without lifting | teleop / policy | `+1.0 SUCCESS`, latched | If it never fires, read the sim log for `DISQUALIFIED: tipped(...)` — that is the rod's 10:1 aspect ratio, not the reward. See the warning above. |
| b | **lift** it, carry it 0.20 m left, set it down | teleop / policy | `-1.0 DISQUALIFIED`, and the sim log says `lifted(0.xxx m)`. **Never `+1.0`.** | A `+1.0` here is the TASK-185 regression reappearing — do not ship. |
| c | **knock it over** with a swipe | teleop / policy | `-1.0 DISQUALIFIED`, sim log `tipped(NNdeg)` and/or `free_travel(0.xxx m)` | |
| d | **do nothing** for a full 20 s episode | none | `0.0` only; no transition at all | Any transition means an accumulator drifts at rest — likely `free_travel` picking up physics jitter. |

The arm motion in (a)–(c) is the **only** part that is not scripted. The
checkout has no scripted arm driver: `create_action_provider` implements
`dds`, `dds_wholebody` and `replay` only (`action_provider/create_action_provider.py:10-26`),
and a Wholebody task is forced onto `dds_wholebody`
(`sim_main.py:409-412`), so joints come from `rt/lowcmd` (`dds/g1_robot_dds.py:63`)
and `rt/dex3/{left,right}/cmd` (`dds/dex3_dds.py:76-82`) — i.e. from teleop or a
policy. Producing (a)–(c) from a canned joint trajectory would mean writing that
driver, which is not part of this task.

To switch the commanded direction between rollouts without restarting:

```bash
python robot-agent/hardware/isaac_sim_patches/push_reward_controls.py \
  direction right --cfg-file /dev/shm/neodem_push.json
```

## 0006 — head z and the policy-side command (TASK-203 steps 4 and 5)

Optional and observation-only, like 0004: it changes no dynamics, no observation
the policy sees and no action. Three purely additive hunks in
`action_provider/action_provider_wh_dds.py`.

(Numbered 0006, not 0005: `0005-task186-tierb-scene-probe.patch` is landing on
its own branch and the numbers must not collide.)

**`base_z=` and `head_z=` on the `[TASK-203]` line**, for step 5's bob
measurement. `head_z` comes from the **`d435_link` rigid body**, not the camera.

⚠ `front_camera.data.pos_w` was tried first and is **STATIC**. Over a whole run
it reported exactly one distinct value (1.27387) while `base_z` moved through
62 — a Camera's `pos_w` does not track its parent prim under this provider's
hand-rolled `write_data_to_sim` / `sim.step` / `scene.update` loop. Using it
would have reported "no bob" for the WALKING case too, i.e. a silent false
negative on exactly the claim step 5 exists to test. The rigid body's pose comes
from the same articulation buffer as `base_z` and demonstrably tracks (86
distinct values over the same window). The resolved body name is printed once,
with the full `body_names` list, so a USD change surfaces immediately.

**`NEODEM_LOG_POLICY_CMD=1`** prints the velocity command as it sits in the
tensor handed to `policy.onnx` — after scaling, history stacking and clipping —
which is the one thing no DDS observer can see. The frame is 91 wide (`ang_vel`
3, `projected_gravity` 3, `command` 4, `joint_pos` 26, `joint_vel` 26, `action`
29), so `wz` is index 8; ten frames of history are flattened, and all ten slots
`91*k + 8` are printed rather than one, because which slot is newest depends on
`CircularBuffer`'s internal ordering.

That log settled TASK-203's turn asymmetry. It shows

    raw_cmd_wz=+1.0000 obs_wz(10 frames)=[1.0, 1.0, ... 1.0]
    raw_cmd_wz=-1.0000 obs_wz(10 frames)=[-1.0, -1.0, ... -1.0]

so the positive command reaches the policy **intact, in every history frame**,
and the policy ignores it: the asymmetry is in the checkpoint, not the plumbing.
It also shows the self-clearing command slot directly — an occasional frame
reads `[-0.2, 0.0, -0.2, ...]` even at a 100 Hz publish rate, which is why that
rate must not be lowered.

The measurements, and the `isaac_yaw_sweep.py` / `isaac_bob_report.py` tools
that produced them, are in `.mc/tasks/todo/TASK-203-*.md` under steps 4 and 5.

## 0004 — gait instrumentation (TASK-203 step 2)

Optional, and observation-only: it changes no dynamics, no observation the
policy sees and no action. It exists because TASK-203 step 2 asks whether "the
robot walks ... feet making and breaking contact", and **neither the existing
`[TASK-223]` log line nor the external `isaac_gait_probe.py` can answer either
half of that**:

* The `[TASK-223]` line prints `z` but not `x`/`y`. That is enough to catch a
  fall, which is what it was written for, but a robot marching on the spot and a
  robot crossing the room produce identical output.
* `unitree_hg`'s `LowState_` has no `foot_force` field — that is the `go` IDL —
  so **nothing on the DDS wire observes foot contact at all.** The probe's
  left/right knee correlation is a proxy that a robot lying on its side
  thrashing its knees would also pass.

The contact signal was already there for free: the wholebody scene carries a
`ContactSensor` with `track_air_time=True`
(`move_cylinder_g1_29dof_dex3_hw_env_cfg.py:45`). This patch just reads it.

The patch adds, to `action_provider/action_provider_wh_dds.py`:

1. **`NEODEM_LOG_EVERY`** — the log interval, default 25 (the previous
   hard-coded value). **Set it to 5 when measuring a gait.** 25 steps is 2 Hz of
   simulated time and the G1 steps at ~1.7 Hz, so the default *aliases the gait*:
   the same walk measured at 2 Hz reports a 0.27 Hz foot cadence and at 10 Hz
   reports 1.72 Hz. `isaac_gait_report.py` still prints the cadence in that case
   but marks it `⚠ ALIASED`; the duty-factor percentages beside it are unaffected
   and stay valid, being per-sample occupancies rather than rates.
2. **A `[TASK-203]` line** carrying base `x`/`y`, base `yaw`, the velocity
   command the policy actually saw that step, and per-foot vertical contact
   force, air time and contact time.

Yaw is needed because course-over-ground is undefined when the robot is asked to
turn in place — which is exactly the case being tested. The **command** is
logged because attributing a log window to a phase by counting steps from when a
test script started is guesswork: real-time factor is not exactly 1.0, so the
mapping drifts. That is not hypothetical — the first yaw reading taken this way
said "positive yaw works, negative is dead", and the self-describing log showed
the truth is the exact opposite.

Read the output with `robot-agent/hardware/isaac_gait_report.py`.

### Measured with it, 2026-08-28 — the G1 walks

Sim per "Running it" below plus `NEODEM_LOG_EVERY=5`, driven by
`isaac_gait_probe.py --domain 1 --vx 0.5 --secs 25`:

⚠ The launch below is a `docker run` with an explicit `-e` list, so the variable
has to be passed **as `-e NEODEM_LOG_EVERY=5` among those flags**. Setting it as
a shell variable in front of `docker run` sets it on the host and it never
reaches the sim, which then samples at the default 2 Hz — the aliased case this
whole section warns about. `--secs` likewise defaults to 20; the 24.3 s window
below needs 25.

| | measured | commanded |
|---|---|---|
| ground speed | **0.570 m/s** | 0.500 (+14 %) |
| path travelled | 13.84 m in 24.3 s | — |
| exactly one foot airborne | **74.6 %** | — |
| double support | 25.4 % | — |
| both feet airborne | **0.0 %** | — (a walk, not a run) |
| foot make/break cadence | 1.69 / 1.73 Hz | — |

The foot cadence is an *independent* confirmation of the gait: the DDS probe,
which never sees the contact sensor, measured 1.73 / 1.75 Hz from knee joint
positions on the same walk. Two unrelated signals agreeing to ~1 % is what
distinguishes a gait from noise. Zero flight phase with 25 % double support is a
textbook walking duty factor.

### ⚠ Two defects this exposed, both open

**1. Heading drifts right while walking.** With `yaw_vel` commanded at exactly
0, the base turns −3.1 to −3.4 °/s — about −82 ° over a 24 s walk, bending a
straight-line command into an arc (13.84 m of path for 12.75 m of displacement).

**2. Left turns do nothing; right turns work.** Measured over twelve yaw phases
across three runs, all from a standing start, all with `vx = 0` except the last
row:

| commanded `wz` | achieved | ratio | feet airborne |
|---|---|---|---|
| +0.5 (×4 attempts) | +0.01 … +0.67 °/s | **0.00–0.02** | **0.0 %** |
| +1.0 | +0.40 °/s | **0.01** | **0.0 %** |
| −0.2 | −0.02 °/s | 0.00 | 0.0 % |
| −0.5 (×3) | −20.3 / −21.2 / −21.9 °/s | 0.71–0.76 | 52–58 % |
| −1.0 (×2) | −43.3 / −45.5 °/s | 0.76–0.79 | 58–60 % |
| −0.3 with `vx` 0.3 | −16.9 °/s | **0.98** | 72.6 % |

Per `send_commands_keyboard.py`, which publishes `-yaw_vel`, a **positive** `wz`
on the wire is a **left** turn. So the G1 turns right on command, reproducibly
and with a consistent 0.71–0.79 gain, and does not respond to a left-turn
command at all — it does not even step. There is also a deadband: `−0.2` alone
did nothing, while `−0.3` combined with forward motion tracked at 0.98.

Neither defect is diagnosed. Both belong to TASK-203 step 4 (`walk` / `turn` /
`goto` end to end), and the second one blocks it: a `goto` that needs a left
turn cannot be satisfied by this policy. Note the arc case tracked best of all,
so the fix may be as simple as never commanding a pure in-place turn.

**Not investigated:** whether this is a property of the shipped `policy.onnx`, a
sign error on the yaw element of the command vector, or an artefact of the
command being rebuilt every step. The obvious next probe is to feed the policy a
constant left-yaw observation directly, bypassing DDS, and see whether the
action vector changes at all.

## Running it

Isaac's RTX renderer needs Vulkan, which needs `/dev/dri/renderD*`, whose ACL
systemd-logind grants to whoever holds seat0. Over SSH you do not hold it, and
CUDA working is not evidence that Vulkan will (CUDA uses the world-readable
`/dev/nvidia*`). Running as root in a container sidesteps the ACL:

```bash
docker run --rm --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e NEODEM_LOG_EVERY=5 \
  -e HOME=/home/humanoid -e PYTHONPATH= -e CYCLONEDDS_HOME=$UNITREE_ROOT/cyclonedds/install \
  --device /dev/dri --ipc=host --network host \
  -v /home/humanoid:/home/humanoid -w $UNITREE_ROOT/unitree_sim_isaaclab \
  neodem-isaac-host:latest \
  /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python -u sim_main.py \
    --task Isaac-Move-Cylinder-G129-Dex3-Wholebody \
    --enable_dex3_dds --enable_wholebody_dds --robot_type g129 \
    --device cpu --headless --enable_cameras --camera_write_interval 10
```

The container supplies root, nothing else — it bind-mounts the host home and
runs the **host** conda env's own python, so there is no second Isaac install to
keep in sync. `Dockerfile` here builds `neodem-isaac-host:latest`.

Three traps, each of which presents as something unrelated:

- **`--user 0` is required.** The stock `isaac-sim` image runs as uid 1234, so
  the render-node ACL still applies inside it.
- **`NVIDIA_DRIVER_CAPABILITIES=all` is required**, or you get the identical
  seatless symptom *inside* the container.
- **`libgomp1` missing** from a minimal CUDA base surfaces as
  `AttributeError: module 'omni.usd' has no attribute 'get_context'` — 50
  library load failures upstream of it, none of which name `libgomp`.

⚠ After killing an Isaac container, **wait for `nvidia-smi` to return to its ~111 MiB
baseline before relaunching.** A hard kill leaves ~23 GB held for tens of seconds, and a
sim started into that hangs at 0 % CPU with a 3-line log and no error — it presents as a
startup failure, not as GPU contention.

## What is NOT covered by any test

Nothing automated exercises anything in this directory — here or upstream.
Stating it plainly so the green CI badge on the PR that added it is not read as
coverage:

- The repo's four CI checks (app / server / robot-agent typecheck+build, Prisma)
  do not touch `.patch` files or any Python under `robot-agent/hardware/`.
- Nothing runs `git apply --check` against `e30c25b`, so **upstream moving will
  break this patch silently.** Re-verify by hand after any bump:
  `cd <checkout> && git apply --check robot-agent/hardware/isaac_sim_patches/0001-*.patch`
- Per `CLAUDE.md`, the `SIM_PYTHON` / `HARDWARE_PYTHON` pytest stages report
  **SKIPPED rather than failed** when their interpreter is missing, so a run
  that says "all tests passed" may have run none of them.

Verification to date is by inspection plus the hand-run measurements above.

`verify_push_reward_gates.py` is the one exception, and only a partial one: it
runs anywhere a CPU torch exists and covers the push reward's scoring logic. It
is **not** wired into `test-all.sh` — the `HARDWARE_PYTHON` stage guarantees only
numpy + pytest, and this needs torch. Run it by hand after touching
`base_reward_push_cylindercfg.py`.

`0004` and `isaac_gait_report.py` (TASK-203) are likewise unwired: nothing in
CI parses a sim log, and `isaac_gait_report.py` needs a log from a live sim to
do anything. Its two analysis bugs were both found by hand and both silently
produced a *confident wrong answer* rather than an error, which is the failure
mode to expect here:

* the moving-window detector anchored on the first sample above the speed
  threshold, which is a boot transient at step 1, so it averaged the settle
  phase into the walk and reported 0.159 m/s for a 0.5 m/s command;
* the aliasing guard compared the sample rate against the cadence it had just
  measured — circular, since aliasing is what drags that cadence down — so a
  2 Hz sampler reporting a 0.27 Hz cadence for a 1.7 Hz gait raised no warning.

Both are fixed and both directions are now exercised by hand against a real log,
but only by hand.

What still has **no** coverage of any kind, automated or manual, as of TASK-186:

- that `0003` applies, imports and runs inside Isaac at all — it has never been
  loaded by a live sim;
- that `hand_body_patterns` matches the real Dex3 USD (the link names are in a
  crate-compressed USD token table and are not readable without Isaac);
- that `contact_radius_m = 0.12` corresponds to a real hand–object contact
  rather than a near miss;
- that DDS actually carries the new values end to end.

## Open hazard this patch makes more likely (pre-existing, not introduced)

`camera_state.py:116-135` takes the **zero-copy** `.numpy()` path when the
tensor is already on CPU — and the invocation above recommends `--device cpu`.
Those arrays alias Isaac's reused camera output buffer and are handed to a
daemon writer thread. This repo already documents the same hazard elsewhere:
`isaac_capture.py:1118`, *"`.clone()` is load-bearing: the camera's output
buffer is reused next frame."*

The patch does not create this, but by shortening the loop 3.7× it shortens the
window between the copy and the buffer's reuse by the same factor — so a tear
that was rare becomes likelier. It matters most on the VR-teleop record path,
which runs `--device cpu --enable_cameras` straight into a LeRobot episode.

**Unresolved — two lines on a box with Isaac up would settle it:**

```python
t = cam.data.output["rgb"][0]; print(t.data_ptr())   # across two steps
```

Same pointer on consecutive steps ⇒ the buffer is reused and the consumer needs
`.clone()`. Not yet run; do not assume either answer.

⚠ Only ever run **one** `sim_main.py` at a time. Its exit handler
(`sim_main.py:608-668`) pgreps for `sim_main.py` and SIGTERM/SIGKILLs every
match except itself. DDS domains: **0** = real robot, **1** = sim, **9** = mock.
