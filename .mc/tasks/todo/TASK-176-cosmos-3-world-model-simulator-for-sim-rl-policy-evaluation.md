---
id: TASK-176
aliases:
- TASK-176
title: Cosmos 3 world-model simulator for sim-RL policy evaluation
slug: cosmos-3-world-model-simulator-for-sim-rl-policy-evaluation
status: backlog
priority: 4
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- '[[TASK-174]]'
due_date: ''
created: 2026-06-28
updated: 2026-06-29
status_note: 'DONE — feasibility study run on HF PRO (16 forward-dynamics rollouts, n=4). Verdict NO-GO: Cosmos 3 is action-conditioned & plausible but not a reliable policy-ranking simulator (real ranked #1 in 1/4; naive SSIM rewards a do-nothing policy). Go/no-go recorded in RES-001 §4.8. All 3 ACs met.'
---


# Cosmos 3 world-model simulator for sim-RL policy evaluation

## Description

Investigate using **Cosmos 3 forward-dynamics** (action+image+text → future video) as a **learned world-model simulator** to complement the existing MuJoCo digital-twin / sim-RL evaluation loop. Exploratory, **low priority** — gated by a known reliability caveat. See [[RES-001]]. Depends on [[TASK-174]].

## Details

**Current state:** The sim-RL pipeline (TASK-172.C, `sim_rl` kind: server + wizard + `sim_evaluator` + `../sim-trainer` PPO) evaluates nav/manip policies in a **MuJoCo** twin built from G1 room scans (TASK-170/173, `../twin-builder`). Evaluation is geometric/physics-based.

**Idea:** Use Cosmos 3 as a *visual* learned simulator — roll out a policy's action chunks through forward dynamics, predict future frames, and score outcomes — to add visual realism and out-of-distribution coverage the geometric sim lacks.

**Why low priority / risky:**
- NVIDIA itself notes current world models "**fall short as reliable simulators of the physical world**" — so this likely augments, not replaces, MuJoCo.
- Diffusion rollouts are **slow + iterative** → unsuitable for tight RL inner loops; better as an offline eval/benchmark stage.
- Requires cloud GPU (16B+ BF16).

**Free tool exists:** the official **`nvidia/Cosmos3-Action-Viewer`** HF Space does **forward dynamics** (actions→future video) and **inverse dynamics** out of the box, with packaged demo data — usable free in-browser, or via HF PRO ($9/mo) for scripted runs. This covers the feasibility study below without any GPU spend. See [[RES-001]] §4.7 + `scratch/cosmos3/HF-PRO-RUNBOOK.md`. ⛔ *Verified 2026-06-28:* the scripted `/generate` is a **300s GPU job** — one run **exceeds the free daily ZeroGPU quota (~300s/day)** → **requires HF PRO** (the in-browser viewer still works free for a manual look). See [[RES-001]] §4.7.

**Scope (feasibility study, not production):**
1. Take 2–3 recorded action sequences for a supported embodiment, run forward-dynamics rollouts (via the Action-Viewer), compare predicted vs real outcomes.
2. Assess whether predictions are stable/physically plausible enough to rank policies.
3. Decide: integrate into `sim_evaluator` as an optional backend, or shelve. Record decision in [[RES-001]].

**Key files:** `server/` sim-RL evaluator integration point (`sim_evaluator`), `../sim-trainer`. No integration unless the study passes.

## Result (2026-06-29, HF PRO) — VERDICT: NO-GO (now)

Study run end-to-end on HF PRO (Cosmos3-**Nano** via the free Action-Viewer). Harness:
`server/curation/cosmos3_wm_eval.py` (`rollout` / `score` / `selftest`). Full write-up +
go/no-go in **[[RES-001]] §4.8**; artifacts in `RES-001/task176-wm-eval/`.

- **Design:** for **4 recorded bridge/WidowX sequences**, roll out the *same conditioning
  frame* under 4 "policies" — **real** recorded actions + 3 corrupted (**scrambled /
  reversed / zero**) = **16 forward-dynamics rollouts** (~10–35s each). Predicted clips
  auto-align to ground truth by matching the conditioning frame (no Space-internal
  windowing assumed).
- **Metrics:** global SSIM/PSNR + **foreground-masked SSIM** + **motion_corr**
  (correlation of predicted vs real change-maps — a do-nothing policy scores ~0).
- **Findings:** Cosmos forward dynamics is **action-conditioned & visually plausible**
  (`zero`→near-static; strips show real WidowX manipulation), but **NOT a reliable
  policy-ranking simulator**:
  - global SSIM/PSNR rank a *do-nothing* policy best in **4/4** (pixel metrics reward no motion);
  - motion-aware metrics rank the **real** policy #1 in only **1/4** (≈ chance; real ranks *last* in 2/4).
  - Rollout error accumulates → at mid-trajectory conditioning the gripper warps and pose diverges. Confirms NVIDIA's own "world models fall short as reliable simulators" caveat.
- **Decision:** keep MuJoCo geometric eval (`evaluate_policy.py`, consumed by
  `SimulationService` `backend: 'mujoco'|'isaac'`) as source of truth. **Do not add a
  `cosmos` backend.** Revisit only with **Cosmos3-Super (rented GPU) + a task-success
  reward**, as an *offline* visual-OOD augmentation (`evaluate_wm.py` emitting the same
  `SimRunMetrics`), never the diffusion-too-slow RL inner loop.

## Acceptance Criteria
- [x] Forward-dynamics rollout produced for ≥2 recorded sequences — **16 rollouts, n=4 sequences**
- [x] Qualitative + rough quantitative comparison vs ground truth documented — SSIM/PSNR/masked-SSIM/motion_corr + frame strips, RES-001 §4.8
- [x] Go/no-go decision on integrating as a `sim_evaluator` backend recorded in [[RES-001]] — **NO-GO**, §4.8 + §4.6

## Test Strategy
Manual comparison of predicted vs actual rollouts; sanity-rank a good vs deliberately-bad policy and check the world model orders them correctly.

## Notes
Keep deferred until [[TASK-174]]/[[TASK-175]] prove value. Related: [[project_sim_rl_phase0]], [[project_digital_twin]].
