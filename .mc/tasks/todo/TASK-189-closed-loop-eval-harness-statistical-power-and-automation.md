---
id: TASK-189
aliases:
- TASK-189
title: Closed-loop eval harness — statistical power (n≥40), automation, built-in honesty controls
slug: closed-loop-eval-harness-statistical-power-and-automation
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- vla
sprint: ''
depends_on:
- '[[TASK-185]]'
due_date: ''
created: 2026-07-17
updated: 2026-07-17
status_note: 'Spun out of TASK-185, whose headline comparison came out p=0.47 purely
  from n=10. Rollouts cost ~40 s — statistical power here is nearly free and we simply
  did not buy it.'
---

## Description

Turn the one-off TASK-185 rollout script into an eval harness that can actually settle a question:
**n ≥ 40 rollouts per cell**, unattended execution of a full grid (arms × instructions), and the
honesty controls that caught two wrong answers last time, built in rather than remembered.

## Details

**Current state ([[TASK-185]], 2026-07-17):** `C:\Unitree\_data\task185\eval_g1_sim_groot_success.py`
works — it serves a checkpoint, drives the sim over DDS domain 1, and reads success from the sim's
own `rt/rewards_state`. But each cell was run by hand, at n=10, with servers swapped manually.

**Why n=10 was never going to work:** real-only 2/10 vs real+dreams 0/10 → two-tailed Fisher exact
**p = 0.47**. To detect a 20 % → 50 % difference at 80 % power / α=0.05 needs roughly **n ≈ 40 per
cell**. At ~40 s per rollout that is ~27 min per cell — under 2 h for a 4-cell grid. The power was
affordable all along.

**What to build:**
1. **Grid runner.** One command takes a list of (checkpoint, instruction, mode) cells and runs them
   unattended: start the policy server, wait for "Server is ready", run n rollouts, kill the
   server, next cell. Today `task185_serve_n17.sh` + the `.bat` wrappers do this by hand.
2. **n configurable, default 40.** Persist per-rollout records (already in `cl_*.json`).
3. **Built-in stale-process guard.** Before each cell, assert no `eval_g1_sim_groot_success`
   process survives. `G1_29_ArmController` runs a `while True` thread writing `rt/lowcmd` and
   `Dex3_1_Controller` spawns non-daemon children, so a finished run keeps commanding the robot on
   domain 1. With 4 strays alive **every cell read 0/10**; after `os._exit(0)` the same checkpoint
   scored **2/10**. The script now hard-exits — the harness should *verify*, not trust.
4. **Built-in controls, reported automatically:**
   - **Cross-metric control:** score every cell against *every* criterion, not just its own. This
     is what exposed the push proxy as invalid — *place*-instructed rollouts satisfied the push
     criterion **more** often (7–8/10) than *push*-instructed ones (6/10).
   - **Do-nothing control:** run n rollouts of a null policy (hold current state / zero deltas)
     through the identical harness. If it scores like the trained policy, the cell is uninformative.
     Offline, this baseline (0.081 rad) already beats every policy we have trained.
   - **Reset-integrity check:** reset is best-effort DDS — TASK-185 logged only ~17 of 20 "reset
     all" commands, so some rollouts started from the previous end-state. Confirm the reset landed
     (e.g. object pose returned near its start distribution) and re-issue or flag the rollout.
5. **Report:** per cell — successes/n, Fisher exact p vs the comparison cell, mean/σ object
   displacement, plus the controls. Refuse to print a success rate for a criterion its own control
   failed.

**Key files:**
- `C:\Unitree\_data\task185\eval_g1_sim_groot_success.py` — harness (`--mode place|push`, `--probe`,
  `hard_exit()`); obs must be **nested** (`observation["video"|"state"|"language"]`), not flat keys.
- `C:\Unitree\_data\task185_serve_n17.sh` — serve arm/port from WSL `g1-eval`; the sim on native
  Windows reaches it via `127.0.0.1:<port>` (WSL2 localhost-forwarding — verified).
- `C:\Unitree\_data\task185_summarize.py` — the cross-metric control, currently a separate script;
  fold it in.
- `C:\Unitree\_data\task185_rollout*.bat` — the manual wrappers this replaces. Note `<DREAM>`
  instructions contain `<`/`>`, which cmd parses as redirection — pass instructions via file or env,
  not as bare argv.
- Sim: `C:\Unitree\unitree_sim_isaaclab\start_sim_pickplace_dex3.bat` (DDS **domain 1**).

Not in scope: the push/slide reward itself ([[TASK-186]]) — this task consumes whatever criteria
the sim publishes.

## Test Strategy

Re-run TASK-185's grid at n=40 and confirm it reproduces the 3000-step baseline within noise
(real-only ≈ 2/10 → expect ~8/40). Verify the harness **refuses** to report a push success rate
while [[TASK-186]] is unlanded (its control fails by construction). Verify the do-nothing control
scores ~0/40 on the place criterion — if it doesn't, the sim's success signal is itself suspect
and everything built on it needs re-examining.
