---
id: "TASK-479"
aliases: []
title: "Episodes past the first chunk open in a locally stored dataset"
slug: "episodes-past-the-first-chunk-open-in-a-locally-stored"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# Episodes past the first chunk open in a locally stored dataset

## Description

LeRobot v2.1 stores episode N under `chunk-{floor(N / chunks_size)}` (`chunks_size` from
`meta/info.json`, default 1000), and this repo's own v3.0 -> v2.1 converter
(`server/curation/lerobot_v3_to_v2.py`) writes `chunk-001` for episodes 1000 and up. The
readers of a dataset on the server's disk assume `chunk-000` for every episode, so
episode 1000+ of a local dataset answers 404 for its frames and its video, and curation
of such a dataset cannot read the episode at all.

## Details

### Current state (main, 64c03875)

- `server/src/routes/datasets.routes.ts` — `readLocalFrames` joins `data/chunk-000/…`,
  `streamLocalVideo` tries `videos/<key>/chunk-000/…` and `videos/chunk-000/<key>/…`.
- `server/src/services/DatasetCurationService.ts` — `sampleEpisodeFrames` replaces
  `{episode_chunk:03d}` with `000`.
- `server/curation/curate.py` — `_episode_parquet` / `_video_path` format the templates
  with `episode_chunk=0`; `_rebuild` writes every output parquet to `data/chunk-000`,
  sets `total_chunks: 1` and `_compute_stats` globs only `data/chunk-000`.
- The RustFS frames reader (`RemoteDatasetReader.readV2Frames`) already resolves the
  chunk from `chunks_size` and the `data_path` template; the RustFS video route uses a
  literal 1000.
- Not affected: the episode list and the frame-count reader (`meta/episodes.jsonl`
  only), `validateDataset` (already chunk-aware), `DataQualityService` (no file paths),
  `DatasetViewService.materialize` (drives `curate.py`).

### Approach

One helper, `server/src/services/lerobot/episodePaths.ts`, owns "where is episode N":
`chunks_size`, the `data_path` / `video_path` templates and the two video directory
orders in use (chunk-first, key-first). The local readers read `meta/info.json` from the
directory they serve (a v3.0 dataset is served from its converted v2.1 view, whose
`info.json` differs from the record's), and keep `chunk-000` as a last candidate so a
tree written before the converter was fixed still opens. `curate.py` gets the same rule
for reading and writing.

## Acceptance Criteria

- [x] Frames of an episode in `chunk-001` of a local dataset are returned
      (`datasets-local-chunks-routes.test.ts`, fixture with `chunks_size: 2`).
- [x] Video of an episode in `chunk-001` of a local dataset streams, in both directory
      orders (same test file).
- [x] A local tree that keeps every episode in `chunk-000` while declaring a smaller
      `chunks_size` still opens (same test file).
- [x] A `data_path` / `video_path` template that leaves the dataset directory is not
      followed (same test file, `episodePaths.test.ts`).
- [x] The remote reader and the local reader resolve paths through one helper
      (`episodePaths.ts`, used by `RemoteDatasetReader`, the routes and
      `DatasetCurationService`).
- [x] The VLM frame sampler finds the video of an episode past the first chunk
      (`episodePaths.test.ts` covers the path it builds).
- [x] `curate.py` deletes, trims and suggests across chunks and writes its output in the
      chunks its `info.json` declares (`test_curate.py`, `chunks_size: 2`).

## Notes

- The RustFS video route took the same shortcut with a literal 1000; it now asks the
  helper too (`datasets-video-routes.test.ts`). Hub datasets all use 1000, so this only
  shows for a dataset written with another `chunks_size`.
- `sampleEpisodeFrames` has no test of its own (it is private and shells out to ffmpeg);
  the path it builds is the helper's.
- Not changed: `make_synthetic_dataset.py`, `cosmos3_synth.py` and `neural_traj/convert.py`
  write `chunk-000` only. They generate a handful of episodes; past 1000 they would need
  the same rule.
- Gates (2026-11-13): server `tsc --noEmit` clean, vitest 303 files / 7394 passed,
  `server/curation` pytest 53 passed, 1 skipped (lerobot backend not installed).
