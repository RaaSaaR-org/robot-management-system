---
id: TASK-203
aliases:
- TASK-203
title: Run Agent Mode against Isaac Sim so the G1 walks instead of glides
slug: run-agent-mode-against-isaac-sim-so-the-g1-walks
status: in-progress
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
spe: 3
effort: ""
due_date: ''
created: 2026-08-08
updated: "2026-09-05"
parent: ""
---


# Run Agent Mode against Isaac Sim so the G1 walks instead of glides

> ⚠ **The Windows GPU box is retired (2026-08-28).** This file was written when a
> separate Windows/WSL machine ("GPU_BOX") existed. It does not any more — the only
> machine is the Linux dev box with the RTX 5090. Read every mention of GPU_BOX,
> WSL, `.bat` or `C:\...` below as *historical context*, not as where the work
> happens.

**What this means for TASK-203:** where the text says "Isaac Sim 6.0.1 on GPU_BOX
renders correctly", read: it renders correctly *here* — but only inside a
container running as root. Isaac's RTX renderer is Vulkan, Vulkan needs
`/dev/dri/renderD*`, and systemd-logind grants that ACL only to whoever holds
seat0, which an SSH session does not. CUDA working is not evidence Vulkan will.
The working invocation is in `robot-agent/hardware/isaac_sim_patches/README.md`.


## Where this stands (2026-08-29)

Steps 1, 2, 3 and 5 are done and merged. **Step 4 is the only one open**, and what
remains of it is narrow: the DDS layer underneath Agent Mode is proven, but the
`walk` / `turn` / `goto` blocks have not been driven end to end.

| Landed in | What |
|---|---|
| #270 | The G1 walks. Our probe had been under-publishing the command 5x. |
| #272 | Step 5 measured; step 4 diagnosed. `isaac_yaw_sweep.py`, `isaac_bob_report.py`, patch `0006`. |

**Two product decisions are open, and step 4 cannot be finished without them:**

1. In-place left turns are dead in this checkpoint (ratio 0.01). Left turns *in an
   arc* work (0.55-0.60 with `vx=0.3`). Is a left turn that requires forward
   clearance acceptable? If yes, `goto` is satisfiable in both directions today.
2. Should Agent Mode **refuse** an in-place left turn rather than accept it and
   silently not perform it? Today it would accept and do nothing.

