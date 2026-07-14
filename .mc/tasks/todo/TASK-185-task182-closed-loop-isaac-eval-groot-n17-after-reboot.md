---
id: TASK-185
aliases:
- TASK-185
title: TASK-182 follow-up — closed-loop Isaac eval + GR00T-N1.7 ablation rerun (after Windows reboot)
slug: task182-closed-loop-isaac-eval-groot-n17-after-reboot
status: backlog
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
updated: 2026-07-14
status_note: 'Everything is prepared; the ONLY blocker is the pending Windows
  reboot (activates staged NVIDIA driver 610.43 — CUDA init in WSL currently
  segfaults machine-wide in dxgdmalEnumAdapters, see memory note
  wsl-cuda-aslr-segfault-fix). User parked this on 2026-07-14.'
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
