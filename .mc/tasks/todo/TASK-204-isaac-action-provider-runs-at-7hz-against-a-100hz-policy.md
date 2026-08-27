---
id: TASK-204
aliases:
- TASK-204
title: The Isaac action provider runs at ~7 Hz against a 100 Hz policy, so the G1 never walks
slug: isaac-action-provider-runs-at-7hz-against-a-100hz-policy
status: in-progress
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
created: 2026-08-09
updated: 2026-08-27
status_note: 'Test steps 1 and 2 are done: cause found by measurement (camera copies,
  NOT render) and the rate is 52.2 Hz sustained, clearing the >=50 Hz bar. The fix and
  the previously-undurable patch are now in robot-agent/hardware/isaac_sim_patches/.
  Steps 3 (gait under velocity commands) and 4 (isaac_loco_check re-run) are still open;
  step 3 is what actually unblocks TASK-203.'
---


# The Isaac action provider runs at ~7 Hz against a 100 Hz policy, so the G1 never walks

## Description

The wholebody DDS task ran at ~14 Hz against a locomotion policy that expects ~100 Hz. At that rate
the policy drives all 12 leg joints into their limits instead of producing a gait, so the robot
stands and shakes rather than walking. This is the sole blocker on TASK-203 steps 2, 4 and 5.

**The DDS wire is not the problem** — that half is proven, see TASK-203 step 3
(`robot-agent/hardware/isaac_loco_check.py`, 7/7). This task is purely about the sim's step rate.

## Details

### ⚠ This task's original diagnosis was wrong — corrected 2026-08-27

The task was filed claiming `env.sim.render()` was the cost and ranked "stop rendering per policy
step" as the cheapest, most-likely-sufficient fix. Measurement says otherwise. Recorded here so the
wrong version is not re-derived from the git history:

* **`env.sim.render()` costs 0.1 ms — 0.15 % of the loop.** Removing it buys nothing.
* **`--device cuda` did not "make no difference".** CPU physics is **3.4× faster** on `sim.step`
  (28.7 → 8.5 ms). GPU PhysX is a pessimisation at `num_envs=1`. The loop was neither render-bound
  nor physics-bound.
* The `[Performance] A:116.6ms` line the task quoted is a single instantaneous sample, not an
  average. It should not be treated as a measurement.

### What the cost actually was

`tasks/common_observations/camera_state.py::get_camera_image` did the GPU→host `.cpu().numpy()`
copies for the head, left and right cameras on **every** control step, used them only inside its
`frame_step == 0` branch, and returned the same constant placeholder either way. The existing
`write_interval_steps` knob gated only the shared-memory *write* — the cheap half. The fix is a
nine-line early-out placed **before** the copies; behaviour-identical, since on a non-capture frame
nothing below it is consumed.

`observation_manager.compute()` is also the only publisher of robot joint state to DDS in this mode,
so it cannot simply be skipped — hence throttling the camera term inside it rather than the pass.

### Measured attribution (test step 1 — done)

Per `get_action`, CUDA-synchronised marks, ~2000 samples per configuration, task
`Isaac-Move-Cylinder-G129-Dex3-Wholebody`, `num_envs=1`:

| phase | `--device cuda` | `--device cpu` |
|---|---|---|
| policy (ONNX) | 0.9 ms | 0.8 ms |
| DDS command reads | 0.4 ms | 0.3 ms |
| decimation loop (×4) | 40.2 ms | 15.3 ms |
| ├ write / set_target | 9.3 ms | 5.6 ms |
| ├ `sim.step` | 28.7 ms | 8.5 ms |
| └ `scene.update` | 3.3 ms | 1.2 ms |
| **`env.sim.render()`** | **0.1 ms** | **0.0 ms** |
| `observation_manager.compute()` | 24.5 ms | 39.0 ms |
| **total** | **67.3 ms** | **55.4 ms** |

### Rate after the fix (test step 2 — done, bar cleared)

