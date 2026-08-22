---
id: TASK-180
aliases:
- TASK-180
title: Multi-task G1 Dex3 VLA — merge 13 Unitree datasets and finetune one language-conditioned checkpoint
slug: multi-task-g1-dex3-vla-merge-13-unitree-datasets-finetune
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-10
updated: 2026-07-11
status_note: 'DONE (Phase A, 2026-07-11, GPU_BOX): 7 Pick* sets merged (1410 ep / 7 language tasks), 14k-step GR00T-N1.7 multi-task finetune through NeoDEM (job ad72e95e), open-loop A/B beats the 2000-step single-task ckpt on ALL tasks incl. PickBottle itself. Phase B (13-set expansion) remains a follow-up.'
---


# Multi-task G1 Dex3 VLA — merge 13 Unitree datasets and finetune one language-conditioned checkpoint

## Description

We proved the full NeoDEM Collect→Train→Deploy→Evaluate loop end-to-end on a **single** task: a GR00T-N1.7-3B finetune on `unitreerobotics/G1_Dex3_PickBottle_Dataset` (202 ep), driven through the `training-worker` + moto-S3 + Isaac Sim closed-loop eval. GR00T is a **language-conditioned VLA** — it already takes a task string (`annotation.human.task_description`) at inference — so the same machinery scales to many tasks by finetuning on a **merged multi-task dataset**. This task: merge Unitree's 13 public **G1_Dex3** datasets into one LeRobot dataset with preserved per-task language labels, run a long multi-task GR00T finetune, serve the single resulting checkpoint, and eval each task in sim by swapping the instruction string.

## Details

