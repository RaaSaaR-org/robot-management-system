---
id: "TASK-355"
aliases: ["TASK-355"]
title: "Episode frames read the real parquet without exhausting server memory"
slug: "episode-frames-read-the-real-parquet-without-exhausting-server-memory"
status: "done"
priority: 1
owner: "claude"
projects: []
customers: []
tags: ["core", "storage", "datasets"]
sprint: ""
parent: ""
depends_on: []
spe: 4
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# Episode frames read the real parquet without exhausting server memory

## Description

Opening an episode of a large v3.0 dataset (unitreerobotics/G1_Dex3_BlockStacking_Dataset,
one 63 MB `data/chunk-000/file-000.parquet` with 281,196 rows in a single row group) kills the
server pod with an out-of-memory crash in the production-near k3d system. The frames route
downloads the whole file and materialises every row of every column as JS objects, which does
not fit in the ~240 MB heap that a 512Mi container gives Node.

## Details

**Current state.** TASK-354 (#380) already picks the layout from `codebase_version`, reads
v2.1 per-episode files and every v3.0 `file-NNN`, never fabricates frames, and reports `total`
as the episode length. What is left is memory:
`server/src/services/lerobot/RemoteDatasetReader.ts` `forEachParquetRow()` calls
`DatasetObjectStore.read()` (whole object) and `ParquetReader.openBuffer()` + `getCursor()`
with no column list, which decodes the whole row group (all columns) at once. Every request
repeats this — nothing is cached.

### Server

- A streaming parquet reader (`server/src/services/lerobot/parquetEpisodeRows.ts`):
  opens the footer through ranged reads, skips row groups whose `episode_index`
  statistics exclude the episode, reads only the needed columns (`observation.state`,
  `action`, `timestamp`, `frame_index`, `episode_index`), and decodes one page at a time,
  keeping only the episode's rows. Heap use is bounded by a page, not by the file.
  Pages wholly before the episode are stepped over on their header (level counts; a list
  column only when every row has the same width, verified on the rows read, else re-read),
  so a late episode does not cost decoding the whole column (21 s -> ~2 s at 500m CPU).
- `DatasetObjectStore` gains optional `stat(path)` and `readRange(path, offset, length)`;
  the RustFS store in `server/src/routes/datasets.routes.ts` implements them with
  `getMetadata` / `downloadRange`. Without them the reader falls back to one whole read.
- `meta/episodes/*.parquet` is read with column projection (the `stats/*` columns are skipped).
- A small LRU cache (TTL-bounded) of decoded episodes and of the v3 episode index, keyed by
  dataset id + `updatedAt`, so paging through an episode does not re-read storage.

### Helm

- `helm/neodem/values.yaml` `server.env.nodeOptions: "--max-old-space-size=384"`, wired to
  `NODE_OPTIONS` in `helm/neodem/templates/server-deployment.yaml`, so the heap uses the
  512Mi limit instead of V8's default.

### Key files

- `server/src/services/lerobot/parquetEpisodeRows.ts` (new)
- `server/src/services/lerobot/RemoteDatasetReader.ts`
- `server/src/routes/datasets.routes.ts`
- `helm/neodem/values.yaml`, `helm/neodem/templates/server-deployment.yaml`

## Acceptance Criteria

- [ ] Frames of a v3.0 episode are decoded page by page from only the needed columns; a
      test proves rows of other episodes and unrequested columns are never materialised and
      that row groups excluded by statistics are not read.
- [ ] Against a RustFS store with range support, the 63 MB G1 file is not downloaded whole.
- [ ] A second request for the same episode is served from the cache (no storage read).
- [ ] v2.1 and v3.0 frames are unchanged in content; `total` is the episode length.
- [ ] The G1 episode opens in the k3d system with the 512Mi limit and the pod does not restart.
- [ ] The chart sets `NODE_OPTIONS=--max-old-space-size=384` on the server.

## Test Strategy

- Vitest: `server/src/services/lerobot/__tests__/` (streaming reader, cache, existing
  RemoteDatasetReader tests stay green).
- Run against the k3d cluster (`k3d-neodem-e2e`): build the server image, load it, open
  G1 episode frames for early/late episodes and watch the pod's restarts and memory.
