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

**Symptom without it:** the wholebody task holds ~14 Hz against a policy that
wants ~100 Hz, and the gait degenerates.

## Measured effect of hunk 3

Per `get_action`, CUDA-synchronised, ~2000 samples per configuration, task
`Isaac-Move-Cylinder-G129-Dex3-Wholebody`, `num_envs=1`:

| Configuration | obs | loop | rate |
|---|---|---|---|
| Stock, `--device cuda` | 24.5 ms | 67.3 ms | 14.1 Hz |
| Stock, `--device cpu` | 39.0 ms | 55.4 ms | 17.5 Hz |
| Patched, `--camera_write_interval 2` | 21.6 ms | 34.4 ms | 29.9 Hz |
| Patched, `--camera_write_interval 6` | 9.9 ms | 21.2 ms | 46.0 Hz |
| **Patched, `--camera_write_interval 10`** | **7.8 ms** | **19.0 ms** | **52.2 Hz** |
| Cameras disabled entirely (upper bound) | 0.3 ms | 11.2 ms | 93 Hz |

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

⚠ Only ever run **one** `sim_main.py` at a time. Its exit handler
(`sim_main.py:608-668`) pgreps for `sim_main.py` and SIGTERM/SIGKILLs every
match except itself. DDS domains: **0** = real robot, **1** = sim, **9** = mock.
