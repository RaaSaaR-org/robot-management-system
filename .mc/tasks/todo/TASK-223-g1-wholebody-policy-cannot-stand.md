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
status_note: '2026-08-28: the attitude evidence was measured through a scrambled IMU
  quaternion -- two composed convention flips under which a perfectly upright base reads
  |roll| = pi, so the "base upright" check could never pass for any robot. Both halves are
  now fixed (isaac_sim_patches/0002 + isaac_gait_probe.py --quat-order) at no boot cost.
  "It tumbles" is downgraded to unverified; the pinned leg joints remain real. Lead 4
  (DelayBuffer) closed by reading -- the applied lag is zero, not 5 steps. The obs_scales
  lead survives with new checkpoint evidence and is the next boot, with leads 2 and 3
  folded into the same boot. Still the blocker on TASK-203.'
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

~~The decisive observation: with **no velocity command sent at all** (the provider self-defaults to
`[0, 0, 0, 0.8]`, i.e. stand in place), the base tumbles continuously for the full 20 s of
observation. This is not a walking failure. It cannot stand.~~

⚠ **WITHDRAWN 2026-08-28.** That observation was read through a scrambled IMU quaternion under
which a perfectly upright base reports `|roll| = pi` — see the first section of Details. The
run also used `--vx 0`, which publishes a zero command rather than none. What is still solidly
observed is that the leg joints spend ~40-47 % of a forward run pinned at their limits and that
the two knees are coupled at corr = -0.381. **Whether the base falls has never been measured.**

## Details

### ⚠ 2026-08-28, established by reading: the attitude evidence below is measured through a scrambled quaternion

**The `|roll|` / `|pitch|` numbers in this task, and the "base upright" verdict of
`isaac_gait_probe.py`, are not measurements of the robot's attitude.** Two permutations compose
on the path from the simulator to the probe, and under them a *perfectly upright, motionless*
base publishes `|roll| = pi`. The upright criterion therefore failed unconditionally — for any
robot, under every hypothesis tested so far. Verified numerically over four attitudes.

The chain, file:line, all in the read-only checkout at
`third_party/checkouts/unitree_sim_isaaclab`:

1. `tasks/common_observations/g1_29dof_state.py:325-341` reads
   `data.body_link_pose_w[:, imu_idx, 3:7]`. On Isaac Lab 3.0 that is **(x, y, z, w)** — the
   underlying warp dtype is `wp.quatf`
   (`IsaacLab30/source/isaaclab/isaaclab/assets/rigid_object/base_rigid_object_data.py:413`,
   *"dtype = wp.quatf"*), and
   `IsaacLab30/source/isaaclab/isaaclab/utils/warp/proxy_array.py:130-134` documents the
   2.x `(w,x,y,z)` -> 3.x `(x,y,z,w)` flip in as many words. Our own
   `robot-agent/hardware/isaac_capture.py:35` already says *"Isaac Lab 3.0 quaternions are
   XYZW"*, and `tasks/common_config/robot_configs.py:230-239` carries a NeoDEM comment
   fixing exactly this flip for `InitialStateCfg.rot`.
2. `g1_29dof_state.py:370` then calls `ensure_quat_w_first(quat, assume_w_first=True)` — a
   pass-through that *relabels* those four floats as `(w, x, y, z)`. Correct on Isaac Lab 2.x,
   wrong on this stack. It also feeds `quat_to_rot_matrix` at line 373, so the
   **accelerometer and gyroscope** written to `rt/lowstate` are rotated by a garbage matrix too.
3. `dds/g1_robot_dds.py:101` writes `imu_state.quaternion[:] = imu_array[[4, 5, 6, 3]]`, with
   the comment `#[x,y,z,w]` — i.e. this sim deliberately puts **(x, y, z, w)** on the wire,
   which is *not* the real robot's `(w, x, y, z)` even when step 2 is correct.
4. `robot-agent/hardware/isaac_gait_probe.py:56` (as it stood) read the field as
   `w, x, y, z = msg.imu_state.quaternion`.

Net permutation: the probe's `w` is the true `y`, its `x` the true `z`, its `y` the true `w`,
its `z` the true `x`. Upright, yaw 0 -> reported `roll = pi`, `pitch = 0`. Upright at the sim's
actual init yaw of 90 deg (`robot_configs.py:309-310`, `init_rot=(0.7071,0,0,0.7071)`) -> the
same `roll = pi`.

