---
id: "TASK-354"
aliases: ["TASK-354"]
title: "Episodes and frames of a RustFS dataset read real data or fail"
slug: "episodes-and-frames-of-a-rustfs-dataset-read-real-data-or-fail"
status: "done"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core", "storage", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Episodes and frames of a RustFS dataset read real data or fail

## Description

`GET /datasets/:id/episodes` and `GET /datasets/:id/episodes/:index/frames`
return fabricated data with HTTP 200 for every RustFS-stored dataset that is
not LeRobot v3.0 with exactly one file per chunk. Make both endpoints read the
real LeRobot v2.1 and multi-file v3.0 layouts, and answer with an honest error
instead of synthetic data whenever they cannot.

## Details

### Current state

All in `server/src/routes/datasets.routes.ts`:

- **Local datasets** (`isLocalDataset(storagePath)`) are fine: `localReadRoot`
  (line ~86) converts a v3.0 tree to a v2.1 view, and `readLocalEpisodes`
  (~136) reads `meta/episodes.jsonl` / `meta/episodes.json`. Not in scope.
- **RustFS datasets, episodes** (`datasetRoutes.get('/:id/episodes')`, ~957):
  reads only `meta/episodes/chunk-000/file-000.parquet` via
  `readParquetFromRustFS` (~275) and `@dsnp/parquetjs`, collecting
  `length`/`episode_index` and the v3.0 per-camera
  `videos/observation.images.<cam>/{from,to}_timestamp,chunk_index,file_index`
  windows. If that file is absent or unreadable, the catch only logs, and the
  fallback (~1033) emits `info.total_episodes` episodes each of
  `floor(total_frames / total_episodes)` frames.
- **RustFS datasets, frames** (`/:id/episodes/:index/frames`, ~1059): reads only
  `data/chunk-NNN/file-000.parquet` (chunk = `episodeIndex / chunks_size`) and
  filters rows by `episode_index`. On a miss, the fallback (~1139) generates
  sine/cosine `observationState` and `action` arrays — 6 values regardless of
  the robot's real width.
- Effect on the production demo dataset `nvidia/GR00T-N1.7-AppleToPlate`
  (v2.1: `meta/episodes.jsonl`, `data/chunk-000/episode_NNNNNN.parquet`):
  402 episodes x 426 frames (real lengths vary and sum to 171625) and sine-wave
  joint plots, all served as 200. A v3.0 dataset whose chunk is split into
  `file-001.parquet…` gets the same treatment past `file-000`.
- Found by the TASK-351 k3d end-to-end test (`scripts/e2e-k3d/test.sh`), which
  checks that episode lengths sum to `total_frames` and are not all equal.

### Server

1. **Pick the reader by `info.json` `codebase_version`** (already loaded in
   both handlers as `info`).
2. **v2.1 episodes:** read `meta/episodes.jsonl` from RustFS (one JSON object
   per line: `episode_index`, `length`, `tasks`). Reuse the line parsing in
   `readLocalEpisodes` rather than writing a second parser — extract it into a
   helper that takes the file contents.
3. **v2.1 frames:** read the per-episode file named by `info.data_path`
   (default `data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet`,
   `episode_chunk = floor(episode_index / chunks_size)`); every row belongs to
   that episode, so no filtering is needed.
4. **v3.0 multi-file:** list the objects under `meta/episodes/` and
   `data/chunk-NNN/` (the storage client in `server/src/storage/` lists by
   prefix) and read every `file-*.parquet`, not just `file-000`. For frames,
   the episodes parquet carries `data/chunk_index` and `data/file_index` per
   episode — use them to open the one file holding the episode when present.
5. **Never fabricate.** Delete both fallbacks. When the layout is unknown or a
   read fails, answer an error the UI can show: `404` with
   `{ error: 'Episode frames not found' }` for an episode index that does not
   exist, `422`/`502` with a message naming the file that could not be read
   otherwise. Log the underlying error with the dataset id.
6. Keep the response shapes (`{ episodes: EpisodeMeta[] }`,
   `{ frames: FrameData[], total }`) unchanged; `total` must be the episode's
   real frame count, not the page size.

### Frontend

Check that the episode browser and frame plot in
`app/src/features/training/` show the error message instead of an empty chart
when the endpoint returns non-2xx. No new UI beyond that.

### Key files

- `server/src/routes/datasets.routes.ts` — both handlers, the helpers above
- `server/src/routes/__tests__/` — new route tests (see `datasets-hf-routes.test.ts` for the mocking pattern)
- `server/src/storage/` — prefix listing, if no helper exists yet
- `scripts/e2e-k3d/test.sh` — no change expected; it is the acceptance check

## Acceptance Criteria

- [ ] A v2.1 RustFS dataset returns one episode per line of `episodes.jsonl` with its real `length`; lengths sum to `info.total_frames`.
- [ ] A v2.1 episode's frames come from its `episode_NNNNNN.parquet`, with the real `observation.state`/`action` widths.
- [ ] A v3.0 dataset whose chunk spans `file-000` and `file-001` returns every episode and the frames of an episode stored in `file-001`.
- [ ] No code path in either handler returns generated data; a missing or unreadable file yields a non-2xx with a message.
- [ ] `E2E_DATASET=nvidia/GR00T-N1.7-AppleToPlate scripts/e2e-k3d/test.sh` passes.

## Test Strategy

- Unit/route tests (vitest, `server/`) with small parquet fixtures for: v2.1
  per-episode files, v3.0 single-file, v3.0 two-file chunk, and a dataset with
  `info.json` but no episode metadata (expects non-2xx, no fabricated body).
- End-to-end against real RustFS in k3d:
  `scripts/e2e-k3d/run.sh` brings the cluster up; then
  `E2E_DATASET=nvidia/GR00T-N1.7-AppleToPlate scripts/e2e-k3d/test.sh` must
  pass the episodes check (402 episodes, distinct lengths summing to 171625)
  and the frames check; the default dataset run must still pass.
  Tear the cluster down afterwards (`scripts/e2e-k3d/down.sh`, or run with
  `run.sh --down`).
- `./scripts/test-all.sh --skip-pw` green.

## Notes

- Split out of TASK-351 (finding 3 in its notes).
