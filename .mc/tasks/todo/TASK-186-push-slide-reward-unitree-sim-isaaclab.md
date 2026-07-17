---
id: TASK-186
aliases:
- TASK-186
title: Push/slide success reward for unitree_sim_isaaclab (unblocks unseen-behavior closed-loop ablations)
slug: push-slide-reward-unitree-sim-isaaclab
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- synthetic-data
- vla
sprint: ''
depends_on:
- '[[TASK-185]]'
due_date: ''
created: 2026-07-17
updated: 2026-07-17
status_note: 'Spun out of TASK-185: without a push/slide reward the unseen-behavior
  half of the dreams ablation cannot be scored at all — TASK-185 had to report it
  as unanswerable.'
---

## Description

Add a **push/slide success reward** to `unitree_sim_isaaclab` so that language instructions like
"Push the red cup to the left side of the table without lifting it" can be scored closed-loop.
Today the sim only rewards pick-and-place, which makes the unseen-behavior half of the
DreamGen ablation ([[TASK-185]] step 5b) impossible to measure.

## Details

**Current state:**
- `unitree_sim_isaaclab/tasks/common_rewards/base_reward_pickplace_cylindercfg.py` publishes
  `rt/rewards_state` = `{"rewards":[r], "timestamp":t}` where `r = 1.0` iff the cylinder is inside
  the target post area (x 0.28–0.96, y 0.24–0.57, z 0.81–0.90), `0.0` in the valid area, `-1.0`
  outside. Registered unconditionally in `dds/dds_create.py` (`RewardsDDS`).
- There is **no** signal for a push/slide, so TASK-185 fell back to a derived proxy (lateral
  object travel ≥ 0.08 m with lift ≤ 0.06 m, read from `rt/sim_state`).
- **That proxy is provably invalid:** applied to TASK-185's rollouts, *place*-instructed runs
  satisfied it **more** often (7–8/10) than *push*-instructed runs (6/10). It measures flailing.
  Evidence: `C:\Unitree\_data\task185\RESULTS.md` §2.1.

**What's needed — a reward that separates "pushed as instructed" from "knocked around":**
1. **Direction:** displacement projected onto the *commanded* axis (left/right/forward/toward
   robot) must dominate — e.g. `dot(disp_xy, cmd_dir) >= 0.15 m` AND lateral-off-axis error small.
   The commanded direction has to come from the task/instruction, so the reward cfg needs to know
   which push variant is active (mirror how the pickplace cfg learns its target area).
2. **Never lifted:** `max(z) - z0 <= ~0.03 m` across the episode (TASK-185 used 0.06; tighten).
3. **Still upright / not knocked:** cap the tilt of the object quaternion (a "tip/knock" must NOT
   count as a push — note tip/knock are separate dream prompts).
4. **Contact-driven:** reject displacement occurring with no hand near the object, so a swept arm
   that launches the cylinder does not score.

**Key files:**
- `unitree_sim_isaaclab/tasks/common_rewards/base_reward_pickplace_cylindercfg.py` — pattern to copy
  (how it reads env state, thresholds, and calls `rewards_dds.write_rewards_data(reward)`).
- `unitree_sim_isaaclab/tasks/common_rewards/` — new `base_reward_push_cylindercfg.py`.
- `unitree_sim_isaaclab/dds/rewards_dds.py` — publisher (`rt/rewards_state`); no change expected.
- `unitree_sim_isaaclab/dds/dds_create.py` — registration if a new task variant is added.
- Consumer/reference harness: `C:\Unitree\_data\task185\eval_g1_sim_groot_success.py`
  (`--mode push` currently implements the invalid proxy — replace it with the DDS signal).

## Test Strategy

Scripted positive/negative controls, not a policy: drive the arm to (a) slide the cylinder 0.2 m
left along the table → reward must fire; (b) lift and place it left → must NOT fire (lift gate);
(c) knock it over → must NOT fire (tilt gate); (d) do nothing → must NOT fire. Then re-run
TASK-185's ablation cell and confirm the *place*-instructed control no longer outscores the
*push*-instructed run (the failure that invalidated the proxy).
