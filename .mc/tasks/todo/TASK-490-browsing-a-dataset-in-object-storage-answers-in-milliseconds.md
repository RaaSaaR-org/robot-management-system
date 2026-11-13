---
id: "TASK-490"
aliases: []
title: "Browsing a dataset in object storage answers in milliseconds and holds up under parallel requests"
slug: "browsing-a-dataset-in-object-storage-answers-in-milliseconds"
status: "review"              # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "performance", "storage", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# Browsing a dataset in object storage answers in milliseconds and holds up under parallel requests

## Description

Found on the demo instance (build 5ba4cf5) on 2026-11-13, on the path the demo
on 2026-11-16 walks. The episode list of the v3.0 bottle-sorting dataset
(80 episodes, a 21 KB answer) took 2.0–3.7 s **every time**; a first read of an
episode's frames about 3 s; at four in parallel lists took 2–7 s and frames
4–9 s; a burst of 150 requests at six in parallel took 194 s and nine of them
answered 504. The three v2.1 datasets on the same instance list in 0.11–0.18 s.

### Cause

Not one slow thing: nothing was remembered, and every read was made of far more
round trips to object storage than it had bytes to fetch.

Measured against a server built from `main` and a RustFS holding the same
dataset (`/mnt/data/rms-demo/g1-dex3-bottle-sorting-sim`), counting storage
calls per request:

| Request | Storage calls before | of which |
| --- | --- | --- |
| episode list, v3.0 | **143** | bucket probe, LIST `meta/episodes/`, 2 HEAD, 139 ranged GETs — for 200 KB of an 828 KB file |
| first frames of an episode, v3.0 | **155** | all of the above again, then 2 HEAD and 10 GETs on the data file |
| episode list, v2.1 | 3 | bucket probe, HEAD, GET |

- `meta/episodes/chunk-000/file-000.parquet` is 8 row groups × 127 columns. The
  reader (`parquetEpisodeRows.ts`, TASK-355) fetches one column chunk per
  request, one after another: 8 × 17 wanted columns = 136 GETs, plus three to
  open the file.
- The frames route for v3.0 re-read that whole table for every episode, to
  learn which data file holds it.
- Every `stat` and every `read` was preceded by an `exists` HEAD of its own,
  and every request probed which bucket the dataset is in.
- Only decoded frames were cached (TASK-355). The episode list was not.

Each call is cheap in bytes and expensive in CPU — SigV4 signing, an HTTP
exchange, XML/stream handling: a list cost ~120 ms of CPU on a desktop core.
That is why it looked like requests being served one after another: they were
CPU-bound on one thread. Holding the local server to 25 % of a core reproduces
the live pattern and its order of magnitude (list 0.7–1.4 s, six parallel lists
3.1 s each, six parallel cold frames 3.8–4.5 s, the 150-burst 60 s). The live
pod's actual CPU limit was not read; that it is the limiting factor is inferred
from this. There is no lock or queue in the
code; the pod's CPU limit is the queue.

## Decisions

- **Fewer round trips first, caching second.** A cache alone would leave the
  first visitor after every restart, and every newly opened episode, with the
  150 requests.
  - A parquet file up to 4 MB (`WHOLE_FILE_BYTES`) is fetched in one GET and
    parsed from memory. That is every `meta/episodes` file and every v2.1
    file-per-episode.
  - A larger file is still read in ranges, but the wanted column chunks of a
    row group come in **one** range when the span between them is at most 8 MB
    (`MAX_SPAN_BYTES`). A row group wider than that — the 63 MB single-group
    file TASK-355 was about — keeps the windowed, page-skipping path.
  - With a filter, the span is fetched up front only when the filter column has
    statistics (which then say the rows are probably there). Without statistics
    every row group would otherwise be downloaded to find one episode.
  - `read` is one GET and `stat` one HEAD; "not there" is S3's `NoSuchKey` /
    `NotFound` instead of a HEAD asked beforehand.
- **Three things are remembered** (`services/lerobot/DatasetReadCache.ts`), each
  in a weight-bounded LRU with a 10-minute TTL and shared in-flight loads:
  - the **episode table** per dataset (8 MB, ~160 B an episode) — answers the
    list, and tells a v3.0 frames read which data file to open;
  - the **footer** of each large parquet file — size, magic, last 256 KB
    (16 MB) — so opening another episode of the same file is one ranged GET;
  - **where an object is** — a dataset's bucket, and a video's bucket/key/size
    (4096 entries), which the player otherwise looks up with two HEADs on every
    Range request.
  Decoded frames stay in the existing 64 MB cache. Worst case all four full:
  ~90 MB against a 768 MB heap.
- **Invalidation.** Every key starts with `<dataset id>@<record updatedAt>`;
  `updatedAt` is Prisma `@updatedAt`, so any write to the row reads fresh.
  `DatasetService` additionally drops a dataset's entries on every
  `dataset:event` that is not a progress tick or log line — delete, update,
  upload, validation, Hub import — which is the one emitter all three writers
  announce on. A load that was running when its dataset was invalidated still
  answers its callers but is not stored. The TTL covers files changed behind
  the record's back.
- **Flags are not cached.** The table is cached; `flagged` is read per request
  and laid over a copy of each row.
