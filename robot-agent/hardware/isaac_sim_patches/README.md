# isaac_sim_patches — NeoDEM's changes to `unitree_sim_isaaclab`

Unitree's Isaac Lab sim (`unitree_sim_isaaclab`) is a **third-party checkout**,
not a submodule and not vendored here. Three NeoDEM changes are needed before
the G1 wholebody DDS task runs at a usable control rate — and, before two of
them, it does not move at all. They live here as a patch so a fresh checkout
can be brought to a working state without rediscovering them.

A second, optional patch adds a push/slide success reward (TASK-186).

## Applying

```bash
cd "$UNITREE_ROOT/unitree_sim_isaaclab"
git checkout e30c25b                       # the pinned upstream commit
P=/path/to/robot-management-system/robot-agent/hardware/isaac_sim_patches
git apply $P/0001-neodem-g1-wholebody-sim.patch
git apply $P/0003-neodem-push-slide-reward.patch   # optional; only for scoring pushes
```

| | |
|---|---|
| Upstream | `https://github.com/unitreerobotics/unitree_sim_isaaclab` |
| Pinned commit | `e30c25b` (detached HEAD) |
| Isaac Sim / Lab | 6.0.1 / 6.1.14, conda env `unitree_sim_env6` |
| Files touched by 0001 | `action_provider/action_provider_wh_dds.py`, `tasks/common_observations/camera_state.py` |
| Files touched by 0003 | `sim_main.py`, `tasks/g1_tasks/move_cylinder_g1_29dof_dex3_wholebody/mdp/rewards.py`, new `tasks/common_rewards/base_reward_push_cylindercfg.py` |

`git apply` against a different upstream commit may reject. The hunks are
independent and small enough to re-apply by hand from the symptoms below.

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

### In-sim controls — NOT YET RUN

These are the four controls TASK-186 asks for. **None of them has been run**:
the GPU is serialised and the sim was not booted while this was written. Run
them in order; each is a fresh episode.

⚠ One `sim_main.py` at a time, and wait for `nvidia-smi` to return to its
~111 MiB baseline between runs (see the warning further down).

**Terminal 1 — the sim.** One launch serves all four controls.

```bash
docker run --rm --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
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

## Running it

Isaac's RTX renderer needs Vulkan, which needs `/dev/dri/renderD*`, whose ACL
systemd-logind grants to whoever holds seat0. Over SSH you do not hold it, and
CUDA working is not evidence that Vulkan will (CUDA uses the world-readable
`/dev/nvidia*`). Running as root in a container sidesteps the ACL:

```bash
docker run --rm --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
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
