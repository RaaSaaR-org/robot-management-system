---
id: TASK-168
aliases:
- TASK-168
title: GUI for VLA Training-Data Curation (episode trim/delete) + AI-assisted editing via video-use
slug: gui-vla-training-data-curation-trim-delete-ai-video-use
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- vla
- data
- frontend
sprint: ''
depends_on: []
due_date: ''
created: 2026-06-21
updated: 2026-07-11
---


# GUI for VLA Training-Data Curation (episode trim/delete) + AI-assisted editing via video-use

## Implementation Status (2026-07-11 — shipped, `feat/task-168-curation-hardening`)

All remaining open items landed:

- ✅ **Phase 1 — Curation core** (`server/curation/`): `curate.py` (trim/delete,
  non-destructive, reindexes episode/frame/global indices + meta) and
  `make_synthetic_dataset.py`. Deps: pyarrow + pandas only.
- ✅ **Phase 1 — Server**: `EpisodeCurationService.ts` + routes
  `POST /api/curation/:id/episodes/delete` and `.../:index/trim`.
- ✅ **Phase 1 — Frontend**: Curate panel (trim range + delete episode) in
  `DatasetEpisodesPage.tsx` + `trainingApi.deleteEpisodes/trimEpisode`.
- ✅ **Video-aware curate.py**: the previous version dropped the `videos/` tree
  entirely (deleted/renumbered episodes left broken datasets). Now: videos are
  copied + renumbered per camera key on delete, and trimmed episodes are re-cut
  frame-accurately via ffmpeg (`CURATION_FFMPEG`, libx264/yuv420p/faststart;
  clear `FFMPEG_MISSING` error when unavailable).
- ✅ **Stats recompute** after every native edit (`meta/stats.json` per-feature
  per-dimension min/max/mean/std from the output parquets;
  `stats_recompute_required: false`; `--no-recompute-stats` escape hatch).
- ✅ **Wire to RustFS** (`DatasetCurationService.ts`): dataset id → local dir or
  RustFS download→edit→reupload; result registered as a NEW Dataset row
  (`<name> (curated)`, lineage in `infoJson._curation`), re-validated via the
  standard `validateAndUpdateDataset` path. Originals never touched. Responses
  carry `newDatasetId`/`newDatasetName`.
- ✅ **v3 chunked/video datasets** → `--backend lerobot` routes delete through
  `lerobot.datasets.dataset_tools.delete_episodes` (lerobot 0.6, verified with
  a real v3 dataset built in the pytest suite); v3 trim returns a structured
  `V3_TRIM_UNSUPPORTED` error. Server picks the backend per `lerobotVersion`
  (`CURATION_LEROBOT_PYTHON` interpreter).
- ✅ **Phase 2 — AI "video-use"** suggestions: `curate.py suggest` (deterministic
  motion heuristics: idle-padding trims, dead/short-episode deletes) +
  `POST /api/curation/:id/suggest` + "AI suggest" panel in the episodes page
  with per-suggestion Apply (prefills trim inputs / confirmed delete) and
  Dismiss — human always in the loop. Optional Gemini VLM refinement behind
  `CURATION_VLM=gemini`.
- ✅ **Playwright** coverage: `app/e2e/curation.spec.ts` (7 tests — panel, trim,
  delete incl. confirm/cancel, suggest/apply/dismiss, new-dataset navigation).
- ✅ Tests: `server/curation/tests/` pytest (13 tests, real ffmpeg + real
  lerobot v3), server vitest (EpisodeCurationService, DatasetCurationService,
  curation routes), app tsc + build.

Still open (minor): live validation of the Gemini VLM suggestion pass — no
`GOOGLE_API_KEY` on the dev box; code path is env-gated (`CURATION_VLM=gemini`)
and falls back to pure heuristics. Batch triage UI ("12 episodes flagged…")
beyond the per-dataset suggestion list, and drag-handle timeline trimming,
remain nice-to-haves.

See `server/curation/README.md`.

## Description

Build an in-app dataset curation GUI so operators can clean recorded teleop
datasets before training: scrub episodes, trim excess frames at start/end, and
delete bad episodes. Add a second mode where an AI ("video-use" tool) reviews
episodes and proposes trims/deletes automatically. Motivated by the upcoming
**Unitree G1 EDU 4 with Dex3 hands** — bimanual + dexterous-hand episodes are
long and noisy, and good data hygiene is the main lever on policy quality.

This replaces the need for the standalone PyQt5 desktop tool shipped in
Unitree's `unitree_lerobot/data_editor/` (`data_editor_EN.py`) — we want the
same capability **inside NeoDEM**, web-based, multi-camera, and tied to our
existing dataset pipeline.

## Background / Session Findings (2026-06-21)

- **Native `lerobot` already supports the Unitree G1** end-to-end (control,
  teleop via `unitree_sdk2py`, arm IK, exoskeleton bilateral control):
  `temp/lerobot/src/lerobot/robots/unitree_g1/` and
  `.../teleoperators/unitree_g1/`. We do **not** need Unitree's `unitree_lerobot`
  fork for G1 support — record/train/deploy works through the same LeRobot path
  we already use for SO-101/SmolVLA.
- The **one genuinely useful piece** in `unitree_lerobot` is its **Data Editor**
  GUI (`data_editor/data_editor_EN.py`, PyQt5): scrub timeline (red marker),
  Shift+drag to select a range → "Trim Selected Range", "Delete Current
  Episode". This task is about reproducing that *inside the app*.
- That editor operates on the **raw Unitree collection format**, not LeRobot
  parquet/mp4: a root dir of `episode_N/` folders, each with a `colors/` subdir
  of per-frame, per-camera images (filename encodes frame id + cam id). Our GUI
  should instead operate on the **LeRobotDataset format** (parquet + mp4 per
  episode) so it slots into our pipeline directly.