**This is why "the IMU quaternion norm is exactly 1.0000, so the data is valid" was false
reassurance:** every permutation of a unit quaternion is still a unit quaternion. The norm check
cannot see an ordering fault, and this is the third time on this task that a plausible-looking
number turned out to carry no information.

What survives from the old evidence, because it does not pass through the quaternion: the leg
joints pinned at their limits, and the L/R knee correlation of -0.381. Something is genuinely
wrong. But **"it cannot stand" is not yet an observation** — no run so far has measured attitude.

Both halves are now fixed, and neither costs a boot:
* `robot-agent/hardware/isaac_sim_patches/0002-task223-obs-scales-and-step0-probe.patch`
  hunk 3 sets `assume_w_first=False`, restoring the vendor's own contract.
* `isaac_gait_probe.py` gained `--quat-order {xyzw,wxyz,scrambled}`, default `xyzw`.
  `--quat-order scrambled` recovers the true roll/pitch from an **unpatched** sim, so the
  measurement fix does not depend on the sim patch at all.

### Evidence (2026-08-27, at RTF 1.22, `--device cpu`)

`rt/lowstate` on DDS domain 1, sampled at 92.8 Hz, 1853 samples over 20 s, no command published:

* IMU quaternion **norm is exactly 1.0000** throughout — ⚠ **this does not mean the data is
  valid.** A permuted unit quaternion is still a unit quaternion, and the elements were in fact
  permuted. "Nowhere near identity at any sample" is exactly what the permutation predicts for a
  robot standing perfectly still.
* `imu_state.rpy` is **all zeros** in every sample. The sim does not populate it; roll/pitch were
  derived from `imu_state.quaternion` read as `(w, x, y, z)` — ⚠ **which is wrong for this sim.**
  See the section above; use `isaac_gait_probe.py --quat-order`.
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

### 2026-08-28, established by reading: the observation path, quoted

All line numbers are in the read-only checkout
(`.../third_party/checkouts/unitree_sim_isaaclab`, `e30c25b` **plus an uncommitted Isaac Lab 3.0
port living only in the working tree** — see the warning at the end of this section).

* **`obs_scales` really are all `1.0`.** `action_provider/action_provider_wh_dds.py:276-277`, and
  they are the only scaling anywhere: `grep -rn 'obs_scale\|ang_vel_scale\|dof_vel_scale'` over
  the whole checkout returns those two lines plus the six uses at lines 353-358. There is no
  second normalisation elsewhere.
* **The policy carries no normalisation of its own.** `assets/model/policy.onnx` is 7 nodes —
  `Gemm, Elu, Gemm, Elu, Gemm, Elu, Gemm` — a plain 910→512→256→128→12 MLP. No `Sub`/`Div`/
  `Mul`, no `metadata_props`, empty `doc_string`, producer `pytorch 2.5.1`, opset 11.
  `policy1.onnx` is byte-for-byte the same architecture and equally bare. **So `obs_scales` is
  the only normalisation the policy will ever see** — whatever it was trained with has to be
  applied at lines 353-358 or nowhere.
* **Nothing in the checkout records the training-time normalisation.** No env cfg, no yaml, no
  json, no sidecar, no README mentions it; `assets/model/` contains the two `.onnx` files and
  nothing else. The `config.yaml` files under `assets/robots/*/` are Omniverse asset-collection
  manifests, not RL configs.
* **The 91-dim frame** is assembled at `action_provider_wh_dds.py:351-361`:
  `ang_vel(3) | projected_gravity(3) | command(4) | joint_pos-default(26) | joint_vel-default(26)
  | last_action(29)`. `joint_pos`/`joint_vel` use `all_obs_indices = action_to_indices +
  arm_to_all_indices` (line 268): 12 legs in `action_joint_names` order then 14 arms. The
  last-action block is 29-wide in `old_action_joints_names` order (lines 141-170).
* **The 10-frame history** is `CircularBuffer(max_len=10, batch_size=1)` at lines 282-284,
  appended at 367 and flattened at 368 with `buffer.reshape(1, -1)`. `CircularBuffer.buffer`
  returns **oldest first, newest last** — `IsaacLab30/.../utils/buffers/circular_buffer.py:78-86`,
  and identically in 2.2.0 (`IsaacLab/.../circular_buffer.py:79-86`), so the port did not flip it.
