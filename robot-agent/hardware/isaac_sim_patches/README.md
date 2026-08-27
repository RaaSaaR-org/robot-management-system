# isaac_sim_patches — NeoDEM's changes to `unitree_sim_isaaclab`

Unitree's Isaac Lab sim (`unitree_sim_isaaclab`) is a **third-party checkout**,
not a submodule and not vendored here. Three NeoDEM changes are needed before
the G1 wholebody DDS task runs at a usable control rate — and, before two of
them, it does not move at all. They live here as a patch so a fresh checkout
can be brought to a working state without rediscovering them.

## Applying

```bash
cd "$UNITREE_ROOT/unitree_sim_isaaclab"
git checkout e30c25b                       # the pinned upstream commit
git apply /path/to/robot-management-system/robot-agent/hardware/isaac_sim_patches/0001-neodem-g1-wholebody-sim.patch
```

| | |
|---|---|
| Upstream | `https://github.com/unitreerobotics/unitree_sim_isaaclab` |
| Pinned commit | `e30c25b` (detached HEAD) |
| Isaac Sim / Lab | 6.0.1 / 6.1.14, conda env `unitree_sim_env6` |
| Files touched | `action_provider/action_provider_wh_dds.py`, `tasks/common_observations/camera_state.py` |

`git apply` against a different upstream commit may reject. The three hunks are
independent and small enough to re-apply by hand from the symptoms below.

## ⚠ The checkout carries an uncommitted Isaac Lab 3.0 port that is NOT in these patches

As of 2026-08-28, `git -C "$UNITREE_ROOT/unitree_sim_isaaclab" status --porcelain` reports
**30 modified files**, not the two this file lists. The other ~27 are an Isaac Sim 6.0.1 /
Isaac Lab 3.0 migration (`sim.physx` -> `sim.physics`, `ProxyArray.torch` on the
`common_observations/*_state.py` reads, the `InitialStateCfg.rot` quaternion reorder in
`tasks/common_config/robot_configs.py`), written up in
`/home/humanoid/Dokumente/Unitree/g1_quest_teleop/docs/STATUS.md` under R19.

**A fresh checkout brought to `e30c25b` + `0001` will therefore NOT run**, and any result
reproduced from TASK-204 / TASK-223 was obtained against the working tree, not against this
patch set. Capturing that port here is unfinished work.

## `0002-task223-obs-scales-and-step0-probe.patch` (TASK-223)

Applies on top of `0001` and of the port above; dry-run-verified against both the current
working tree and pristine `e30c25b`. Three hunks, all in service of one sim boot:

1. `action_provider_wh_dds.py` — `obs_scales`. Upstream ships all `1.0` (line 276-277) and
   `assets/model/policy.onnx` has no normalisation layer of its own (7 nodes: `Gemm`/`Elu` x3 +
   `Gemm`, no metadata), so those six numbers are the only normalisation the policy ever sees.
   Defaults to Unitree's locomotion values (`ang_vel` 0.25, `joint_vel` 0.05);
   `NEODEM_OBS_SCALES=upstream` restores the shipped behaviour without a re-patch, so both arms
   of the experiment run from one build.
2. `action_provider_wh_dds.py` — `_task223_log`. Prints, from inside the sim,
   `projected_gravity_b` (a convention-free uprightness test), root height, true roll/pitch from
   `root_quat_w` read as `(x,y,z,w)`, leg angles vs defaults, and — once, at step 0, before the
   first action is applied — the full articulation joint-name order.
3. `tasks/common_observations/g1_29dof_state.py:370` —
   `ensure_quat_w_first(quat, assume_w_first=True)` -> `False`. **Symptom without it:** a
   perfectly upright, motionless base publishes `|roll| = pi` on `rt/lowstate`, so every
   "is it standing?" check fails unconditionally; the accelerometer and gyroscope on the same
   topic are rotated by a garbage matrix as well. Upstream's `True` was correct on Isaac Lab
   2.x, where the quaternion was `(w,x,y,z)`; Isaac Lab 3.0 returns `(x,y,z,w)`.

⚠ Even with hunk 3, this sim puts `imu_state.quaternion` on the wire as **(x, y, z, w)**
(`dds/g1_robot_dds.py:101`, the vendor's own `#[x,y,z,w]` comment), which is not the real
robot's order. `isaac_gait_probe.py --quat-order` selects the reading; there is no way to detect
it from the data, because every permutation of a unit quaternion is still a unit quaternion.

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
