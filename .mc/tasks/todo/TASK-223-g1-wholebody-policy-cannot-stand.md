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
updated: 2026-08-28
status_note: 'Found while verifying TASK-204. The rate fix worked (14 -> 52-61 Hz) and
  the gait still does not appear: the robot tumbles continuously even with NO velocity
  command. Second, independent fault. This, not the rate, is now the blocker on TASK-203.'
---


# The G1 wholebody policy cannot stand, independently of the control rate

## Description

`Isaac-Move-Cylinder-G129-Dex3-Wholebody` never produces a gait. TASK-204 assumed the cause was a
~14 Hz control rate starving a policy designed for ~100 Hz, fixed it, and **the robot still
tumbles**.

⚠ **The control rate was never a candidate cause, and the two "retests" that appeared to rule it out
were the same experiment run twice.** `decimation = 4` × `sim.dt = 0.005` pins the policy at **50 Hz
of simulated time** regardless of how fast the host loop turns; what TASK-204 changed was real-time
factor, 0.28 → 1.04. Rate is excluded here on first principles, not by two null results — which
means the null results carry no information and must not be cited as evidence about anything else.
See TASK-204's corrected Description.

The decisive observation: with **no velocity command sent at all** (the provider self-defaults to
`[0, 0, 0, 0.8]`, i.e. stand in place), the base tumbles continuously for the full 20 s of
observation. This is not a walking failure. It cannot stand.

## Details

### Evidence (2026-08-27, at RTF 1.22, `--device cpu`)

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

* L/R knee correlation is **-0.381** (antiphase) over 1853 samples. **This is the load-bearing
  number, and it does establish structure:** two independent noise signals of that length give
  |corr| ≤ 0.09 across 2000 simulated trials (median 0.016), so -0.381 is nowhere near what
  uncorrelated thrashing produces. The policy is emitting output whose two legs are coupled.
* Knee cadence "~3.4 Hz" **does not add to that**, and was measured with a tool that overstates it.
  The original `crossings()` counted every sign change about the mean with no deadband, and pure
  Gaussian noise scores 24.8 Hz on that statistic — a high cadence is not evidence of rhythm. The
  probe now uses a 10 %-of-range deadband (clean and jittered 2 Hz sines both read 1.95 Hz; noise
  still reads high but is no longer confusable with a real gait). **Re-measure the cadence with the
  fixed probe before quoting it.**
* Net: "structured, rhythmic, confidently-wrong output rather than noise" survives — on the
  correlation, not the cadence.

### What has already been ruled out

* **Control rate** — excluded structurally, not experimentally. The policy sees a fixed 50 Hz of
  simulated time (`decimation 4 × sim.dt 0.005`) at every wall-clock speed, so it was never a free
  variable. The "52 Hz vs 61 Hz" retests were dynamically the same run twice.
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

### Hypotheses already TESTED AND REFUTED (2026-08-27)

Do not re-run these. Each cost a sim boot (~4 min); the negative results are the point.

1. **Control rate — EXCLUDED ON FIRST PRINCIPLES (stronger than refuted).** The policy advances
   0.02 s of simulated time per step at any host speed, so no wall-clock change can alter the
   dynamics. Do not spend another sim boot varying `--camera_write_interval` and reading the gait;
   the answer is knowable without running it. (The two runs that were done fell at both, as they
   had to.)
2. **`height` command out of range — REFUTED, and the opposite of what it looked like.** The provider
   defaults the 4th command element to `0.8` while upstream's own `send_commands_keyboard.py` clamps
   `height` to `(-0.5, 0.0)`, which looked like an obvious out-of-distribution input. Tested
   `height=0.0`: it falls **faster** (1.4 s vs ~5 s). `0.8` is almost certainly the correct
   *absolute* standing height — the G1 stands ~0.79 m — and the keyboard range is a delta applied
   elsewhere. The provider default is fine.
3. **Wrong `policy.onnx` — REFUTED as a fix.** `policy.onnx` and `policy1.onnx` are genuinely
   different files (same size, different md5) with identical signatures. `policy1.onnx` also falls.
   It did survive ~4-5 s versus ~1.4 s, so if anything it is the better of the two, but neither
   stands.
4. **Joint ordering between observation and policy — REFUTED by reading.** `action_to_indices` and
   `arm_to_all_indices` are built by **name** lookup against a hardcoded name list, not by scene
   order, so the observation column order is stable across Isaac Lab versions. Good upstream design;
   this cannot drift.
