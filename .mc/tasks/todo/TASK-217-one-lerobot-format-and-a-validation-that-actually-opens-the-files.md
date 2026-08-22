---
id: TASK-217
aliases:
- TASK-217
title: One LeRobot format, and a validation that actually opens the files
slug: one-lerobot-format-and-a-validation-that-actually-opens-the-files
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on: []
due_date: ''
created: 2026-08-22
updated: 2026-08-22
---


# One LeRobot format, and a validation that actually opens the files

## Description

A dataset this platform produces cannot be viewed, trimmed or curated by this
platform, and a dataset that is structurally broken is marked `ready` anyway.
Settle on v3.0 as the format we write, bring the v3→v2.1 converter into the repo
so the viewer and curation keep working, and make validation open the files it
claims to validate.

## Details

### Why now — what already exists (verified 2026-08-22, `main` @ `5673e731`)

**The format split, precisely.**

| Capability | v2.1 | v3.0 |
|---|---|---|
| Local-dir episode/frame/video serving (`datasets.routes.ts:89,119,153`) | ✅ | ❌ |
| RustFS episode listing + video windows (`:829,864-880`) | partial | ✅ |
| Written by `LeRobotExportService` | – | ✅ (`LEROBOT_CODEBASE_VERSION = 'v3.0'`, line 86) |
| Written by `curation/neural_traj/convert.py`, `cosmos3_synth.py` | ✅ | – |
| Curation **trim** (`DatasetCurationService.ts:131`) | ✅ | ❌ `V3_TRIM_UNSUPPORTED` |
| Curation **suggest** (`:177`) | ✅ | ❌ `V3_SUGGEST_UNSUPPORTED` |
| `register-local-dataset.ts` | ✅ | ❌ hard-rejects `v3` at line 45-47 |

So the teleop export writes v3.0, and v3.0 is exactly the version that cannot be
trimmed, cannot be suggested against, and cannot be registered from a local
directory. The datasets this platform produces are the ones it handles worst.

The conversion step that fixes this **is not in the repo**: `convert_v3_to_v2.py`
lives in an external `Isaac-GR00T` checkout, is run by hand in PowerShell with a
manually PATH-ed `ffmpeg.exe`, and `docs/vr-teleop-data-collection.md` calls it
mandatory. `register-local-dataset.ts:13` points at it.

There is also **no v2.0 handling anywhere** — the only version tests in the
codebase are `startsWith('v2')` and `startsWith('v3')`.

**Validation does not validate.** `DatasetService.validateStructure()`
(`server/src/services/DatasetService.ts:433-522`) checks that `meta/info.json`
exists in the RustFS `training-datasets` bucket and that four of its fields are
present. That is the whole check. It does **not**:

- confirm any file named in `info.json` exists — no parquet, no video
- cross-check episode counts against `meta/episodes.jsonl`
- check dimensions against `RobotType.actionDim` / `proprioceptionDim`
- require any image feature — a state-only dataset scores fine and then fails at
  training time with *"All image features are missing from the batch"*
  (`docs/training-pipeline-testing.md`)
- work at all for local-disk datasets, which bypass validation entirely and are
  registered `status: 'ready'` directly

`computeQualityScore()` (`:660`) has a diversity term that is literally
`episodes > 10 ? 16 : 8`.

**Several endpoints are stubs that return success.**

| Endpoint | File:line | Behaviour |
|---|---|---|
| `PATCH /:id/episodes/:index/flag` | `datasets.routes.ts:1143` | returns `{success:true}`, stores nothing |
| `POST /:id/validate-advanced` | `:1252` | returns `{status:'queued'}`, does nothing |
| `GET /:id/flagged` | `:1300` | always `[]` |
| `POST /:id/trajectories/:idx/unflag` | `:1333` | same as flag |
| `GET /:id/trajectories/:idx/metrics` | `:1219` | placeholder |

**And an upload path that cannot succeed.** `initiateUpload` presigns a single
tarball `<id>/data.tar.gz` (`DatasetService.ts:337`), but `validateStructure`
then looks for `<id>/meta/info.json` as an unpacked tree. **Nothing extracts the
tarball.** The browser upload modal
(`app/src/features/training/components/DatasetUploadModal.tsx`, accepts
`.tar.gz`/`.tgz`/`.zip`) therefore always ends in `status: failed` unless RustFS
already holds an unpacked tree.

