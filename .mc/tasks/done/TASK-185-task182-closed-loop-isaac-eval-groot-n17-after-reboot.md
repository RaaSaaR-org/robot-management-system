---
id: TASK-185
aliases:
- TASK-185
title: TASK-182 follow-up — closed-loop Isaac eval + GR00T-N1.7 ablation rerun (after Windows reboot)
slug: task182-closed-loop-isaac-eval-groot-n17-after-reboot
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- synthetic-data
- world-model
- vla
sprint: ''
depends_on:
- '[[TASK-182]]'
due_date: ''
created: 2026-07-14
updated: 2026-07-17
status_note: 'DONE 2026-07-17 — all 6 steps ran. Result is NEGATIVE and that is the
  deliverable: the closed-loop eval did not replicate the offline dreams advantage
  (real-only 2/10 vs real+dreams 0/10 on the real task, p=0.47), while offline the
  dreams arm wins 1.6x on both sets — because the offline metric rewards inaction
  (a hold-state policy scores 0.081 rad vs ~0.3-0.4 for both policies) and the
  dreams arm is the more inert one. Step 5(b) (push/slide) is UNANSWERABLE in this
  sim: the only reward scores pick-and-place, and a derived push proxy is invalid
  (place-instructed rollouts satisfy it MORE often than push-instructed ones).
  Report: C:\Unitree\_data\task185\RESULTS.md; RES-001 §4.11; LEARNING_REPORT §8.4
  (+ lessons 16/17). The old blocker was wrong: CUDA works with driver still at
  580.88 — no 610.43 activation was ever needed. Follow-ups spun out: push/slide
  reward in unitree_sim_isaaclab, and a 14k-step retrain (both arms were ~0.15
  epochs).'
---

## Description

Finish the deferred half of TASK-182 AC 4: rerun the real-only vs real+dreams
ablation on **GR00T-N1.7** (instead of N1-2B) and evaluate **closed-loop** in
Isaac Sim (success rates via DDS), fixing the offline-only limitation of the
completed spike. All infrastructure exists; the work was parked solely because
the half-staged NVIDIA driver wedges WSL CUDA until the next Windows reboot.

## Details

**Current state (what TASK-182 delivered, 2026-07-14):**
- Offline ablation (GR00T-N1-2B, 3000 steps, bs 8, single cam): real holdout
  6.4 % vs 6.5 % normalized MAE (no tax); held-out unseen-behavior dreams
  16.8 % (real-only) vs **7.7 % (real+dreams) = 2.2× better**, leakage-free.
  Reports: `C:\Unitree\_data\task182_spike\ablation\eval_*.json`.
- Distro **`g1-eval`** (user-owned copy of the Ubuntu-22.04 vhdx at
  `C:\WSL\Ubuntu22.04-sh\ext4.vhdx`; original untouched): full zema runtime —
  `~/unitree/Isaac-GR00T` (.venv, N1.7), `IsaacLab`, `unitree_sim_isaaclab`
  (via `quest-sim-teleop`), `unitree_lerobot`, conda envs. Stale apt 535 driver
  libs already quarantined to `/root/stale-nvidia-libs/`;
  `/etc/sysctl.d/99-cuda-aslr.conf` present (harmless).
- Datasets (in distro `g1-dreams`, `/root/unitree/datasets/gt_v2/`):
  `unitree_g1_train` (182 real), `unitree_g1_train_plus_dreams45` (227 =
  182 real + 45 dreams, dream videos already 640×480 h264),
  `unitree_g1_dreams_unseen_holdout` (5 held-out unseen-behavior dreams),
  `unitree_g1_holdout` (20 real). Copy into g1-eval (e.g. via
  `tar -C ... | wsl -d g1-eval tar -x`) or a shared /mnt/c staging dir.
- Ablation/eval scripts: `/root/unitree/spike/run_ablation*.sh`,
  `eval_ablation.py` (g1-dreams) — for N1.7 use
  `vla-training/scripts/41_groot_finetune.sh` instead (see below).

**Steps:**
1. After the Windows reboot: verify `torch.cuda.is_available()` in BOTH
   distros (g1-dreams cosmos venv, g1-eval Isaac-GR00T venv). If driver
   610.43 is active (`nvidia-smi` on Windows shows 610.43), no lib
   workarounds should be needed anymore.