The cause is settled and is not ours to fix: the `+1.0` yaw command reaches
`policy.onnx` intact in all ten history frames, identical in form to `-1.0`, and the
policy ignores it. That is trained asymmetry in the checkpoint. See step 4 below.

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
2. ~~`unitree_sim_isaaclab` runs the Dex3 wholebody task and the robot walks under keyboard
   velocity commands, feet making and breaking contact~~ — **done 2026-08-28. The G1 walks.**

   | | measured | commanded |
   |---|---|---|
   | ground speed | **0.570 m/s** | 0.500 (+14 %) |
   | path travelled | 13.84 m in 24.3 s of simulated time | — |
   | exactly one foot airborne | **74.6 %** | — |
   | double support | 25.4 % | — |
   | both feet airborne | **0.0 %** | — (a walk, not a run) |
   | foot make/break cadence | 1.69 / 1.73 Hz | — |

   Foot contact is measured from the scene's own `ContactSensor` (`track_air_time=True`), not
   inferred: `unitree_hg`'s `LowState_` has no `foot_force` field, so **nothing on the DDS wire
   can see contact at all**. Independently, `isaac_gait_probe.py` measured a 1.73 / 1.75 Hz knee
   cadence on the same walk from joint positions alone — two unrelated signals agreeing to ~1 %.
   Zero flight phase with 25 % double support is a textbook walking duty factor.

   **What was actually wrong was our probe, not the sim.** The earlier "commands drive the legs
   into their limits rather than into a gait" reading, and TASK-223's closing "it stands; it does
   not yet walk", were both artefacts of `isaac_gait_probe.py` publishing the velocity command at
   20 Hz. The sim's command slot is **self-clearing** — `action_provider_wh_dds.py`
   `compute_current_observations` reads it and immediately writes `[0,0,0,0.8]` back into the same
   shared-memory slot (`dds/commands_dds.py:71-98`) — so a command survives exactly one policy
   step. At 50 Hz policy vs 20 Hz publishing the policy saw the commanded `vx` in about a third of
   steps and zero in the rest: a ~35 %-duty-cycle square wave where it was trained on a held
   constant. The vendor's `send_commands_keyboard.py` has always published at 100 Hz
   (`time.sleep(0.01)`), which is why it never hit this. Same sim, same policy, same checkpoint,
   only the publish rate changed:

   | probe publish rate | knee range | knee cadence | result |
   |---|---|---|---|
   | 20 Hz (old) | 0.079 rad | — | lean, no steps |
   | 100 Hz (fixed) | **0.941 rad** | 1.73 Hz | **walks** |

   Reproduce: apply `isaac_sim_patches/0004-task203-gait-instrumentation.patch`, start the sim
   per `isaac_sim_patches/README.md` — that launch is a `docker run`, so the setting has to go in
   as **`-e NEODEM_LOG_EVERY=5`**, not as a shell variable in front of it — then run
   `isaac_gait_probe.py --domain 1 --vx 0.5 --secs 25` and `isaac_gait_report.py <sim-log>`.
   ⚠ `NEODEM_LOG_EVERY=5` matters: the default 25 is 2 Hz of simulated time and **aliases** the
   ~1.7 Hz gait, reporting a 0.27 Hz foot cadence for the very same walk. `--secs` matters too:
   it defaults to 20, and the 24.3 s window above needs 25.

   ### ⚠ Two defects this exposed — both open, both land on step 4

   **(a) Heading drifts right while walking.** With `yaw_vel` commanded at exactly 0 the base
   turns −3.1 to −3.4 °/s, about −82 ° over a 24 s walk, bending a straight command into an arc
   (13.84 m of path for 12.75 m of displacement).

   **(b) Left turns do nothing; right turns work.** Twelve yaw phases over three runs, all at
   `vx = 0` except the last row:

   | commanded `wz` | achieved | ratio | feet airborne |
   |---|---|---|---|
   | +0.5 (×4) | +0.01 … +0.67 °/s | **0.00–0.02** | **0.0 %** |
   | +1.0 | +0.40 °/s | **0.01** | **0.0 %** |
   | −0.2 | −0.02 °/s | 0.00 | 0.0 % |
   | −0.5 (×3) | −20.3 / −21.2 / −21.9 °/s | 0.71–0.76 | 52–58 % |
   | −1.0 (×2) | −43.3 / −45.5 °/s | 0.76–0.79 | 58–60 % |
   | −0.3 with `vx` 0.3 | −16.9 °/s | **0.98** | 72.6 % |

   `send_commands_keyboard.py` publishes `-yaw_vel`, so a **positive** `wz` on the wire is a
   **left** turn. The G1 turns right reproducibly at a consistent 0.71–0.79 gain and does not
   respond to a left-turn command at all — it does not even step. There is also a deadband:
   `−0.2` alone did nothing while `−0.3` *combined with* forward motion tracked at 0.98.

   Undiagnosed. Candidates not yet tested: a property of the shipped `policy.onnx`; a sign error
   on the yaw element of the command vector; an artefact of the command being rebuilt each step.
   The obvious next probe is to feed the policy a constant left-yaw observation directly,
   bypassing DDS, and check whether the action vector moves at all.

   ⚠ **Do not read the earlier yaw numbers in this file's history as evidence.** The first yaw
   measurement attributed log windows to phases by counting steps from when the test script
   started, and concluded the exact opposite (positive works, negative dead). Real-time factor is
   not exactly 1.0, so that mapping drifts. `0004` now logs the command the policy actually saw on
   every line, which is what settled it.

   The original diagnosis — the sim stepping at 5–13 Hz against a policy trained for 100 Hz — was
   **not a cause at all**, and this is worth understanding before picking the step up. `decimation 4`
   × `sim.dt 0.005` pins the policy at 50 Hz of *simulated* time whatever the host does; the slow
   number was real-time factor (0.28), which starves a wall-clock caller such as
   `isaac_loco_bridge.py` but tells the policy nothing. TASK-204 fixed that (RTF 0.28 → 1.04, and
   worth having for exactly this step, since Agent Mode drives the bridge on wall clock).
   ~~and the robot still does not walk: it does not even stand, with no velocity command sent.
   The actual blocker is [[TASK-223]].~~ **Both halves of that are now retired**: [[TASK-223]]
   found the standing failure was a missing ground plane — the robot was falling through the
   floor — and this step found the walking failure was the 20 Hz publish rate above.
   Candidate causes tested there are recorded with their negative results
   so they are not re-run — and note that the two "different control rate" retests were dynamically
   the same experiment, so they are not among the useful negatives.
