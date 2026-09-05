---
id: TASK-187
aliases:
- TASK-187
title: Re-run the dreams ablation once the base policy, the push reward and the harness are fixed
slug: retrain-dreams-ablation-14k-steps-rerun-closed-loop
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
- synthetic-data
- world-model
- vla
sprint: ''
parent: ""
depends_on:
spe: 8
effort: ""
- '[[TASK-185]]'
- '[[TASK-186]]'
- '[[TASK-188]]'
- '[[TASK-189]]'
- '[[TASK-225]]'
due_date: ''
created: 2026-07-17
updated: "2026-09-05"
status_note: 'THE FINAL STEP, not the next one — it is blocked on all three fixes and
  must not be run before them. TASK-185 failed for three independent reasons: the sim
  cannot score a push (TASK-186), both arms sat at 0-2/10 so the ablation hit a floor
  effect (TASK-188), and n=10 gave p=0.47 (TASK-189). Re-running the ablation before
  those land just buys another inconclusive result at 5h of GPU. Note the 14k retrain
  itself is expected to be worth only ~5% (TASK-180: 0.4258→0.4036) — it is TASK-188,
  not the step count, that decides whether this experiment can answer anything.'
---

## Description

> ⚠ **The Windows GPU box is retired (2026-08-28).** This file was written when a
> separate Windows/WSL machine ("GPU_BOX") existed. It does not any more — the only
> machine is the Linux dev box with the RTX 5090. Read every mention of GPU_BOX,
> WSL, `.bat` or `C:\...` below as *historical context*, not as where the work
> happens.

**What this means for TASK-187:** this task already says "do not start early",
depending on [[TASK-186]] and [[TASK-188]]. It now also depends on **[[TASK-225]]**,
the harness rebuild — `task185_finetune.py`, `task185_serve_n17.sh` and
`eval_g1_sim_groot_success.py` went with the Windows box and exist in no repo.
That makes TASK-225 a *fourth* blocker, and the first one in the chain: TASK-188
cannot start without it either.
The WSL2 localhost-forwarding trick this task relies on to reach the policy server
is moot: sim and policy server now run on the same Linux box, so a plain
`127.0.0.1` port works with nothing forwarding it.


Re-run the real-only vs real+dreams GR00T-N1.7 ablation and the closed-loop Isaac eval **once the
three things that made [[TASK-185]] unanswerable are fixed** — a push/slide reward ([[TASK-186]]),
a base policy that is off the floor ([[TASK-188]]), and a harness with enough statistical power
([[TASK-189]]). Inherit whatever training recipe TASK-188 lands on (≥ 14k steps, 2-cam if the
dreams can supply the second view — otherwise single-cam for both arms, as fairness requires
identical inputs).

**Do not start this task early.** Each blocker independently guarantees an inconclusive result:
- without TASK-186, the decisive unseen-behavior cell has no valid success criterion at all;
- without TASK-188, both arms sit at 0–2/10 and the ablation is a floor effect — no ablation can
  discriminate two policies that both fail;
- without TASK-189, n=10 yields p≈0.47 whatever happens.

The 14k step count alone is worth ~5 % (TASK-180: open-loop MSE 0.4036 @14k vs 0.4258 @2k). It
removes "undertrained" as an objection; it is **not** the fix.

## Details

**Current state ([[TASK-185]], 2026-07-17):**
- Both arms trained 3000 steps × global batch 8 = 24,000 samples on a **157,151-frame** set
  ≈ **0.15 epochs**. Loss was still descending smoothly (1.40 → 0.78, grad_norm ~0.7–1.1).
- Evidence they are undertrained rather than broken: on its **own training data** the real-only
  arm scores 0.393 rad vs 0.081 for a hold-state baseline; checkpoint-2000 → 3000 improved only
  0.408 → 0.396 rad.
- **Expectation management:** TASK-180 ran 14k steps on this box and got open-loop MSE **0.4036
  @14k vs 0.4258 @2k** — ~5 % for 7× compute. So this is unlikely to flip TASK-185's negative
  result; it removes "undertrained" as an objection.

**Recipe (reuse TASK-185's, change only the step count):**
- Driver: `$UNITREE_ROOT/_data/task185_run_ablation_n17.sh` — set `STEPS=14000`, keep `BS=8`,
  `TASK185_OPTIM=paged_adamw_8bit` (stock `adamw_torch` OOMs at 31.9/32 GB even at batch 1),
  `TASK185_GRAD_CHECKPOINTING=0`, and `unset HF_HUB_OFFLINE` (the Cosmos-Reason2-2B backbone
  needs an online token-authed `model_info()` call).
- Cost: ~1.55 it/s → **~2.5 h per arm, ~5 h total**. Raise `--save-total-limit` above 2 if
  intermediate checkpoints are wanted (TASK-185 lost checkpoint-1000 to pruning).
- Runner: `$UNITREE_ROOT/task185/task185_finetune.py` in WSL the eval distro (a copy of
  `launch_finetune.py`'s `__main__` whose only deviation is env-var levers for optim /
  gradient-checkpointing — needed because `launch_finetune.py` pins `optim` *after*
  `get_default_config()`).
- Configs (unchanged, single-camera for parity with the dreams' single view):
  `vla-training/groot/g1_dex3_1cam_modality_config.py` + `modality_g1_dex3_1cam.json`.

**Then re-run the closed loop** with `$UNITREE_ROOT/_data/task185/eval_g1_sim_groot_success.py`
(serve via `task185_serve_n17.sh <arm> <port>`; sim on native Windows, policy server in WSL —
WSL2 localhost-forwarding makes the ZMQ port reachable). **Depends on [[TASK-186]]:** without a
push/slide reward the unseen-behavior cell — the decisive one — still cannot be scored.

**Two traps TASK-185 hit; do not repeat them:**
1. **Kill stale eval processes between runs.** `G1_29_ArmController` runs a `while True` thread
   writing `rt/lowcmd` and `Dex3_1_Controller` spawns non-daemon children, so a "finished" run
   keeps commanding the robot on DDS domain 1 and fights the next one. With strays alive every
   cell read 0/10; after a hard `os._exit(0)` the same checkpoint scored 2/10. The script now
   hard-exits — still verify no `eval_g1_sim_groot_success` PID survives before the next run.
2. **Do not use open-loop MAE as the headline.** It ranks inertness on this data (hold-state =
   0.081 rad beats every trained policy). Always report the hold-state baseline next to it.

## Test Strategy

Run the full grid (2 arms × {place, push}) through [[TASK-189]]'s harness at **n ≥ 40** per cell,
success from the sim's `rt/rewards_state` (place) and [[TASK-186]]'s new reward (push), with its
built-in controls: the cross-metric control (a *place*-instructed cell must NOT outscore a
*push*-instructed one on the push criterion — that failure invalidated TASK-185's proxy) and the
do-nothing control (must score ~0). Report Fisher exact p for real+dreams vs real-only per
instruction, and the hold-state baseline beside any MAE.

Baselines to beat: TASK-185's real-only **2/10** / real+dreams **0/10** at 3000 steps, and
whatever [[TASK-188]] establishes as the real-only ceiling (target ≥ 6/10). **A null result is a
valid outcome** — but only once the controls pass; otherwise the cell is uninformative, not
negative.