* **The checkpoint independently confirms that ordering.** Mean |w| of `actor.0.weight` per
  history frame, oldest→newest, is monotonically increasing:
  `0.152 0.150 0.149 0.150 0.153 0.157 0.164 0.173 0.189 0.224` (`policy.onnx`; `policy1.onnx`
  is the same shape). A policy that attended most to the *newest* frame is being fed the newest
  frame last, exactly as the code assembles it. History order is **not** a candidate fault.

### 2026-08-28: two claims in this file are wrong, and one is unverifiable as written

* ⚠ **Lead 4's premise is false. `DelayBuffer(5, ...)` applies zero delay here.**
  `DelayBuffer.__init__` only *sizes* the ring at `history_length + 1`; the lag actually used is
  `self._time_lags`, which is initialised to **zeros** and only changed by `set_time_lag`
  (`IsaacLab30/.../utils/buffers/delay_buffer.py:48-54, 107-150, 160-178`).
  `grep -rn 'set_time_lag' <checkout>` returns **nothing**. `compute()` therefore returns the
  entry just appended. There is no 100 ms, and there was never an 82 ms. Lead 4 is **closed**,
  by reading, at no cost.
* ⚠ **The "leg joints pinned at their limits" table was read from a `--vx 0.5` run whose
  attitude channel was scrambled** (see the section above). The pinning is real; the
  accompanying "and it is tumbling" is not established.
* ⚠ **`get_action` indexes a 29-wide tensor with 43-wide indices, and whether that is a bug is
  not decidable by reading.** Line 396 builds `delayed_actions` of shape `[1, 29]` in
  `old_action_joints_names` order; line 397 then takes `delayed_actions[:, self.action_to_indices]`,
  but `action_to_indices` (line 246-251) are indices into the **43-joint articulation**. This is
  correct **iff** `all_joint_names[:29] == old_action_joints_names`, which is Isaac Lab's usual
  breadth-first G1 ordering and is almost certainly why upstream wrote that odd interleaved list
  — but it is a property of the USD, not of any file here. If it does not hold, the policy's 12
  leg actions are silently scattered to the wrong joints, which would produce *exactly* this
  failure signature. Patch `0002` prints `all_joint_names` once at step 0 so the next boot
  settles it for free.

### Remaining leads, in the order worth spending a sim boot on

Reordered 2026-08-28 after reading the observation path end to end.

1. **`obs_scales` are all `1.0`** — still first, and now with evidence from the checkpoint
   rather than only from the shape of the failure.

   *For:* the ONNX has no normalisation layer, so the scales here are the whole story. Grouping
   the columns of `actor.0.weight` by observation block gives rms weight-per-input within a
   factor of ~4 across all six blocks (`proj_grav` 14.2 largest, `joint_vel` 3.6 smallest) —
   i.e. the network was trained on inputs of *comparable magnitude in every block*. Raw
   `joint_vel` during locomotion is ~10-30x larger than raw `joint_pos - default`, so
   comparable-magnitude training inputs imply `joint_vel` was scaled down by roughly that
   factor, which is what `0.05` is. Feeding it raw makes the `joint_vel` block contribute ~78 %
   of the first-layer pre-activation variance and ~6.5x more than `joint_pos`; with `0.05`
   applied, `projected_gravity` dominates instead, which is what a balance policy should look
   like. Functionally (CPU onnxruntime, no GPU): perturbing only `joint_vel` by sigma = 2 rad/s
   raw moves `policy.onnx`'s output by 16.6, i.e. **4.2 rad of joint-target shift** — larger
   than any leg joint's entire range. The policy cannot have been trained against inputs to
   which it is that sensitive; it would not have converged.

   *Against, honestly:* it is still upstream's own code, and the argument above rests on
   assumed raw magnitudes (my sigma estimates, not measured ones) and on the premise that a
   converged policy has roughly block-uniform first-layer weights. Neither is proof. And note
   the scales are **irrelevant at the initial state**: with the robot at its default pose and at
   rest, `ang_vel` and `joint_vel` are zero, so the first observation is identical under both
   hypotheses. If the robot leaves the pose in the first few control steps, `obs_scales` cannot
   be the whole cause.