**Two more findings worth fixing while in here.**
`DatasetRepository.update` (`server/src/repositories/VLARepository.ts:682-694`)
does not accept `fps`, `totalFrames`, `totalDuration` or `demonstrationCount`, so
`validateAndUpdateDataset` cannot write back what it computes — there is a dead
comment at `DatasetService.ts:583-588` saying exactly this. And
`datasets.routes.ts:513` hardcodes an absolute conda python path for the
HF-push path.

### How it is done in 2026 (research summary, links are the sources)

**v3.0 is where LeRobot went.** `unitree_lerobot` v0.3 targets dataset v3.0 and
uses the v3.0 API (`dataset.meta.episodes["dataset_from_index"]`); the public
Unitree G1 datasets and the Pi0 / Pi05 / GR00T recipes in
[`unitree_lerobot`](https://github.com/unitreerobotics/unitree_lerobot) are built
on it. v3.0's structural change is aggregation: many episodes per parquet file
and per mp4, addressed by `from_timestamp`/`to_timestamp` windows, instead of
v2.1's one-file-per-episode. That is why our v2.1 readers cannot simply be
pointed at a v3.0 tree — the per-episode paths do not exist.

**The most complete version-aware path logic we already have** is
`HuggingFaceImportService.resolveFileList()`
(`server/src/services/HuggingFaceImportService.ts:307-440`): v3 needs
`meta/tasks.parquet` + `meta/episodes/chunk-xxx/file-xxx.parquet` with videos at
`videos/{key}/chunk-{c}/file-000.mp4`; v1/v2 uses
`videos/chunk-{c}/{key}/episode_{e}.mp4`. Reuse it rather than writing a third
version-detection path.

### Design decisions (settled — do not re-litigate during implementation)

1. **v3.0 is the format we write.** Every writer converges on it.
2. **v2.1 is a derived view, not a second truth.** The converter runs on demand
   and its output is cache, deletable and regenerable. It is never the thing a
   `Dataset` row points at as its storage of record.
3. **The converter comes into the repo.** A mandatory pipeline step that lives in
   someone's external checkout is not a pipeline. Port it as
   `server/curation/lerobot_v3_to_v2.py` next to the converters already there.
4. **Validation opens files.** If `info.json` names a parquet, validation reads
   its footer. If it names a video, validation stats it. Anything less is a
   spell-check on a manifest.
5. **A stub endpoint is worse than a 501.** Endpoints that return success without
   doing anything either get implemented here or start returning
   `501 Not Implemented`. The UI is currently being lied to.
6. **Nothing silently upgrades an existing dataset row.** Datasets already
   registered keep their declared version; the converter and the validator both
   handle what is on disk.

### Server

**Converter.** `server/curation/lerobot_v3_to_v2.py` — v3.0 tree in, v2.1 tree
out: split aggregated parquet into `data/chunk-000/episode_NNNNNN.parquet`, cut
each episode's video window into
`videos/observation.images.<key>/chunk-000/episode_NNNNNN.mp4` with ffmpeg,
rewrite `meta/`. `server/curation/neural_traj/convert.py` is the reference for
the v2.1 shape it must produce; it already writes exactly this layout.
Fail loudly and specifically when ffmpeg is absent — `FFMPEG_MISSING` is already
a structured error the UI surfaces.

**Serving.** `datasets.routes.ts` local-dir reads (`isLocalDataset`,
`readLocalEpisodes`, `readLocalFrames`, `streamLocalVideo`) either learn v3.0
directly or trigger the converter into a cache dir on first read. Prefer the
converter-with-cache: one code path stays authoritative, and the v2.1 readers are
already tested.

**Curation.** With a v2.1 view available, `V3_TRIM_UNSUPPORTED` and
`V3_SUGGEST_UNSUPPORTED` stop being dead ends. Decide explicitly whether a trim
edits the v3.0 truth and regenerates the view, or produces a new dataset — and
write the decision into `DatasetCurationService`'s header, which already carries
the lineage note.

**Registration.** `register-local-dataset.ts` accepts v3.0. Its hard reject at
line 45-47 exists only because nothing downstream could read v3.0.

**Validation.** Rewrite `validateStructure()` to:

- resolve the file list through the same version-aware logic as
  `HuggingFaceImportService.resolveFileList()`
- confirm every listed file exists, with a non-zero size
- read each parquet footer: row count, column names, dtypes
- cross-check total rows against `info.json` `total_frames` and episode count
  against `meta/episodes.jsonl`
- check `observation.state` / `action` widths against
  `RobotType.proprioceptionDim` / `actionDim` and report a mismatch as an error,
  not a warning
- **warn loudly when there is no `observation.images.*` feature** — this is the
  failure that currently only shows up hours later inside a training job
- run for local-disk datasets too, not only RustFS

Replace the `episodes > 10 ? 16 : 8` diversity term with something derived from
the data, or drop the term and say the score has three components. A fake
component is worse than a missing one.

**Write-back.** Extend `DatasetRepository.update` to accept `fps`,
`totalFrames`, `totalDuration`, `demonstrationCount` and delete the dead comment
at `DatasetService.ts:583-588`.

**Upload.** Either extract the tarball server-side after
`upload/complete`, or change the presigned flow to per-file uploads of an
unpacked tree. Do not leave a modal in the UI whose only outcome is `failed`.

**Stubs.** Implement episode flagging against a real table (there is no `Episode`
model — decide whether to add one or key flags on `(datasetId, episodeIndex)`
the way `EpisodeReward` already does at `schema.prisma:2364`), or return `501`.

### Frontend

- Surface the real validation report rather than the reconstructed approximation
  in `DatasetService.toResponse` (`:809-819`).
- Show the "no image features" warning on the dataset card. That one line would
  have saved a training run.
- If flagging returns `501`, hide the control rather than showing one that lies.

## Acceptance Criteria

- [ ] A v3.0 dataset produced by `LeRobotExportService` opens in the episode
      viewer, plays video, and can be trimmed.
- [ ] `register-local-dataset.ts` registers a v3.0 directory.
- [ ] `lerobot_v3_to_v2.py` round-trips a fixture dataset: episode count, frame
      counts per episode and video durations all match the source.
- [ ] Validation fails a dataset whose `info.json` names a parquet that is not
      there — today it passes.
- [ ] Validation fails a dataset whose `observation.state` width disagrees with
      its `RobotType.proprioceptionDim`.
- [ ] Validation warns, visibly in the UI, on a dataset with no image features.
- [ ] Validation runs for a local-disk dataset.
- [ ] `fps`, `totalFrames`, `totalDuration` and `demonstrationCount` computed
      during validation are persisted.
- [ ] The tarball upload path either works end to end or the modal is gone.
- [ ] Every endpoint that used to return `{success:true}` without acting either
      acts or returns `501`.

## Test Strategy

**Fixtures first.** `server/curation/make_synthetic_dataset.py` already generates
v2.1 test datasets with real mp4s via ffmpeg. Extend it to emit v3.0, and build
the deliberately-broken variants from it: missing parquet, truncated video,
wrong state width, no image features, episode count mismatch. Those fixtures are
the test suite for this task.

**Converter.** Round-trip the v3.0 fixture and diff against the v2.1 fixture
generated from the same source: identical episode boundaries, identical frame
counts, video durations within one frame.

**Validator.** One test per broken fixture, each asserting the *specific* error —
a validator that fails everything for the wrong reason is not better than one
that passes everything.

**Regression.** The v2.1 read paths in `datasets.routes.ts` are the ones that
work today. They must keep working, whether they now read v3.0 directly or read
a converted cache.

**Manual.** Take a dataset produced by [[TASK-215]], view it, trim an episode,
and confirm the trimmed result still opens.

## Out of scope — v2, explicitly

- HDF5 and zarr. `outputFormat: 'lerobot_v3' | 'hdf5' | 'zarr'` is declared in
  the Isaac synthetic types and nothing produces any of them.
- Dataset versioning and lineage as first-class models. Today revisions are new
  `Dataset` rows with lineage in `infoJson._curation`; making that a real model
  is its own task.
- The hardcoded conda python at `datasets.routes.ts:513` — note it, file it,
  don't fix it here.
- Pushing to the Hugging Face Hub. Unchanged.

## Notes

Independent of [[TASK-215]] and [[TASK-216]] and can be done first. If it is done
first, 215 lands into a stack that can actually read what it writes, which is the
better order — the only reason it is not priority 1 is that 215 is what unblocks
training data, and a broken viewer is survivable while a missing dataset is not.

The recurring shape across all three of these findings is the same: a plan that
was made and half-built. `TeleoperationFrame.imagePath` with no writer. Five
endpoints returning success without acting. An upload flow whose two halves
disagree about what is in the bucket. A converter that the docs call mandatory
and that lives on one person's disk. None of these are bugs in the sense of
something that broke — they are seams where the work stopped.