| configuration | obs | loop | rate |
|---|---|---|---|
| stock, `--device cuda` | 24.5 ms | 67.3 ms | 14.1 Hz |
| stock, `--device cpu` | 39.0 ms | 55.4 ms | 17.5 Hz |
| patched, `--camera_write_interval 2` | 21.6 ms | 34.4 ms | 29.9 Hz |
| patched, `--camera_write_interval 6` | 9.9 ms | 21.2 ms | 46.0 Hz |
| **patched, `--camera_write_interval 10`** | **7.8 ms** | **19.0 ms** | **52.2 Hz** |
| cameras disabled entirely (upper bound) | 0.3 ms | 11.2 ms | 93 Hz |

**3.7× over baseline.** `--camera_write_interval` trades control rate against camera cadence: at
52 Hz, interval 10 gives ~5 Hz frames — fine for Agent Mode head snapshots, too slow for VR teleop.
It is already a CLI flag, so it is a per-use-case setting, not a fixed choice.

### The landmine — now durable ✔

`action_provider_wh_dds.py` carried an in-place NeoDEM patch that existed in no repo and was lost on
re-clone. Without it the action path is a **silent no-op**: the surrounding `except` swallows a
`Shape mismatch: torch.Size([43]) != (1, 43)`, the sim prints "Get DDS action failed" every step, and
the robot never moves. It, its sibling warp-`Device` fix, and the camera fix are now captured in
**`robot-agent/hardware/isaac_sim_patches/`** (patch + README + the container Dockerfile), pinned to
upstream commit `e30c25b` and verified to apply cleanly.

### Running Isaac on this box

Isaac's RTX renderer needs Vulkan, which needs `/dev/dri/renderD*`, whose ACL systemd-logind grants
to whoever holds seat0 — which you do not hold over SSH. CUDA working is *not* evidence Vulkan will
(CUDA uses the world-readable `/dev/nvidia*`). Running as **root in a container** sidesteps the ACL;
the container supplies root and nothing else, bind-mounting the host home and running the host conda
env's own python. Full invocation and the three traps are in `isaac_sim_patches/README.md`.

### Operational constraints on this box

* **Only ever run ONE `sim_main.py` at a time.** Its exit handler (`sim_main.py:608-668`) pgreps
  `sim_main.py` and SIGTERM/SIGKILLs *every* match except itself — so a second instance destroys the
  first *when the second exits*, including when it dies a second later on a bad flag.
* **Isaac needs the GPU to itself.** Under contention, captures come back as empty sky and Warp
  throws `CUDA error 700: illegal memory access`.
* `--enable_cameras` is mandatory (the task cfg spawns cameras). Use `python -u` or the log sits at
  164 bytes for ten minutes and looks like a hang. Avoid `--livestream_type 0`; it hangs startup.
* DDS domain 1 is hardcoded in this sim and `sim_g1_dds/sim_node.py` also runs there. Two `sport`
  services on one domain is a race — stop `sim_node.py` before testing against Isaac, put it back
  after. Domains: **0** = real robot, **1** = sim, **9** = mock.

### Key files

* `robot-agent/hardware/isaac_sim_patches/` — the patch, its README, the container Dockerfile
* `unitree_sim_isaaclab/tasks/common_observations/camera_state.py` — where the cost was
* `unitree_sim_isaaclab/action_provider/action_provider_wh_dds.py` — `DDSRLActionProvider`, hot path
* `robot-agent/hardware/isaac_loco_bridge.py` — our `sport` RPC adapter; what will drive the sim
* `robot-agent/hardware/isaac_loco_check.py` — proves the wire independently of the gait

## Test Strategy

1. ~~Attribute the loop cost by measurement, not guesswork.~~ **Done** — table above. The premise
   being tested turned out to be false, which is why step 1 existed.
2. ~~The sim logs a step period consistent with **≥50 Hz** sustained.~~ **Done** — 52.15 Hz,
   19.18 ms average loop, cameras still live.
3. **Open.** Under velocity commands, feet make and break contact and the base translates — knees and
   ankles stay off their limits. Baseline symptom to beat: knee travels 0.314 → 2.880 rad and both
   ankles pin at exactly ±0.524 rad. This is TASK-203 step 2 and unblocks it.
4. **Open.** Re-run `isaac_loco_check.py --domain 1` to confirm the rate work did not disturb the
   DDS path.