2. **The robot never holds its init crouch** — promoted from 3, because patch `0002` folds it
   into the *same* boot as lead 1 at zero extra cost. It logs `projected_gravity_b` (a
   convention-free uprightness test that no quaternion bug can reach: `(0, 0, -1)` upright, and
   its z is `cos(tilt)`), the root height, the true roll/pitch from `root_quat_w` read as
   `(x,y,z,w)`, the leg angles against their defaults, and the joint-name order — the first
   sample printed **before the first action is ever applied**.

   A scale-independent finding that bears directly on this: evaluated on CPU at the *exact*
   nominal standing observation (zeros everywhere, `projected_gravity = (0,0,-1)`,
   `command = (0,0,0,0.8)`, all 10 history frames identical, which is what `CircularBuffer`'s
   first push produces), **`policy.onnx` outputs `|a|max = 4.63`** — `x 0.25` action scale =
   **1.16 rad away from the default pose on some joint, at t = 0, from a perfectly nominal
   input**. `policy1.onnx` outputs `|a|max = 1.03` (0.26 rad), 4.5x smaller — which matches the
   already-observed "policy1 survives 4-5 s vs policy.onnx's 1.4 s". This is the same number
   under any `obs_scales`. Either `default_joint_pos` is not the pose these policies were
   trained around, or the `command` element is being misread. Worth watching in the step-0 log.

3. **The arms are commanded to zero** (below) — unchanged, still the strongest single
   mechanism, still blocked on the bench question of why the `LowCmd_` publish had no effect.

4. ~~**`DelayBuffer(5, ...)`**~~ — **CLOSED by reading**, see above. The delay is zero.

### ⚠ The checkout is not what this file and the patches README say it is

`git -C <checkout> status --porcelain` reports **30 modified files**, not the three that
`robot-agent/hardware/isaac_sim_patches/README.md` documents. The extra ~27 are an **uncommitted
Isaac Lab 3.0 port** (`sim.physx` -> `sim.physics`, `ProxyArray.torch`, the `InitialStateCfg.rot`
quaternion reorder) written up in
`/home/humanoid/Dokumente/Unitree/g1_quest_teleop/docs/STATUS.md` under R19, and **shared live
with another agent**. Consequences that matter here:

* The next boot runs the working tree, not `e30c25b` + `0001`. Anything reproduced from this
  task's history was also run against that tree.
* NeoDEM's own patch set does not carry the port, so `0001` alone will not reproduce any of it.
* STATUS.md's R19 correction records the *same* class of fault this task just hit — a
  quaternion convention flip laying the robot on its face — found by measurement after the port
  was declared "runtime-verified end to end". Treat every Isaac Lab 2.x-era convention in the
  vendor code as suspect until read.

### Reproducing

`robot-agent/hardware/isaac_sim_patches/README.md` has the container invocation. Then, from the host
in the `unitree_sim_env6` env with `CYCLONEDDS_HOME` set, subscribe `rt/lowstate` on domain 1 and
publish `String_(data=str([vx, vy, wz, height]))` on `rt/run_command/cmd`.

⚠ After killing an Isaac container, **wait for `nvidia-smi` to return to ~111 MiB before relaunching**.
A hard kill leaves ~23 GB held for tens of seconds, and a sim started into that hangs at 0 % CPU with
a 3-line log and no error — it looks like a startup failure, not GPU contention.

## The next sim boot: one boot, three answers (protocol, 2026-08-28)

Apply the patch first — it costs nothing and it is what makes the boot worth spending:

```bash
cd "$UNITREE_ROOT/unitree_sim_isaaclab"
git apply --check <repo>/robot-agent/hardware/isaac_sim_patches/0002-task223-obs-scales-and-step0-probe.patch
git apply         <repo>/robot-agent/hardware/isaac_sim_patches/0002-task223-obs-scales-and-step0-probe.patch
```

Verified by dry-run to apply cleanly both to the current working tree and to pristine `e30c25b`.
⚠ The checkout is shared with another agent — re-run `--check` immediately before applying.

Then the container invocation from `isaac_sim_patches/README.md`, unchanged except that the
`obs_scales` arm is selected by an env var rather than a re-patch. Test arm (Unitree scales) is
the default; add `-e NEODEM_OBS_SCALES=upstream` for the control arm.

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
  2>&1 | tee /tmp/task223-boot.log