- **Cold reads are bounded, warm ones never wait.** At most six uncached reads
  run at once (`coldReadGate`), each holding up to one 8 MB span, so a burst of
  first-time requests is not a burst of memory. Cache hits and requests waiting
  on a load already running do not pass the gate. The frames route fetches the
  episode table *before* taking a slot — otherwise six cold frame requests
  would hold every slot while waiting for the table load that needs one.
- **The event loop gets a turn.** Reads from memory resolve as microtasks, so a
  whole file would now decode in one uninterrupted stretch; the reader yields
  with `setImmediate` once decoding has run 8 ms.
- **No timeout was changed.**
- **Not done:** caching the *parsed* footer. A cold frames read is now ~20 ms
  of CPU, about a third of it thrift-decoding the footer again; it would need a
  reader object kept across requests. Left for when it matters.

## Acceptance Criteria

- [x] A v3.0 episode list costs 4 storage calls cold and none warm (was 143).
- [x] Opening another episode of a v3.0 dataset costs one storage call (was 155).
- [x] Six lists asked for at once read storage once.
- [x] A warm list answers in well under 300 ms — 2–4 ms locally, also at 25 % CPU.
- [x] Caches are bounded by weight and a dataset's entries go when it is
      deleted, changed, re-uploaded, re-validated or imported.
- [x] No path answers from memory for a dataset whose files are gone.
- [x] Error answers are unchanged: 422 naming the missing file, 502 for storage
      failure, 503 when storage is not running (for anything not remembered).

## Measurements

Local, server from `main` vs this branch, `NODE_ENV=production`, 768 MB heap,
RustFS in docker, the demo dataset. Times in ms.

| | before | after | before, 25 % CPU | after, 25 % CPU |
| --- | --- | --- | --- | --- |
| list, single (warm) | 114–137 | 2–4 | 710–936 | 2 |
| list, first after start | 178 | 92 | 1391 | 357 |
| frames, first read of an episode | 147 | 43 | 815 | 204 |
| 6 lists in parallel, each | 341–394 | 5–7 | 3001–3117 | 5–6 |
| 6 cold frames in parallel, each | 370–501 | 98–145 | 3783–4486 | 684–1084 |
| 150 requests, 6 in parallel, wall | 7.9 s | 1.6 s | 59.6 s | 10.0 s |
| … lists p50 / max | 406 / 512 | 57 / 100 | 2903 / 4107 | 312 / 609 |
| … frames p50 / max | 425 / 682 | 90 / 142 | 3109 / 4879 | 499 / 999 |

Live instance, build 5ba4cf5, before: v3.0 list 2.8–3.5 s; v2.1 lists
0.11–0.18 s (402, 260 and 101 episodes); v3.0 frames 2.5–3.5 s cold, 0.2 s
warm; v2.1 frames 0.27–0.59 s cold. The dataset record alone takes 0.10–0.16 s
from the measuring machine, so that is the floor for any request there.

## Key files

- `server/src/services/lerobot/DatasetReadCache.ts` — new: the three caches,
  `footerCachingStore`, `coldReadGate`, `invalidateDatasetReads`
- `server/src/services/lerobot/parquetEpisodeRows.ts` — one fetch per row
  group, cooperative yield
- `server/src/services/lerobot/RemoteDatasetReader.ts` — whole-file read of
  small files, `readEpisodeTable`, frames read takes the table from its caller
- `server/src/services/lerobot/ReadCache.ts` — `deletePrefix`, disowned
  in-flight loads
- `server/src/routes/datasets.routes.ts` — the routes use the caches; single
  HEAD/GET; video location remembered
- `server/src/services/DatasetService.ts` — invalidation on dataset events

## Test Strategy

- `server/src/services/lerobot/__tests__/DatasetReadCache.test.ts` — sharing,
  budgets, invalidation (incl. a load in flight), footer store call counts, gate
- `server/src/services/lerobot/__tests__/parquetEpisodeRows.test.ts` — requests
  per row group; the event loop gets turns during an in-memory decode
- `server/src/routes/__tests__/datasets-episodes-routes.test.ts` — exact storage
  calls of a cold and a warm v3.0 list, six parallel lists and six parallel
  episodes, fresh flags over a cached list, re-read after the record changes,
  nothing served after invalidation, cached list while storage is down
- `server/src/routes/__tests__/datasets-video-routes.test.ts` — one lookup for
  several Range requests
- `server/src/services/__tests__/DatasetService.test.ts` — delete and
  another service's event both invalidate
- By hand: `rmsctl datasets upload` the demo dataset into a throwaway RustFS,
  time `GET /api/datasets/:id/episodes` and `/episodes/N/frames` single and six
  in parallel, before and after.

## Notes

- After deploy the first list of each dataset per pod start (and per ten idle
  minutes) is still a cold read: four storage calls instead of 143.
- The live pod is CPU-starved for this workload: the same code is 6–20× faster
  on an unthrottled core. Raising the server's CPU limit would help every
  route, independent of this change.
- Several server replicas each keep their own cache; invalidation by event
  reaches only the replica that handled the write. The `updatedAt` in the key
  covers the others — they read fresh as soon as they see the new record.