3. ~~The `sport` RPC facade answers `SetVelocity`~~ — **done 2026-08-08.** `isaac_loco_check.py`
   passes 7/7 (six velocity cases including lateral and yaw, plus command expiry) driving an
   unmodified `LocoClient` with no bridge code imported. Run `isaac_loco_bridge.py --domain 1`
   first, then `isaac_loco_check.py --domain 1`. ~~Note this proves the **wire**, not the gait —
   the second half of the original step ("and the robot walks in response") is gated on step 2.~~

   **Second half closed 2026-08-28, once step 2 landed.** An unmodified `LocoClient` — the same
   API Agent Mode drives — held `SetVelocity(0.5, 0, 0)` for 25 s through the bridge and the G1
   **walked 16.36 m at 0.613 m/s**: 67.5 % single support, 32.5 % double support, 0 % flight
   phase, foot cadence 2.00 / 1.99 Hz. The whole path from `LocoClient` to the floor is proven
   now, not just to the wire. The 7/7 wire check was re-run after the rate change below and
   still passes.

   Two differences from the raw-DDS measurement, both expected: the bridge commands height 0.75
   rather than 0.8, giving a lower stance, a faster cadence (2.00 vs 1.73 Hz) and a higher speed
   (0.613 vs 0.570 m/s). The rightward heading drift is present on this path too (−2.2 °/s).

   ⚠ **`isaac_loco_bridge.py --rate` default raised 50 -> 100 Hz** as part of this. 50 Hz is
   exactly the sim's policy rate, and because the sim clears its command slot on every read
   (see step 2) that leaves zero margin: any jitter drops a step's command to zero. The vendor
   publishes at 100 Hz for 2x margin and so do we now.