**Current state (what's proven):**
- Single-task finetune works end-to-end: `training-worker` (`$UNITREE_ROOT/training-worker`, `neodem-train` conda env) claims a job → materializes the dataset from moto-S3 → runs GR00T-N1.7 finetune → tars checkpoint (`gr00t_finetune.tar.gz`, ~8GB) → uploads to `s3://model-checkpoints/<jobid>/` → POSTs `/api/training/workers/complete` → resumes polling. Verified 2026-07-06 (job `4928e83a-…`).
- Closed-loop sim eval works: `$UNITREE_ROOT/_ft_out/eval_g1_sim_groot_rec.py` connects a served GR00T server (PolicyClient/TCP) to Isaac Sim (unitree_sim_isaaclab, DDS domain 1) and drives the G1 EDU 29 DoF + Dex3. Obs already carries `language: {"annotation.human.task_description": [[<task>]]}`.
- ⚠ Serve path bypasses our `vla-server` gRPC wrapper (raw GR00T `run_gr00t_server`). Closing that gap is a separate follow-up, not part of this task.

**Source datasets — Unitree `G1_Dex3` collection (13 datasets, all 28-dim state/action, 4 cameras, 30 fps, teleoperated):**

| # | Dataset (`unitreerobotics/…`) | Episodes | Frames | LeRobot ver |
|---|---|---:|---:|:--:|
| 1 | G1_Dex3_PickApple_Dataset | 201 | 152,569 | v2.1 |
| 2 | G1_Dex3_PickBottle_Dataset *(already trained)* | 202 | 176,774 | v2.1 |
| 3 | G1_Dex3_PickGum_Dataset | 199 | 113,592 | v2.1 |
| 4 | G1_Dex3_PickSnack_Dataset | 200 | 163,487 | v2.1 |
| 5 | G1_Dex3_PickTissue_Dataset | 205 | 166,756 | v2.1 |
| 6 | G1_Dex3_PickDoll_Dataset | 203 | 300,557 | v2.1 |
| 7 | G1_Dex3_PickCharger_Dataset | 200 | 123,260 | v2.1 |
| 8 | G1_Dex3_ObjectPlacement_Dataset | 210 | 98,266 | v2.0 |
| 9 | G1_Dex3_Pouring_Dataset | 311 | 121,587 | v2.0 |
| 10 | G1_Dex3_CameraPackaging_Dataset | 201 | 256,253 | v2.0 |
| 11 | G1_Dex3_BlockStacking_Dataset | 301 | 281,196 | v2.0 |
| 12 | G1_Dex3_GraspSquare_Dataset | ~301* | ~281k* | v2.0 |
| 13 | G1_Dex3_ToastedBread_Dataset | 418 | 352,022 | v2.0 |
| | **TOTAL** | **~3,150** | **~2.6M** | mixed |

*GraspSquare returned metadata identical to BlockStacking from the HF fetch — verify its true counts on download.

**Why do this (expected outcome):**
- Primary win: **one checkpoint that performs all N tasks**, selected by the runtime language string ("pick up the apple" / "pour" / "stack the blocks") — not N separate one-trick checkpoints. This is what GR00T's architecture is for.
- Likely win: better robustness/generalization via shared representations + positive transfer across grasps (established for RT-2 / OpenVLA / GR00T's own multi-task pretraining recipe).
- NOT expected: a higher single-task PickBottle score in isolation — breadth/robustness is the gain, not per-task peak. Balanced sampling avoids diluting any one task.
- Cost caveat: multi-task needs far more optimization than our marginal 2000-step single-task run — budget **20k–60k steps** (multi-hour-to-overnight on the the GPU box). Under-training yields a worse jack-of-all-trades.

### Data prep (merge)

Key gotchas — these are the real work:
1. **Version normalization** — 7 sets are LeRobot **v2.1**, 6 are **v2.0**. Normalize all to a single codebase version before concatenating (target **v3.0** to match our `vla-training` pipeline; use LeRobot's v2.0→v2.1→v3.0 conversion scripts). These are already LeRobot datasets on HF, so the JSON→LeRobot ingest step is skipped — just download + version-convert + merge.
2. **Preserve per-task language labels** — every source set is `total_tasks: 1`, so on merge each episode's `annotation.human.task_description` / `tasks.jsonl` must be **namespaced** so "pick apple" ≠ "pick bottle" ≠ "pour". Assign a clear instruction string per source dataset. This is the field GR00T conditions on — get it right or multi-task selection fails.
3. **Camera key alignment** — confirm all 13 use the same `observation.images.*` keys and the same 4-camera rig (same rig expected, but verify; a rename breaks the merged modality config).
4. **robot_type label drift** — some sets report `Unitree_G1_Dex3`, some `Unitree_G1`; state/action dims are identical (28), so it's cosmetic, but pick one canonical `--robot_type` for conversion/finetune consistency.
5. **Task balance** — ToastedBread (418 ep) ≈ 2× Gum (199 ep); use balanced/weighted sampling so large sets don't dominate.

### Training

- Reuse the proven `training-worker` GR00T-N1.7-3B finetune path (gated `nvidia/Cosmos-Reason2-2B` backbone reconstructed from HF cache — do NOT re-accept the license or fabricate creds).
- Build the merged `g1_dex3` modality config (single unified config across all tasks); reuse the self-built config from `vla-training` as the base.
- Long run: 20k–60k steps, checkpoint periodically. Register the merged dataset in NeoDEM and launch via the app so it's visible in the Training UI (same flow as the PickBottle run).

### Eval

- Serve the single checkpoint (`python -m gr00t.eval.run_gr00t_server --model-path <dir> --embodiment-tag new_embodiment` in `groot` env).
- Run the Isaac closed-loop bridge (`eval_g1_sim_groot_rec.py`, DDS domain 1) **once per task**, swapping only the `--task` instruction string, and record a rollout mp4 per task. Compare qualitatively against the single-task PickBottle baseline.
- ⚠ DDS domains: 0 = real robot, 1 = simulation — never mix. Watch for the half-dead-sim trap (crashed `sim_main.py` leaves the renderer up while DDS publish is dead) — gate the eval on the "start controller success" marker; diagnose with `dds_probe.py` (zero rt/lowstate on domain 1 = dead).

### Suggested phasing

- **Phase A (proof):** merge only the **7 `Pick*` tasks** (all v2.1, most homogeneous, ~1,410 ep). Cleanest multi-task proof; no v2.0↔v2.1 conversion needed.
- **Phase B (full):** expand to all 13 (adds v2.0 conversion + the non-Pick tasks: pour/stack/place/package/toast).

**Key files / locations:**
- Merge/convert: new script under `$UNITREE_ROOT/vla-training` (reuse its Dex3 v3.0 conversion + modality-config tooling); `unitree_lerobot` for download helpers.
- Train: `$UNITREE_ROOT/training-worker` (`neodem-train` env); NeoDEM `app/src/features/training` + `server` training routes for UI-driven launch + visibility.
- Eval: `$UNITREE_ROOT/_ft_out/eval_g1_sim_groot_rec.py`, `$UNITREE_ROOT/_ft_out/rollout/`.
- Source datasets: HF `unitreerobotics/G1_Dex3_*` (table above).

## Validation evidence (Phase A executed 2026-07-11 on GPU_BOX)

**Data prep (gotchas resolved differently than scoped — the HF table above was stale):**
- All 7 `Pick*` repos now serve **LeRobot v3.0 on main** (Unitree migrated them) — no v2.0/v2.1 normalization needed. Each ships a distinct natural-language instruction already ("Put the apple/bottle/gum/snack/tissue paper/doll/charger into the plate.") — no label namespacing needed. All are 2-cam (`cam_left_high`/`cam_right_high`, the wrist cams were dropped in the migration), 28-dim, `Unitree_G1_Dex3`, 30 fps.
- Merge: lerobot 0.6.0 `aggregate_datasets` (official; pyav concat, no re-encode) → `$UNITREE_ROOT/_ft_out/multitask/merged/G1_Dex3_Pick7_Merged`, **1,410 episodes / 1,196,995 frames / 7 tasks**, validated by loading frames across sources. Script: `$UNITREE_ROOT/_ft_out/multitask/merge_pick7.py`.
- v3.0→v2.1 for GR00T: unmodified NVIDIA `convert_v3_to_v2.py` (groot env + lerobot_shim + staged ffmpeg, ~4 min) + hand-written 2-cam `meta/modality.json` (the proven PickBottle one — dataset-agnostic). 1,410 parquets + 2,820 mp4s, 7-entry `tasks.jsonl`, `task_index` spread verified.
- Staged to RustFS `datasets/32708700-9f1d-4b6a-8de6-15f9fc855fd1/` (24.16 GB, 4,236 objects) + Dataset row `b58563f0-594e-4e25-aeda-a4a818c78ab4` ("G1_Dex3_Pick7_Merged (v2.1, GR00T multi-task)").

**Training (through the platform):** TrainingJob `ad72e95e-c025-40fa-b6bf-1a2722139ad7` via `POST /api/training/jobs` — `groot_n1_7`, same recipe as the 2000-step baseline (global batch 1, lr 1e-4, warmup 500) scaled to **max_steps 14,000** = per-task sample parity (~2,000 samples/task). Worker `Gr00tTrainer` (Isaac backend) consumed the multi-task v2.1 set with zero code changes (`task_index` → `annotation.human.task_description` flows through). 8h49m wall, ~2.45 s/step, 31.9 GB VRAM, live loss 1.25→~1.09–1.16 in the UI, slim ~12 GB checkpoint artifact `gr00t_finetune.tar.gz` → RustFS, job completed.

**Open-loop A/B (12 trajs each, Isaac open_loop_eval protocol, harness `_ft_out/ab_eval/lerobot_groot_openloop.py`, results in `_ft_out/ab_eval/results.json`):**

| Eval dataset | multitask-14000 MSE/MAE | isaac-2000 MSE/MAE |
|---|---|---|
| PickBottle (baseline's own task) | **0.4036 / 0.4943** | 0.4258 / 0.5141 |
| PickApple | **0.3936 / 0.4879** | 0.4474 / 0.5273 |
| PickGum | **0.3795 / 0.4751** | 0.4484 / 0.5277 |

The multi-task checkpoint **wins on every task including PickBottle itself** (test #4 "no regression" exceeded). Own-stats control (merged-dataset stats, bottle episodes): 0.4023 — no normalization artifact.

**Closed-loop sim:** live Isaac PickPlace-Cylinder G129-Dex3 scene + multi-task ckpt served on :6555; rollouts recorded with the instruction as the only variable (bottle vs apple) → `_ft_out/rollout/sim_groot_closedloop_mt14000_{bottle,apple}.mp4`. Note: the sim scene only contains a cylinder, so per-task *object* appropriateness (test #3 as scoped) cannot be observed in sim; the quantitative per-task language-conditioned open-loop eval above is the multi-task selection evidence.

**Open follow-ups:** Phase B (expand to all 13 sets — the 6 non-Pick sets are 4-cam, so the merge needs camera-key reconciliation or a 4-cam modality config); longer runs (per-task parity ≠ per-task optimum); closed-loop scenes with per-task objects.

## Test Strategy

1. **Merge validity:** merged LeRobot dataset loads; `total_tasks == N` (7 for Phase A, 13 for Phase B); each task's `annotation.human.task_description` is present and distinct; frame/episode counts equal the sum of sources (±known drift); passes the server dataset-validation worker.
2. **Training completes end-to-end through our repo:** job runs via `training-worker`, produces `gr00t_finetune.tar.gz`, uploads to moto-S3, POSTs `/complete` → 200, appears finished in the NeoDEM Training UI.
3. **Multi-task selection works in sim:** serve the one checkpoint; run the Isaac closed-loop eval for ≥3 distinct tasks by changing only the instruction string; each produces a rollout mp4 showing task-appropriate behavior (bottle vs apple vs pour differ). This is the core acceptance signal: **one checkpoint, language-selected behavior.**
4. **No regression:** the merged checkpoint still performs "pick up the bottle" comparably to the single-task baseline.
