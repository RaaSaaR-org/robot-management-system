---
id: TASK-204
aliases:
- TASK-204
title: The Isaac sim ran at 0.28x real time because it copied camera frames it threw away
slug: isaac-sim-ran-at-0-28x-real-time-copying-discarded-camera-frames
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
updated: 2026-08-28
status_note: 'Test steps 1 and 2 are done: cause found by measurement (camera copies,
  NOT render), and the loop went from 14.1 to 52.2 Hz of WALL CLOCK -- real-time factor
  0.28 -> 1.04. The policy's own rate was never the variable: decimation 4 x sim.dt
  0.005 pins it at 50 Hz of simulated time, unchanged by this work. The fix and the
  previously-undurable patch are now in robot-agent/hardware/isaac_sim_patches/.
  Step 3 was run and FAILED for an unrelated reason: the policy cannot stand even with no
  velocity command. Spun out as TASK-223, which is now the real blocker on TASK-203 --
  this task no longer is.'
---


# The Isaac sim ran at 0.28x real time because it copied camera frames it threw away

## Description

`Isaac-Move-Cylinder-G129-Dex3-Wholebody` advanced only ~14 control steps per second of **wall
clock** — a real-time factor of 0.28 — because `get_camera_image` copied three camera frames from
GPU to host on every control step and then discarded them. A nine-line early-out takes it to 52 Hz,
RTF 1.04.

**The DDS wire is not the problem** — that half is proven, see TASK-203 step 3
(`robot-agent/hardware/isaac_loco_check.py`, 7/7).

## Details

### ⚠ This task was filed as a control-rate bug. It is not one — corrected 2026-08-28

The original title and premise ("runs at ~7 Hz against a 100 Hz policy") asserted that the policy
was being starved of control steps. **That cannot happen in this sim, at any wall-clock speed.**

At the pinned upstream commit `e30c25b`, `move_cylinder_g1_29dof_dex3_hw_env_cfg.py` sets
`decimation = 4` (line 144) and `sim.dt = 0.005` (line 147), and `action_provider_wh_dds.py:443`
steps `for _ in range(4): self.env.sim.step(render=False)`. So every `get_action` advances exactly
4 × 0.005 = **0.02 s of simulated time — a fixed 50 Hz control rate in the only clock the policy and
the physics can perceive.** Running the host loop faster does not give the policy more steps per
simulated second; it gives the *operator* more simulated seconds per wall-clock second.

What this task actually moved, therefore, is **real-time factor: 0.28 → 1.04**. Everything below is
correct as measured; only the causal claim attached to it was wrong.

That still matters, for one concrete reason: **an external closed-loop consumer runs on wall clock.**
`robot-agent/hardware/isaac_loco_bridge.py` publishes commands at 50 Hz of wall clock, and at RTF
0.28 the sim consumed them 3.6× slower than they were issued — a growing backlog and a sim that
lagged further behind the caller the longer it ran. Agent Mode, teleop and any recorded episode all
sit behind that same wall-clock boundary. At RTF ≈ 1.04 the sim keeps up with a real-time caller.

**Consequences for anyone reading on:**

* Do not expect changing `--camera_write_interval` to change the robot's *dynamics*. It cannot. The
  52 Hz and 61 Hz runs in test step 3 were dynamically identical experiments, which is exactly what
  they turned out to be.
* Any latency quoted in *steps* (e.g. `DelayBuffer(5)`) is a fixed quantity in simulated time —
  5 × 0.02 s = 100 ms — and is **invariant to wall clock**. Converting it to milliseconds via the
  wall-clock rate produces a number that does not exist. [[TASK-223]] carried exactly that error and
  has been corrected.

### The earlier correction — the cost was not the renderer (2026-08-27)

The task also claimed `env.sim.render()` was the cost and ranked "stop rendering per policy step"
as the cheapest, most-likely-sufficient fix. Measurement says otherwise. Recorded here so the wrong
version is not re-derived from the git history:

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

All rates below are **wall clock**. The simulated-time control rate is 50 Hz in every row — that is
what `decimation 4 × sim.dt 0.005` fixes it at — so the last column, real-time factor, is the one
that actually changed.

| configuration | obs | loop | wall-clock rate | RTF |
|---|---|---|---|---|
| stock, `--device cuda` | 24.5 ms | 67.3 ms | 14.1 Hz | 0.28 |
| stock, `--device cpu` | 39.0 ms | 55.4 ms | 17.5 Hz | 0.35 |
| patched, `--camera_write_interval 2` | 21.6 ms | 34.4 ms | 29.9 Hz | 0.60 |
| patched, `--camera_write_interval 6` | 9.9 ms | 21.2 ms | 46.0 Hz | 0.92 |
| **patched, `--camera_write_interval 10`** | **7.8 ms** | **19.0 ms** | **52.2 Hz** | **1.04** |
| cameras disabled entirely (upper bound) | 0.3 ms | 11.2 ms | 93 Hz | 1.86 |

**3.7× over baseline, and past RTF 1.0 — the sim now runs slightly faster than real time.**
`--camera_write_interval` trades real-time factor against camera cadence: at RTF 1.04, interval 10
gives ~5 Hz frames — fine for Agent Mode head snapshots, too slow for VR teleop. It is already a CLI
flag, so it is a per-use-case setting, not a fixed choice. Interval 6 (RTF 0.92) is the better
default if a caller needs both real time and usable frames.

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
2. ~~The sim logs a step period consistent with **≥50 Hz** sustained.~~ **Done** — 52.15 Hz of wall
   clock, 19.18 ms average loop, RTF 1.04, cameras still live. The ≥50 Hz bar was written believing
   it was the policy's rate; read it as "RTF ≥ 1.0", which is the property a real-time caller needs.
3. **Run, and it FAILED — for a reason outside this task. Spun out as [[TASK-223]].** At both
   RTF 1.04 and RTF 1.22 the robot still tumbles, and it does so **with no velocity command at
   all**: it cannot stand, let alone walk. (Those two runs were never independent evidence — being
   dynamically identical, they could only ever have agreed.) Ankles sit at their limits 39-47 % of the run, and the IMU quaternion
   (norm exactly 1.0000, so the data is sound) never comes near identity. The legs *do* alternate —
   knee cadence ~3.4 Hz, L/R correlation -0.381 — so the policy emits structured rhythmic output
   while the body is on the ground. **The rate was necessary but not sufficient.** Probe:
   `robot-agent/hardware/isaac_gait_probe.py`.
4. **Open, and now pointless until [[TASK-223]] lands** — the DDS path demonstrably still carries
   state (92.8 Hz of `rt/lowstate`) and commands (the policy responds to them), so there is no
   evidence the rate work disturbed it. Re-run `isaac_loco_check.py --domain 1` for the record when
   the robot can stand.