5. **Actuator gains — REFUTED.** The wholebody config's leg gains are the standard Unitree
   locomotion values (hip 150-200, knee 200, ankle 20 stiffness; damping 5/2).
6. **Leg default pose — REFUTED.** `get_leg_joints()` returns all zeros, but the wholebody preset
   sets `update_default_joint_pos=False` and uses `G129_CFG_WITH_DEX3_WHOLEBODY`'s own init pose,
   which is the correct crouch: hip_pitch -0.20, knee 0.42, ankle_pitch -0.23.

### The strongest mechanism, but blocked: the arms are commanded to zero

`get_action` calls `full_action.zero_()`, then fills **only** the legs (policy) and the waist
(defaults). The 14 arm joints and 14 hand joints are filled **only if a DDS command arrives** —
`self.robot_dds.get_robot_command()` from `rt/lowcmd`. With nothing publishing, they stay `0.0` and
that zero is sent as a joint **position target** every step.

That is not the default pose. `G129_CFG_WITH_DEX3_WHOLEBODY` defines
`elbow 0.87`, `shoulder_pitch 0.35`, `shoulder_roll +/-0.18`. So with no teleop client the arms are
driven from a bent pose to fully extended — shifting the CoM — **and** the observation carries a
large constant `joint_pos - default` bias on the arm block that the policy never saw in training.
Upstream always runs an arm/teleop publisher, so they would never hit this.

**Status: INCONCLUSIVE, not refuted.** An attempt to hold the arms by publishing `LowCmd_` on
`rt/lowcmd` did not take effect — the elbows still read ~0.0 in `rt/lowstate` throughout — so the
condition was never actually changed and the test proved nothing. Before retrying, work out why the
provider ignored that `LowCmd_`: check `mode`/`mode_machine`, whether a CRC is required, and whether
`get_robot_command()` needs >= 29 `motor_cmd` entries (the publisher used
`unitree_hg_msg_dds__LowCmd_()` defaults and set `q`, `kp`, `kd`, `mode` on the first 29).

### Remaining leads, in the order worth spending a sim boot on

Reordered 2026-08-28. Rate is now excluded structurally rather than by experiment, so the leads that
were ranked below it move up, and the one that was ranked on a fabricated number moves to last.

1. **`obs_scales` are all `1.0`.** Unitree locomotion policies normally train with `ang_vel ≈ 0.25`
   and `joint_vel ≈ 0.05`; feeding raw values in place of scaled ones is precisely the shape of
   fault that yields structured, confidently-wrong output — the policy is reading a correctly
   ordered observation in the wrong units. Counter-argument, and it is a real one: this is
   **upstream's own code**, so upstream presumably ran it this way successfully. Worth one boot
   because it is a one-line change and the failure signature fits.
2. **The arms are commanded to zero** (below) — still the single strongest mechanism, but blocked
   on a bench question, so it cannot be the *next* boot.
3. **The robot never holds its init crouch.** The first `rt/lowstate` frame already shows knee
   ~0.08-0.13 against a configured 0.42, so the policy is in control and has already moved the legs
   before the first frame is published. Whether it is upright at physics step 0 is still unobserved
   from outside; logging from inside the sim would settle it — and it is free, no extra boot.
4. **`DelayBuffer(5, ...)`** — 5 control steps of action delay. ⚠ An earlier version of this file
   said "82 ms of latency at 61 Hz". **That quantity does not exist**: the delay is 5 × 0.02 s =
   **100 ms of simulated time, invariant to wall clock**, and cannot be tuned by making the host
   loop faster. Lowest priority — it is upstream's own value and a policy trained with the same
   buffer would expect it.

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
   quaternion both stay under 0.5 rad for 30 s. Use `isaac_gait_probe.py --no-command`, which
   publishes nothing at all. ⚠ `--vx 0` is **not** this test: it still publishes
   `[0, 0, 0, height]`, exercising the command path. The 2026-08-27 run used `--vx 0` and so tested
   a zero command, not the absence of one.
2. Under `vx = 0.5`, the base translates and no leg joint spends more than ~5 % of the run within
   0.02 rad of a limit. **Foot contact cannot be checked with this probe** — `unitree_hg`'s
   `LowState_` has no `foot_force` field, so the "antiphase" line is a knee-deviation correlation
   and a robot thrashing on its side scores the same as one walking. Read it only alongside the
   upright line, or instrument `scene.contact_forces` from inside the sim.
3. Then re-run `isaac_loco_check.py --domain 1` (TASK-204 step 4) and close TASK-203 step 2.