2. Single-cam N1.7 configs: derive a 1-camera variant of
   `vla-training/groot/g1_dex3_modality_config.py` (only
   `video.cam_right_high`; state/action `arms`+`hands` slices 0–14/14–28) plus
   matching `meta/modality.json` for the three GR00T-v2 datasets (their current
   modality.json uses IDM-style left_arm/right_arm/... keys — replace for N1.7).
   Rationale: dreams have one camera; both arms must be identical for a fair
   ablation (DreamGen itself is single-view).
3. Finetune both arms with `41_groot_finetune.sh` (N1.7-3B, NEW_EMBODIMENT,
   identical steps/batch, ~35 GB-class — use the memory levers in the script
   header if OOM).
4. Offline sanity eval on `unitree_g1_holdout` + `unseen_holdout` (mirror the
   N1-2B protocol for comparability).
5. Closed-loop: `TASK=Isaac-PickPlace-Cylinder-G129-Dex3-Joint bash
   quest-sim-teleop/run/1_start_sim.sh` (DDS domain 1), then
   `42_groot_serve.sh <ckpt>` + `51_eval_sim.sh` (success via `rt/…` topics)
   for both checkpoints on (a) the pick task and (b) a push/slide language
   instruction (unseen behavior). Record success rates over ≥10 rollouts each.
6. Update RES-001 §4.10 (confirm/adjust the GO), TASK-182's LEARNING_REPORT
   §8.4, and close this task.

## Test Strategy

Closed-loop success rate per arm/task from the sim's DDS success topics
(≥10 rollouts each); offline MAE only as sanity cross-check against the N1-2B
numbers. The decisive comparison: real+dreams vs real-only success rate on the
unseen-behavior instruction.

## Outcome (2026-07-17) — all 6 steps ran; result is negative

Full report: `C:\Unitree\_data\task185\RESULTS.md` · RES-001 §4.11 · LEARNING_REPORT §8.4.

| | offline real holdout | offline held-out dreams | **closed-loop place** |
|---|---|---|---|
| real-only | 0.3811 rad / 25.6 % | 0.4147 rad / 27.4 % | **2/10** |
| real + dreams45 | **0.2363 rad / 16.0 %** | **0.2536 rad / 16.8 %** | **0/10** |

1. **The offline advantage did not replicate closed-loop.** 2/10 vs 0/10 → Fisher exact
   p = 0.47, i.e. no measurable dreams advantage (directionally a small tax).
2. **The metrics disagree, and we know why.** A "hold current state" policy scores 0.081 rad —
   3–5× better than either trained policy — so the offline metric ranks inertness. The dreams
   arm is the more inert one (mean object displacement 0.265 m vs 0.409 m): it wins offline
   *because* it moves less, and loses closed-loop for the same reason.
3. **Step 5(b) is unanswerable in this sim.** `base_reward_pickplace_cylindercfg.py` only scores
   pick-and-place. The derived push proxy is invalid — *place*-instructed rollouts satisfy it
   more often (7–8/10) than *push*-instructed ones (6/10).
4. **Doc corrections:** the held-out "unseen-behavior" dreams are **pick** tasks; tip/knock are in
   *training*, not the eval set (verified against the parquet `task_index`).
5. **Caveat:** both arms are undertrained (3000 × bs8 = 24k samples ≈ 0.15 epochs of 157k frames).
   TASK-180's 14k recipe suggests this buys ~5 %, so it likely would not flip the conclusion.
6. **The premise of this task was wrong:** no reboot/driver 610.43 was needed — CUDA works in
   `g1-eval` with the driver still at 580.88.

**Follow-ups to spin out:**
- Add a **push/slide reward** to `unitree_sim_isaaclab/tasks/common_rewards/` — hard prerequisite
  for ever answering step 5(b).
- Retrain both arms at **14k steps** and re-run the closed loop, for defensibility.
- Never report open-loop MAE on this data without the hold-state baseline beside it.

**Artifacts:** `_data/task185/` — `cl_{real_only,dreams}_{place,push}.json` + `.mp4`,
`RESULTS.md`, first-round `contaminated/` (see lesson 17); checkpoints
`~/unitree/task185/out/<arm>/checkpoint-3000` and evals `~/unitree/task185/eval/*.json` in WSL
`g1-eval`; configs `vla-training/groot/g1_dex3_1cam_modality_config.py` + `modality_g1_dex3_1cam.json`.
