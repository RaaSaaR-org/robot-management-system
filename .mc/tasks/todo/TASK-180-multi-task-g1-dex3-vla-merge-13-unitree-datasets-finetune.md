---
id: TASK-180
aliases:
- TASK-180
title: Multi-task G1 Dex3 VLA — merge 13 Unitree datasets and finetune one language-conditioned checkpoint
slug: multi-task-g1-dex3-vla-merge-13-unitree-datasets-finetune
status: todo
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
updated: 2026-07-10
status_note: 'Scoped from the single-task PickBottle proof (2000-step GR00T-N1.7 finetune, full-circle through training-worker + moto-S3 + Isaac sim eval). Next step: widen from 1 task to N via multi-task co-training. All 13 source datasets inventoried below.'
---


# Multi-task G1 Dex3 VLA — merge 13 Unitree datasets and finetune one language-conditioned checkpoint

## Description

We proved the full NeoDEM Collect→Train→Deploy→Evaluate loop end-to-end on a **single** task: a GR00T-N1.7-3B finetune on `unitreerobotics/G1_Dex3_PickBottle_Dataset` (202 ep), driven through the `training-worker` + moto-S3 + Isaac Sim closed-loop eval. GR00T is a **language-conditioned VLA** — it already takes a task string (`annotation.human.task_description`) at inference — so the same machinery scales to many tasks by finetuning on a **merged multi-task dataset**. This task: merge Unitree's 13 public **G1_Dex3** datasets into one LeRobot dataset with preserved per-task language labels, run a long multi-task GR00T finetune, serve the single resulting checkpoint, and eval each task in sim by swapping the instruction string.

## Details

**Current state (what's proven):**
- Single-task finetune works end-to-end: `training-worker` (`C:\Unitree\training-worker`, `neodem-train` conda env) claims a job → materializes the dataset from moto-S3 → runs GR00T-N1.7 finetune → tars checkpoint (`gr00t_finetune.tar.gz`, ~8GB) → uploads to `s3://model-checkpoints/<jobid>/` → POSTs `/api/training/workers/complete` → resumes polling. Verified 2026-07-06 (job `4928e83a-…`).
- Closed-loop sim eval works: `C:\Unitree\_ft_out\eval_g1_sim_groot_rec.py` connects a served GR00T server (PolicyClient/TCP) to Isaac Sim (unitree_sim_isaaclab, DDS domain 1) and drives the G1 EDU 29 DoF + Dex3. Obs already carries `language: {"annotation.human.task_description": [[<task>]]}`.
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
- Cost caveat: multi-task needs far more optimization than our marginal 2000-step single-task run — budget **20k–60k steps** (multi-hour-to-overnight on the RTX 5090). Under-training yields a worse jack-of-all-trades.

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
- Merge/convert: new script under `C:\Unitree\vla-training` (reuse its Dex3 v3.0 conversion + modality-config tooling); `unitree_lerobot` for download helpers.
- Train: `C:\Unitree\training-worker` (`neodem-train` env); NeoDEM `app/src/features/training` + `server` training routes for UI-driven launch + visibility.
- Eval: `C:\Unitree\_ft_out\eval_g1_sim_groot_rec.py`, `C:\Unitree\_ft_out\rollout\`.
- Source datasets: HF `unitreerobotics/G1_Dex3_*` (table above).

## Test Strategy

1. **Merge validity:** merged LeRobot dataset loads; `total_tasks == N` (7 for Phase A, 13 for Phase B); each task's `annotation.human.task_description` is present and distinct; frame/episode counts equal the sum of sources (±known drift); passes the server dataset-validation worker.
2. **Training completes end-to-end through our repo:** job runs via `training-worker`, produces `gr00t_finetune.tar.gz`, uploads to moto-S3, POSTs `/complete` → 200, appears finished in the NeoDEM Training UI.
3. **Multi-task selection works in sim:** serve the one checkpoint; run the Isaac closed-loop eval for ≥3 distinct tasks by changing only the instruction string; each produces a rollout mp4 showing task-appropriate behavior (bottle vs apple vs pour differ). This is the core acceptance signal: **one checkpoint, language-selected behavior.**
4. **No regression:** the merged checkpoint still performs "pick up the bottle" comparably to the single-task baseline.
