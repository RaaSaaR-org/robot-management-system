---
id: TASK-223
aliases:
- TASK-223
title: The G1 wholebody policy cannot stand, independently of the control rate
slug: g1-wholebody-policy-cannot-stand
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- g1
- sim
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-27
updated: 2026-08-27
status_note: 'Found while verifying TASK-204. The rate fix worked (14 -> 52-61 Hz) and
  the gait still does not appear: the robot tumbles continuously even with NO velocity
  command. Second, independent fault. This, not the rate, is now the blocker on TASK-203.'
---


# The G1 wholebody policy cannot stand, independently of the control rate

## Description

`Isaac-Move-Cylinder-G129-Dex3-Wholebody` never produces a gait, and TASK-204 assumed the cause was
the ~14 Hz control rate starving a policy designed for ~100 Hz. TASK-204 fixed the rate — 52 Hz at
`--camera_write_interval 10`, 61 Hz at 100 — and **the robot still tumbles**. The remaining fault is
not rate-related.

The decisive observation: with **no velocity command sent at all** (the provider self-defaults to
`[0, 0, 0, 0.8]`, i.e. stand in place), the base tumbles continuously for the full 20 s of
observation. This is not a walking failure. It cannot stand.

## Details

### Evidence (2026-08-27, at 61 Hz, `--device cpu`)

`rt/lowstate` on DDS domain 1, sampled at 92.8 Hz, 1853 samples over 20 s, no command published:

* IMU quaternion **norm is exactly 1.0000** throughout — the data is valid, this is not an attitude
  math artefact — and it is nowhere near identity at any sample. It sweeps the full orientation
  sphere continuously.
* `imu_state.rpy` is **all zeros** in every sample. The sim does not populate it; derive roll/pitch
  from `imu_state.quaternion` (w, x, y, z), which is correct.
* Under a forward command (`vx = 0.5`), leg joints spend a large fraction of the run pinned at their
  limits:

  | joint | min | max | % at limit |
  |---|---|---|---|
  | L_ank_pitch | -0.873 | 0.524 | 38.6 % |
  | L_ank_roll | -0.262 | 0.262 | 46.5 % |
  | R_ank_pitch | -0.873 | 0.524 | 46.6 % |
  | R_ank_roll | -0.262 | 0.262 | 47.2 % |
  | L_knee | -0.087 | 2.880 | 1.9 % (but full-range swings) |

* Knee cadence is ~3.4 Hz with L/R correlation **-0.381** (antiphase). The legs *are* alternating —
  so the policy is producing structured, rhythmic output, not noise. It is thrashing in a plausible
  gait rhythm while the body is on the ground.

### What has already been ruled out

* **Control rate** — fixed in TASK-204, retested at both 52 Hz and 61 Hz. No improvement; the 61 Hz
  run was, if anything, worse (more time pinned).
* **Stale observation buffers** — `compute_current_observations` re-reads `root_ang_vel_b`,
  `projected_gravity_b`, `joint_pos` and `joint_vel` from the scene on every call. The copies cached
  in `__init__` are shadowed, not used.
* **Observation width** — the 91-dim frame is internally consistent and matches the ONNX input:
  3 (`ang_vel`) + 3 (`projected_gravity`) + 4 (`command`) + 26 (`joint_pos`, 12 leg + 14 arm)
  + 26 (`joint_vel`) + 29 (last action) = 91, × 10 history frames = the policy's `obs [1, 910]`.
* **Silent action-shape failure** — the NeoDEM patch for that is applied (see
  `robot-agent/hardware/isaac_sim_patches/`); the log shows no "Get DDS action failed".
* **Policy load** — `assets/model/policy.onnx` loads, takes `obs [1, 910]`, returns
  `actions [1, 12]` (legs only). A second `assets/model/policy1.onnx` has an identical signature and
  has **not** been tried.

### Where to look next, in order

1. **Try `--model_path assets/model/policy1.onnx`.** Two policies ship with identical signatures and
   nothing documents which belongs to this task. Cheapest possible discriminator, untried.
2. **Check joint ordering between the observation and the policy's training order.** `all_obs_indices`
   is `action_to_indices + arm_to_all_indices`, i.e. whatever order the *scene* reports, which need
   not be the order the policy was trained on. A permuted `joint_pos` block yields exactly this
   symptom: structured, rhythmic, confidently wrong output. Compare against the joint order in
   `robot-agent/src/robot/joint-configs/g1.config.ts` (legs 0-11, verified: knee limit 2.8798,
   ankle-pitch 0.5236 — both match the observed pinning values exactly).
3. **Check `obs_scales`.** Every entry is `1.0`. Unitree's locomotion policies are normally trained
   with `ang_vel` ~0.25 and `joint_vel` ~0.05. If this policy expects scaled inputs, unscaled ones
   would saturate it — consistent with joints driven to limits.
4. **Check the `action_scale = 0.25` and the default-position offset** in the action path, and the
   `DelayBuffer(5, ...)` — a 5-step action delay at 61 Hz is 82 ms of latency inside the loop.
5. **Confirm the robot starts upright.** The probe attached after the sim was already running, so it
   never observed the post-reset state. Sample `rt/lowstate` from the first frame.

### Reproducing

`robot-agent/hardware/isaac_sim_patches/README.md` has the container invocation. Then, from the host
in the `unitree_sim_env6` env with `CYCLONEDDS_HOME` set, subscribe `rt/lowstate` on domain 1 and
publish `String_(data=str([vx, vy, wz, height]))` on `rt/run_command/cmd`.

⚠ After killing an Isaac container, **wait for `nvidia-smi` to return to ~111 MiB before relaunching**.
A hard kill leaves ~23 GB held for tens of seconds, and a sim started into that hangs at 0 % CPU with
a 3-line log and no error — it looks like a startup failure, not GPU contention.

## Test Strategy

Same probe as above. The bar is the one TASK-204 step 3 set and could not reach:

1. With no velocity command, the base stays upright — `|roll|` and `|pitch|` derived from the IMU
   quaternion both stay under 0.5 rad for 30 s.
2. Under `vx = 0.5`, feet make and break contact, the base translates, and no leg joint spends more
   than ~5 % of the run within 0.02 rad of a limit.
3. Then re-run `isaac_loco_check.py --domain 1` (TASK-204 step 4) and close TASK-203 step 2.