```

⚠ Wait for `nvidia-smi` to return to its ~111 MiB baseline before launching, and run only one
`sim_main.py` at a time (its exit handler SIGKILLs every other match).

Confirm in the log before probing: `[TASK-223] obs_scales = {'ang_vel': 0.25, ..., 'joint_vel':
0.05, ...}`. If it says all `1.0`, the patch did not take and the boot is the control arm.

Probe, from the host in `unitree_sim_env6` with `CYCLONEDDS_HOME` set:

```bash
python robot-agent/hardware/isaac_gait_probe.py --domain 1 --no-command --secs 30
```

`--quat-order` now defaults to `xyzw`, which is correct **with `0002` applied**. If `0002` was
skipped or only its first two hunks landed, pass `--quat-order scrambled` instead — verified to
recover the same true roll/pitch from an unpatched sim.

### The three readings, and what each settles

**Reading 1 — the verdict.** `isaac_gait_probe.py --no-command --secs 30`, the "base upright"
line. **PASS = abs(roll) and abs(pitch) both under 0.5 rad for the full 30 s.** This is TASK-223
Test Strategy item 1, and this is the first run in which it is *measurable*.

**Reading 2 — free, and the tie-breaker.** The sim's own `[TASK-223] step=... proj_grav=(...)`
lines. Independent of every quaternion convention: upright means `proj_grav ~ (0, 0, -1)`, and
`pg_z` above -0.87 is a tilt beyond 0.5 rad. **If readings 1 and 2 disagree, believe 2** — the
DDS attitude path is then still wrong and needs another look before anything else is concluded.
Lead 2 is settled by the `step=0` line, printed before the first action is applied: is the robot
upright, at height ~0.80, with the legs at their configured crouch (hip_pitch -0.20, knee 0.42,
ankle_pitch -0.23), at physics step 0?

**Reading 3 — free, and it can invalidate everything else.** The one-off
`[TASK-223] all_joint_names` / `action_to_indices` / `old_action_indices` lines.
`old_action_indices == list(range(29))` and every `action_to_indices` entry `< 29` means line
397's indexing is sound. Anything else means the 12 leg actions are being scattered to the wrong
joints — and *that* is the bug, not `obs_scales`.

Reading 1 is the verdict on the `obs_scales` lead. Readings 2 and 3 come for free and are
informative under either outcome.

### If the lead fails — ranked next use of a boot

1. **Nothing, if reading 3 came back wrong.** A joint-order fault subsumes everything else and
   is fixed by reading, not by another boot.
2. **`policy1.onnx` under the corrected scales** (`--model_path assets/model/policy1.onnx`). It
   is already the better-behaved checkpoint — 4.5x smaller output at the nominal standing
   observation, and 4-5 s of survival against 1.4 s — and it has never been run with correct
   scales *or* a working attitude measurement. Cheapest remaining boot with a real prior.
3. **The arms** (lead 3), once the bench question is answered off-GPU: why did the `LowCmd_`
   publish leave the elbows at ~0.0? Check `mode`/`mode_machine`, whether `get_robot_command()`
   requires a valid CRC, and whether it needs ≥ 29 `motor_cmd` entries. That is a DDS question
   and needs no simulator — answer it *before* asking for a boot.
4. **`default_joint_pos` vs the policy's trained nominal pose.** `policy.onnx` emitting
   `|a| = 4.63` at an all-zero observation says the two disagree. A boot that sweeps the init
   crouch would test it, but only after 1-3 above.

## Test Strategy

Same probe as above. The bar is the one TASK-204 step 3 set and could not reach:

1. With no velocity command, the base stays upright — `|roll|` and `|pitch|` derived from the IMU
   quaternion both stay under 0.5 rad for 30 s. Use `isaac_gait_probe.py --no-command`, which
   publishes nothing at all. ⚠ `--vx 0` is **not** this test: it still publishes
   `[0, 0, 0, height]`, exercising the command path. The 2026-08-27 run used `--vx 0` and so tested
   a zero command, not the absence of one. ⚠ **And it must be read with the right
   `--quat-order`** — every run before 2026-08-28 measured this through a scrambled quaternion
   and could only ever report FAIL.
2. Under `vx = 0.5`, the base translates and no leg joint spends more than ~5 % of the run within
   0.02 rad of a limit. **Foot contact cannot be checked with this probe** — `unitree_hg`'s
   `LowState_` has no `foot_force` field, so the "antiphase" line is a knee-deviation correlation
   and a robot thrashing on its side scores the same as one walking. Read it only alongside the
   upright line, or instrument `scene.contact_forces` from inside the sim.
3. Then re-run `isaac_loco_check.py --domain 1` (TASK-204 step 4) and close TASK-203 step 2.
