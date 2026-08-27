---
id: TASK-203
aliases:
- TASK-203
title: Run Agent Mode against Isaac Sim so the G1 walks instead of glides
slug: run-agent-mode-against-isaac-sim-so-the-g1-walks
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
- sim
depends_on: []
due_date: ''
created: 2026-08-08
updated: 2026-08-08
---


# Run Agent Mode against Isaac Sim so the G1 walks instead of glides

## Description

Agent Mode today drives `sim_g1_dds`, whose base is **kinematic**: `loco_state.py:241` integrates
`vx/vy/omega` into a pelvis pose, the legs stay in the stand pose, and the feet float ~1.5 cm off
the floor. The robot glides. Stand up Unitree's `unitree_sim_isaaclab` as an alternative DDS peer so
the same Agent Mode blocks produce a real gait in a warehouse scene.

**No RL training is required.** See "What we ruled out" below — this was investigated on 2026-08-08
and the training route is a dead end for this goal.

## Details

### Current state

* `robot-agent/hardware/sim_g1_dds/` — MuJoCo sim, serves `/loco/*` and the Unitree `sport` RPC via
  `loco_service.py`. Kinematic base, documented as such in its `README.md:68` ("There is no gait in
  v1 ... A real gait policy is a follow-up").
* Agent Mode speaks `LocoClient` over DDS. On real hardware `SetVelocity` hands off to Unitree's
  **onboard** gait controller (`robot-agent/hardware/g1_sidecar.py:37`), so nothing about the control
  path needs to change — only the simulator's realism.

### What Unitree's Isaac sim already gives us

Checkout: `$UNITREE_ROOT/unitree_sim_isaaclab`

* **The right robot.** `assets/robots/g1-29dof_wholebody_dex3/g1_29dof_with_dex3_rev_1_0.usd` has
  exactly 43 joints matching `sim_g1_dds/joints.py` — 29 `BODY` + 7 `LHAND` + 7 `RHAND`, identical
  names, zero extras. Verified by walking the USD with `pxr`. So joint mapping is by name, 1:1.
* **A pre-trained walking policy.** `assets/model/policy.onnx` (and `policy1.onnx`): `obs [1,910]` →
  `actions [1,12]` — the 12 leg joints. Loaded by `sim_main.py` via `--model_path`. Nothing to train.
* **A factory scene.** `assets/objects/small_warehouse/small_warehouse_digital_twin.usd`.
* **Mobile tasks.** `tasks/g1_tasks/move_cylinder_g1_29dof_dex3_wholebody` — per its README, tasks
  with `Wholebody` in the name enable mobile operation.

### The gap to close

`unitree_sim_isaaclab` publishes **low-level** DDS only — `rt/lowcmd`, `rt/lowstate`,
`rt/dex3/*`, plus `rt/run_command/cmd` for velocity commands (see `send_commands_keyboard.py`,
which sends `x_vel` / `y_vel` / `yaw_vel`). It does **not** serve the high-level `sport` RPC on
`rt/api/sport/{request,response}` that `LocoClient` — and therefore Agent Mode — talks to.

We already have that server: `sim_g1_dds/loco_service.py` (`LocoSimService`). The work is to front
Unitree's Isaac sim with it, translating `SetVelocity` into the velocity command its locomotion
policy already consumes.

**Watch the trap `sim_g1_dds/README.md` calls out:** two `sport` services on one DDS domain means the
RPC is answered by whichever wins the race. Do not run the MuJoCo sim and the Isaac sim on the same
domain. Domains in use: 0 = real robot, 1 = sim, 9 = mock.

### Key files

* `robot-agent/hardware/isaac_loco_bridge.py` — **the adapter this task is about.** Answers the
  `sport` RPC and republishes onto `rt/run_command/cmd`. Its module docstring works out the two
  things that are easy to get wrong: the sign convention (`send_commands_keyboard.py`'s negations
  cancel its own internal convention, so the bridge forwards vy/omega **unchanged**) and the clock
  caveat (`LocoState` expires commands against a wall clock here, not Isaac's sim time).
* `robot-agent/hardware/isaac_loco_check.py` — the step-3 checker; imports no bridge code.
* `robot-agent/hardware/sim_g1_dds/loco_service.py` — the `sport` RPC server to reuse
* `robot-agent/hardware/sim_g1_dds/joints.py` — the 43-joint wire order, matches the Dex3 USD
* `unitree_sim_isaaclab/sim_main.py` — sim entry point, `--model_path` for the policy
* `unitree_sim_isaaclab/send_commands_keyboard.py` — the velocity command path to replace
* `robot-agent/.env.g1-edu-agent` — point `HARDWARE_SIDECAR_URL` at the new facade

### Rendering: NOT a blocker — Isaac Sim 6.0.1 renders fine headless

An earlier revision of this task claimed headless rendering was broken on this box and that Isaac Sim
5.0.0 was needed. **That was wrong.** Disproven 2026-08-08 by running the stock, unmodified
`scripts/tutorials/04_sensors/run_usd_camera.py --headless --enable_cameras --save`, which produced
2708 RGB frames with full geometry, materials, shadows and floor reflections (std ≈ 50 over ~7000
distinct colours — not a sky gradient). Isaac Sim 6.0.1 on GPU_BOX renders correctly.

What actually went wrong with the earlier empty captures is still open, but the leading explanation is
**GPU contention**: every failed capture was run while the 1500-iteration PPO job held ~26 GB at 90%
utilisation. A capture launched against the same GPU under that load also crashed the tutorial with
`Warp CUDA error 700: illegal memory access` — which vanished once the GPU was free. Re-test any
capture on an idle GPU before concluding anything about the renderer.

Confirmed a second time via the normal RL path: `play.py --task Isaac-Velocity-Flat-G1-Play-v0
--num_envs 1 --checkpoint model_1499.pt --headless --enable_cameras --video --video_length 400`
produced a 400-frame video of the G1 **walking** — alternating stride, bent knees, arm swing, contact
shadow, tracking the blue velocity-command arrow across ~11 floor tiles. Same invocation returned
empty sky while training was running. Video:
`logs/rsl_rl/g1_flat/2026-08-08_12-57-36_walkvid/videos/play/rl-video-step-0.mp4`.

Note `nvidia-smi` reports display Disabled and the only X server is a virtual `:1` with no GL, so
there is still no interactive GUI — but offscreen rendering does not need one.

Two things Isaac needs to start at all here:
* `OMNI_KIT_ACCEPT_EULA=YES` — otherwise Kit prompts and dies with "Unable to bootstrap inner kit
  kernel: EOF when reading a line".
* `git-lfs` on `PATH` — rsl_rl's logger shells out to `git status`; the IsaacLab checkout has an lfs
  filter configured but no binary. Use `$CONDA_ENV/bin`.

### Already running on this box

`unitree_sim_isaaclab`'s `sim_main.py` has been observed running for 12+ hours with
`--task Isaac-PickPlace-Cylinder-G129-Dex3-Joint --enable_dex3_dds --robot_type g129 --enable_cameras
--device cpu`. Note `--device cpu` for physics. This is a working reference invocation — start from it.

(The `OMNI_KIT_ACCEPT_EULA` and `git-lfs` prerequisites are listed once, above.)

### What we ruled out (2026-08-08)

* **Training our own locomotion policy is unnecessary.** The real G1 walks using Unitree's onboard
  controller via `LocoClient`; Unitree's Isaac sim walks using the shipped `policy.onnx`. A policy
  from us buys only simulator fidelity, never a change to the Agent Mode control contract.
* **Isaac Lab's stock `G1_MINIMAL_CFG` is the wrong robot.** It is the older 37-DOF G1 — one
  `torso_joint` (not `waist_yaw`/`roll`/`pitch`), `elbow_pitch` + `elbow_roll` (not `elbow_joint`),
  no wrists, and a 3-finger gripper (`_zero_`…`_six_joint`) instead of Dex3. **18 of its 37 joint
  names exist on our robot** (the 12 legs + 6 shoulders); 19 do not, and 25 of our 43 are missing
  from it. The two action vectors are not interchangeable under any permutation, so a policy trained
  on it cannot drive our robot without retargeting across a different kinematic tree.
* A full `Isaac-Velocity-Flat-G1-v0` PPO run was completed as a pipeline check and **converged**:
  4096 envs, 1500 iterations, 77 min 49 s of PPO, reward −1.26 → 23.89, episode length 991.26/1000,
  `success_rate 1.0`. It works, and it is for the wrong robot variant.
  Logs: `IsaacLab30/logs/rsl_rl/g1_flat/2026-08-08_12-57-36_walkvid/` (~64 MB: 31 `.pt` checkpoints,
  an `exported/` TorchScript + ONNX actor, tfevents, and a 400-frame walking video).
* **Nothing in this repo can consume that policy, and none of the three interfaces match.** Ours is
  Unitree's shipped sim policy at `obs[1,910] → actions[1,12]` (legs only); the trained run is
  `obs[1,123] → actions[1,37]`; and NeoDEM's own RL gate
  (`robot-agent/hardware/sim_evaluator/envs/locomotion_wrappers.py`) is a 96-dim / 29-DOF MuJoCo
  contract with a frozen `VecNormalize` manifest that the run has no equivalent of
  (`obs_normalization: false`). Verified 2026-08-09: no code, config, env var, script, symlink or
  `.gitignore` rule in this repo resolves any path under an IsaacLab logs tree.
* **Verdict: keep the artifacts where they are, commit none of them.** They live in a third-party
  detached-HEAD checkout, not in this repo, and vendoring 64 MB of checkpoints into a repo with no
  LFS buys nothing. If the run is ever wanted again, `params/env.yaml` + `params/agent.yaml` +
  IsaacLab commit `ffff603eafc6b74264a5261cc0183d6a65390d78` reproduce it in ~78 min via
  `scripts/reinforcement_learning/rsl_rl/train.py --task Isaac-Velocity-Flat-G1-v0 --headless`
  (4096 envs / seed 42 / 1500 iters are the stock defaults; no flags were passed).

## Test Strategy

1. ~~Isaac renders at all~~ — **done 2026-08-08**, see above. Keep the GPU free of other Isaac/PPO
   jobs when capturing.
2. `unitree_sim_isaaclab` runs the Dex3 wholebody task and the robot walks under keyboard velocity
   commands (`send_commands_keyboard.py`), feet making and breaking contact.
   **BLOCKED — see [[TASK-223]]** (was TASK-204; re-pointed 2026-08-28). Commands reach the policy
   and drive all 12 leg joints, but into their limits rather than into a gait. Joint motion here is
   not evidence of walking.

   The original diagnosis — the sim stepping at 5–13 Hz against a policy trained for 100 Hz — was
   **not a cause at all**, and this is worth understanding before picking the step up. `decimation 4`
   × `sim.dt 0.005` pins the policy at 50 Hz of *simulated* time whatever the host does; the slow
   number was real-time factor (0.28), which starves a wall-clock caller such as
   `isaac_loco_bridge.py` but tells the policy nothing. TASK-204 fixed that (RTF 0.28 → 1.04, and
   worth having for exactly this step, since Agent Mode drives the bridge on wall clock) and the
   robot still does not walk: it does not even stand, with no velocity command sent. The actual
   blocker is [[TASK-223]]. Candidate causes tested there are recorded with their negative results
   so they are not re-run — and note that the two "different control rate" retests were dynamically
   the same experiment, so they are not among the useful negatives.
3. ~~The `sport` RPC facade answers `SetVelocity`~~ — **done 2026-08-08.** `isaac_loco_check.py`
   passes 7/7 (six velocity cases including lateral and yaw, plus command expiry) driving an
   unmodified `LocoClient` with no bridge code imported. Run `isaac_loco_bridge.py --domain 1`
   first, then `isaac_loco_check.py --domain 1`. Note this proves the **wire**, not the gait —
   the second half of the original step ("and the robot walks in response") is gated on step 2.
4. Agent Mode `walk` / `turn` / `goto` blocks drive it end to end with no Agent Mode code changes.
   Gated on step 2.
5. Head-camera frames show gait-induced bob absent from the kinematic base — the observable
   difference that motivates this task. Gated on step 2.
