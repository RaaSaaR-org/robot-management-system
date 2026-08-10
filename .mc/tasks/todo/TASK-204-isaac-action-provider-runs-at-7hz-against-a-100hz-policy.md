---
id: TASK-204
aliases:
- TASK-204
title: The Isaac action provider runs at ~7 Hz against a 100 Hz policy, so the G1 never walks
slug: isaac-action-provider-runs-at-7hz-against-a-100hz-policy
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- g1
- sim
- deferred
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-09
updated: 2026-08-09
---


# The Isaac action provider runs at ~7 Hz against a 100 Hz policy, so the G1 never walks

## Description

`unitree_sim_isaaclab`'s DDS action provider calls `env.sim.render()` and
`observation_manager.compute()` **synchronously inside every policy step**, which drops the loop to
5–13 Hz. Its shipped locomotion policy expects ~100 Hz. At that rate the policy drives all 12 leg
joints straight into their limits instead of producing a gait, so the robot stands and shakes rather
than walking. This is the sole blocker on TASK-203 steps 2, 4 and 5.

**The DDS wire is not the problem** — that half is proven, see TASK-203 step 3
(`robot-agent/hardware/isaac_loco_check.py`, 7/7). This task is purely about the sim's step rate.

## Details

### Current state — what was measured (2026-08-08)

Checkout: `~/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/unitree_sim_isaaclab`
(third-party, detached HEAD, **not** vendored into this repo).

* The sim logs `[Performance] A:116.6ms` out of a ~144 ms loop — i.e. **81% of wall time is inside
  the action provider**, before physics gets a turn.
* Symptom at the joints: knee travels 0.314 → 2.880 rad and both ankles pin at exactly ±0.524 rad
  (their limits). Commands *are* arriving and *are* being applied — the policy is simply being asked
  to close a loop at a tenth of its design rate.
* `--device cuda` for physics made no difference. It is **render-bound, not physics-bound**, so
  moving physics to the GPU or reducing `num_envs` (already 1) will not help.

### The likely fix, in rough order of cost

1. **Stop rendering per policy step.** The render exists to feed cameras. Decouple it: render on its
   own slower cadence (or only when a camera consumer is actually attached) rather than once per
   action. Cheapest and most likely sufficient.
2. **Hoist `observation_manager.compute()`** out of the provider if the same observation is being
   computed more than once per step.
3. **Run headless without `--enable_cameras`** and confirm the rate recovers — a diagnostic, not a
   fix, since the task cfg spawns cameras and refuses to start without the flag. Use it to attribute
   the cost between rendering and observation before touching anything.

### The landmine this task must also record

`action_provider/action_provider_wh_dds.py` (~line 438) carries an **in-place NeoDEM patch** that
exists in no repo and is lost on re-clone:

```python
# NeoDEM patch: `_full_action_buf` is 1-D (43,), but Isaac Lab 6.1.14 requires a
# leading env dimension and raises "Shape mismatch: torch.Size([43]) != (1, 43)",
# which this method swallows -- so every step silently produced no action and the
# robot never moved. Older Isaac Lab accepted the unbatched form.
for _ in range(4):
    self.env.scene["robot"].set_joint_position_target(
        full_action.unsqueeze(0) if full_action.dim() == 1 else full_action)
```

Without it the action path is a **silent no-op**: the surrounding `except` swallows the shape error,
the sim prints "Get DDS action failed" every step, and the robot never moves. Part of this task is to
get that patch somewhere durable — a patch file under `robot-agent/hardware/`, or upstream.

### Operational constraints on this box

* **Only ever run ONE `sim_main.py` at a time.** Its exit handler (`sim_main.py:623`) runs
  `pgrep -f sim_main.py` and SIGTERMs *every* match except itself — so a second instance destroys the
  first *when the second exits*, including when it dies a second later on a bad flag. This already
  killed a sim that had been up 12+ hours.
* **Isaac needs the GPU to itself.** Under contention, captures come back as empty sky and Warp
  throws `CUDA error 700: illegal memory access`.
* `--enable_cameras` is mandatory (the task cfg spawns cameras). Use `python -u` or the log sits at
  164 bytes for ten minutes and looks like a hang. Avoid `--livestream_type 0`; it hangs startup.
* DDS domain 1 is hardcoded in this sim and `sim_g1_dds/sim_node.py` also runs there. Two `sport`
  services on one domain is a race — stop `sim_node.py` before testing against Isaac, put it back
  after.

### Key files

* `unitree_sim_isaaclab/action_provider/action_provider_wh_dds.py` — `DDSRLActionProvider`, the hot
  path; also holds the shape patch above
* `unitree_sim_isaaclab/sim_main.py` — entry point; the sibling-killing exit handler at `:623`
* `robot-agent/hardware/isaac_loco_bridge.py` — our `sport` RPC adapter; unaffected by this task, but
  it is what will be driving the sim when the rate is fixed
* `robot-agent/hardware/isaac_loco_check.py` — proves the wire independently of the gait

## Test Strategy

1. Instrument or profile the provider to attribute the 116.6 ms between `env.sim.render()` and
   `observation_manager.compute()`. Do not guess — the fix depends on which dominates.
2. After the change, the sim logs a step period consistent with **≥50 Hz** sustained (the policy wants
   100 Hz; below ~50 Hz do not expect a gait).
3. Under `send_commands_keyboard.py`, feet make and break contact and the base translates — knees and
   ankles stay off their limits. This is TASK-203 step 2 and unblocks it.
4. Re-run `isaac_loco_check.py` afterwards to confirm the rate work did not disturb the DDS path.