4. Agent Mode `walk` / `turn` / `goto` blocks drive it end to end with no Agent Mode code changes.
   **Defect (b) DIAGNOSED and MITIGATED 2026-08-28; the blocks themselves are still not driven.**

   **(b) is trained asymmetry in `policy.onnx`, not a bug on our side of the wire.** The command
   path was traced end to end and is symmetric everywhere — read from shared memory, float cast,
   tensor, `* obs_scales["commands"]` (1.0), index 8 of a 91-wide frame, 10-deep history, a
   symmetric ±100 clip, ONNX. No `abs()`, no one-sided clamp, no unsigned cast. And that is not
   just a code reading: `NEODEM_LOG_POLICY_CMD=1` (patch 0006) prints the yaw command as it sits
   in the tensor handed to `policy.onnx`, and it shows

       raw_cmd_wz=+1.0000 obs_wz(10 frames)=[1.0, 1.0, ... 1.0]
       raw_cmd_wz=-1.0000 obs_wz(10 frames)=[-1.0, -1.0, ... -1.0]

   with near-equal exposure (132 vs 134 samples). **The positive command reaches the policy
   intact, in all ten history frames, and the policy ignores it.** There is no fix available in
   this repo; a symmetric turn needs a retrained or replaced checkpoint.

   **The arc mitigation works, and that is what unblocks `goto`.** Measured on one boot, paired
   and sign-alternating (`isaac_yaw_sweep.py`):

   | commanded wz | in place (vx=0) | in an arc (vx=0.3) |
   |---|---|---|
   | +0.3 / +0.5 | ratio **0.01** | ratio **0.55** |
   | +0.6 / +1.0 | ratio **0.01** | ratio **0.60** |
   | −0.3 / −0.5 | ratio 0.26 | ratio 1.15 |
   | −0.6 / −1.0 | ratio 0.53 | ratio 1.02 |

   So a left turn is not impossible — it is dead only for *pure in-place rotation*, and recovers
   to 55–60% of commanded as soon as any forward velocity is present. `goto` is therefore
   satisfiable in both directions by resolving `turn` into a forward-and-turn arc. It remains a
   product decision whether a left turn that needs forward clearance is acceptable, and whether
   Agent Mode should refuse an in-place left turn rather than silently not perform one.

   **Defect (a) is sharper than recorded: the rightward drift is coupled to forward motion.**
   With `vx=0` and `wz=0` the heading drift is **−0.00 °/s over 787 samples**; with `vx=0.3` and
   `wz=0` it is **−5.40 °/s over 862 samples**. It is not a static bias. Same sign as the weak
   left turn, so (a) and (b) are plausibly one rightward bias in the checkpoint rather than two
   defects.

   ⚠ **Still to do for this step:** the above drives the sim over DDS, which is the layer Agent
   Mode's blocks sit on top of, but the `walk` / `turn` / `goto` blocks themselves have not been
   run end to end. That is what remains before step 4 can be ticked.
   ⚠ Whatever drives this must publish velocity commands at **>= 50 Hz, and 100 Hz to match the
   vendor** — see the self-clearing command slot under step 2. `isaac_loco_bridge.py` republishes
   onto `rt/run_command/cmd`; it was written before the self-clearing behaviour was understood,
   and was checked and raised to 100 Hz under step 3 above. Anything else that publishes a
   velocity command still needs the same check.
5. ~~Head-camera frames show gait-induced bob absent from the kinematic base~~ — **DONE
   2026-08-28.** Measured rather than eyeballed, because a few mm of bob is not something video
   settles.

   | run | head bob | at |
   |---|---|---|
   | walking, real policy (`vx=0.5`, 35.8 s @ 25 Hz) | **7.8 mm p-p** | **1.73 Hz** |
   | standing, same robot + instrumentation | 1.3 mm p-p | 0.52 Hz (a settling transient) |
   | kinematic glide, `isaac_capture.py` take_v10, 30 294 frames | **0.0 mm** | — |

   The walking figure lands at **1.73 Hz**, which is the foot cadence measured independently from
   the scene's ContactSensor in step 2 (1.69 / 1.73 Hz). Two unrelated signals — head height and
   foot contact — agreeing on the step frequency is the actual result.

   The glide control is exact, not approximate: across all 30 294 frames of a real capture the
   head's z took **one distinct value** (1.271 m) while the base moved in xy, because
   `isaac_capture.py:1105` computes `head_z = HEAD_OFFSET_Z + (height - NEUTRAL_STAND_HEIGHT)` —
   a closed-form function of a constant, with no gait term to carry.

   Tools: `isaac_bob_report.py` (with a 26-check `--selftest` needing no GPU) and the `head_z=` /
   `base_z=` fields added by patch 0006.

   ⚠ **The head camera's own pose is NOT usable for this.** `front_camera.data.pos_w` was tried
   first and is STATIC under this provider's hand-rolled stepping: over a whole run it reported
   exactly one distinct value while the base moved through 62. It would have reported "no bob"
   for the walking case too — a silent false negative on the very claim this step tests. Patch
   0006 reads the `d435_link` rigid body instead, whose pose comes from the same articulation
   buffer as `base_z`.