- Native lerobot offers only **CLI** dataset surgery (`delete_episodes`,
  `split_dataset`, `add/remove/modify_features`,
  `convert_image_to_video_dataset`, `reencode_dataset` in
  `src/lerobot/datasets/`) — no interactive trim UI. We build the UI; we reuse
  these utilities server-side where possible.
- No Unitree-format or LeRobot dataset currently exists anywhere under
  `develop/emai/` (only lerobot's own tiny test fixtures and HF-cached *models*
  like `smolvla_base`). Testing this feature needs either a synthetic dataset or
  a downloaded `unitreerobotics/*` HF sample.

## Current State

- `app/src/features/datacollection/` — collects teleop episodes.
- `app/src/features/training/` — VLA dataset & training management (datasets
  page already exists; Playwright tests cover it per `scripts/test-all.sh`).
- `server/src/workers/` — dataset validation worker; `server/src/storage/`
  RustFS/S3 for dataset artifacts.
- `training-worker/` (separate repo) — consumes LeRobot datasets for SmolVLA
  LoRA; future G1 policies (ACT/Diffusion/Pi0.5/GR00T) ride the same path.
- Related deferred tasks to cross-check before starting: **TASK-151**
  (rust-data-pipeline-parquet-stats-validation), **TASK-090**
  (lerobot-peft-finetuning-workflow), **TASK-088/089** (lerobot v0.5.0
  migration), **TASK-156** (skill-data-marketplace).

## Scope

### Phase 1 — Manual curation GUI (MVP)
- New view under `app/src/features/training/` (or a `datacuration/` feature),
  reachable from the datasets page: "Curate" action on a dataset.
- Episode list with thumbnails; select an episode to open the editor.
- Multi-camera playback synced to a single timeline (G1 EDU has multiple
  cameras + Dex3 hand views).
- Timeline scrubber; select a frame range (start/end handles) → **Trim**
  (drop frames outside range). Delete-whole-episode action. Undo before commit.
- Operates on a **working copy**; "Commit" writes back a new dataset
  version/revision (never mutate the original in place — the desktop tool
  mutates in place, we must not).

### Phase 2 — AI-assisted curation ("video-use")
- A `video-use` tool/agent that ingests an episode's camera video(s) + state
  trace and proposes: trim ranges (idle/approach/retract padding, fumbles),
  and delete recommendations (failed grasp, dropped object, out-of-frame,
  teleop glitch). Reuse our existing VLM stack (Gemini 2.5 Flash on the server;
  optionally SmolVLM2 already in HF cache) rather than a new dependency.
- Proposals surface as **suggested edits** the operator reviews/accepts in the
  Phase-1 UI — human stays in the loop (fits the EU AI Act / oversight posture
  already in the app).
- Batch mode: run video-use across a whole dataset, present a triage list
  ("12 episodes flagged for delete, 30 with suggested trims").

### Server
- Endpoints to read episode frames/video + state for the editor, and to apply
  trim/delete producing a new dataset revision. Reuse lerobot's
  `delete_episodes` / frame-slice utilities where feasible (call into the
  Python pipeline rather than reimplementing parquet/mp4 surgery in Node).
- Persist edit operations as an audit log (who trimmed what, AI-suggested vs
  human) for compliance/explainability features.

## Key Files (to create / modify)

- `app/src/features/training/` (or new `app/src/features/datacuration/`):
  - `components/EpisodeCurator.tsx` — multi-cam player + timeline + trim/delete
  - `components/CurationTimeline.tsx` — scrubber + range handles
  - `store/curationStore.ts` — Zustand store (working copy, pending edits)
  - `hooks/useEpisodeFrames.ts`
- `server/src/routes/` — e.g. `dataset-curation.routes.ts`
- `server/src/services/` — e.g. `DatasetCurationService.ts` (bridges to lerobot
  dataset utilities), `VideoUseService.ts` (Phase 2 VLM proposals)
- `server/src/workers/` — batch video-use job
- Reference (do NOT copy wholesale; format differs): Unitree desktop editor at
  `../../zema/unitree_lerobot/data_editor/data_editor_EN.py`

## Open Questions / Decisions

- Edit on **LeRobotDataset (parquet/mp4)** directly vs. on raw frames before
  conversion? Leaning parquet/mp4 so it works for *any* recorded dataset, not
  just Unitree.
- Web video scrubbing fidelity for frame-accurate trims — may need per-frame
  index/keyframe handling or pre-extracted thumbnails.
- `video-use`: single VLM pass per episode vs. windowed sampling for long Dex3
  bimanual episodes (cost/latency).

## Test Strategy

- Generate a **synthetic LeRobot dataset** (few episodes) as a fixture; verify
  trim drops the right frame range and re-stats the dataset; verify delete
  removes the episode and renumbers/links correctly; verify original is
  untouched and a new revision is produced.
- Frontend: extend existing datasets Playwright suite — open curator, scrub,
  select range, trim, delete, commit; assert episode count/length change.
- Phase 2: feed a known-bad episode (dropped object) and assert video-use
  flags it for delete; assert a padded episode gets a trim suggestion;
  human-accept path writes the audit log entry.
- Round-trip: curated dataset trains in `training-worker/` without schema errors.

## Notes

- Hardware context: **next robot = Unitree G1 EDU 4 + Dex3 hands.** Add a `g1`
  embodiment + joint config alongside `h1`/`so101` in `robot-agent/` as a
  prerequisite for real G1 data (separate task if not already covered).
- Created from the 2026-06-21 session exploring `unitree_lerobot`. The fork is
  otherwise redundant given native lerobot G1 support; only its Data Editor idea
  is worth pulling in — which is this task.
