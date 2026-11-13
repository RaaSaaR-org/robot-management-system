---
id: "TASK-492"
aliases: []
title: "The episode a viewer stops on loads at once however fast they went through the list, and the server drops the ones they passed"
slug: "the-episode-a-viewer-stops-on-loads-at-once-however-fast"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "performance", "reliability", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The episode a viewer stops on loads at once however fast they went through the list, and the server drops the ones they passed

## Description

Found on the demo instance (build df6a736, server pod limited to 500m CPU,
behind an edge that cuts a request at 15 s) on 2026-11-13. On the episode page
of the v3.0 dataset `g1-dex3-bottle-sorting-sim` (80 episodes, 31 joints, two
cameras), clicking through episodes quickly backed up the joint-data requests
`GET /api/datasets/:id/episodes/N/frames?offset=0&limit=2000`: the browser
dropped the superseded video loads but none of the frames requests (61 sent,
0 aborted), the server decoded every one of them, latency climbed
0.3 s → 4 s → 9 s → 14.5 s and then requests died as 504s. The episode the
viewer stopped on was left on "Couldn't load this episode's frames — Request
failed with status code 504 — Retry". The instance was fast again a minute
later: a queue, not a leak.

## Details

### Current state (what the reproduction showed)

Reproduced locally before any code changed: the server built from `main`
(`NODE_ENV=production`, 768 MB heap) held to a fraction of a core with
`systemd-run --user --scope -p CPUQuota=…`, a throwaway RustFS in docker, the
bottle dataset uploaded with `rmsctl datasets upload`, the production app build
behind a gateway that cuts requests at 15 s, and a Playwright script that
switches episodes 10 × 350 ms, 30 × 350 ms and 60 × 250 ms.

- **It is a queue of work nobody wants.** Every switch sent a frames request
  and nothing ever took one back: `DatasetEpisodesPage` only ignored the answer
  of an episode that had been left. Each uncached read is CPU on the one
  thread — measured 32 ms of a desktop core, of which parquet decoding 38 %,
  thrift-decoding the file's footer (80 row groups × 9 columns, parsed again
  for every episode) 10–14 %, `JSON.stringify` of the 845 KB answer 9 %.
  Once a switch costs more wall time than the gap between two clicks, the
  queue only grows, and the episode stopped on waits behind all the others.
- **Where the tipping point is.** The live pod is far slower than half of a
  desktop core: a single cold frames read takes 0.5–1.6 s there and 0.09–0.4 s
  on the local server at 50 %. At 50 % the local server never queues (frames
  p50 54 ms). At **10 %** a single cold read costs what it costs live
  (0.3–2.6 s) and the live pattern appears: 10 switches → frames p50 1.4 s,
  videos ready 1.9 s after the last click; 30 → p50 2.8 s / max 4.0 s, ready
  after 3.8 s; 60 → p50 7.3 s / max 9.5 s, ready after 9.5 s; 60 switches 50 ms
  apart → ready after 22.5 s. So 10 % is what "live" means in the numbers below.
- **The 504 itself** is the edge's; the local browser speaks HTTP/1.1 to the
  gateway and queues the same wait in its six connections instead. The chart's
  stuck error state reproduces by answering one frames request with 504.
- **The video recovers by itself and the chart does not**: #482 gave the app
  client a retry for 429 only.
- **The demo file is not re-downloaded per episode** — it is 20 MB with one row
  group per episode, so a cold read is one ranged GET of ~230 KB. A v3.0 data
  file under 4 MB is fetched whole, and was fetched whole again for every other
  episode in it.
- **The chart never needed 2000 × 62 numbers.** It is a few hundred pixels
  wide; the Curate panel takes the frame count from the episode list, not from
  the frames.

### Frontend

- `app/src/features/training/hooks/useEpisodeFrames.ts` (new): the frames
  request of the episode on screen. It carries an `AbortSignal` and is aborted
  the moment another episode is opened; a 502/503/504 or a request that never
  arrived is tried again after 0.5 s, 1.5 s and 3 s while the chart stays on
  "loading", and only then becomes the error with its Retry button. It asks for
  `maxPoints=400` and keeps the episode's real `total`.
- `app/src/features/training/hooks/useSettledValue.ts` (new): the episode the
  heavy parts load for. A change that comes after 250 ms of quiet passes at
  once — a single click never waits; a change that follows another sooner is
  held until the selection has stood still for 250 ms, and only the last one
  passes. Videos, the video ticket, the frames and the episode discussion
  follow it; the list highlight, the Curate panel's frame count and the trim
  fields follow the click itself.
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`: uses both; while
  the selection is ahead of the stage the chart reads as loading, never as the
  previous episode's.
- `app/src/features/training/components/datasets/EpisodeListPanel.tsx`: Arrow
  Up / Arrow Down open the neighbouring row and move the focus with it.
- `app/src/features/training/components/datasets/TrajectoryPanels.tsx`: the
  sample count is the episode's own length — "688 samples (400 drawn)".
- `app/src/features/training/api/trainingApi.ts`: `getEpisodeFrames` takes
  `{ maxPoints, signal }`.

### Server

- `server/src/services/lerobot/ReadCache.ts`: `getOrLoad(key, weigh, load,
  signal?)`. A caller with a signal leaves when it fires (`ReadAbandoned`); the
  loader receives a `stop` signal that fires once every caller has left, and a
  stopped load is forgotten so the next request starts afresh. A caller without
  a signal keeps the load alive.
- `server/src/services/lerobot/DatasetReadCache.ts`: `createGate` takes a
  signal — a waiter whose client left leaves the queue — and hands a freed slot
  to the waiter that arrived last, so the newest request is never behind stale
  ones. Two more caches, both dropped with the dataset's other reads:
  `sharedFileCache` (the bytes of a small v3.0 data file, 24 MB) and
  `parquetMetadataCache` (parsed footers, 16 MB).
- `server/src/services/lerobot/parquetEpisodeRows.ts`: `ReadRowsOptions.signal`
  — checked before each row group and after each decoded page, right after the
  event loop got its turn; the parsed footer is kept per `ByteSource.key`.
- `server/src/services/lerobot/RemoteDatasetReader.ts`: the signal is passed
  through; a v3.0 data file is read through `readShared`; `thinFrames`.
- `server/src/routes/datasets.routes.ts`: the frames route passes
  `clientGoneSignal(res)`; `?maxPoints=N` thins the page to N evenly spaced
  frames, first and last included, `total` unchanged. Without the parameter the
  answer is what it was.
- `server/AGENTS.md`: the rule for the next route that reads through the cache.

### Key files

- `app/src/features/training/hooks/useEpisodeFrames.ts`, `useSettledValue.ts` and their tests
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`, `__tests__/DatasetEpisodesPage.rapid.test.tsx`
- `app/src/features/training/components/datasets/EpisodeListPanel.tsx`, `TrajectoryPanels.tsx`
- `app/src/features/training/api/trainingApi.ts`
- `server/src/services/lerobot/ReadCache.ts`, `DatasetReadCache.ts`, `parquetEpisodeRows.ts`, `RemoteDatasetReader.ts` and their tests
- `server/src/routes/datasets.routes.ts`, `server/src/routes/__tests__/datasets-episodes-routes.test.ts`

## Acceptance Criteria

- [x] However fast the list is clicked or arrow-keyed, the episode stopped on
  shows its videos and chart within about 2 s of the last switch on the
  live-equivalent server, cold. Measured at 10 %: 0.54 s / 0.90 s / 0.53 s for
  10 × 350 ms, 30 × 350 ms, 60 × 250 ms (before 1.9 s / 3.8 s / 9.5 s); 0.57 s
  for 60 arrow-key steps at 33 ms; 1.2 s for 60 clicks at 50 ms (before 22.5 s).
- [x] No 5xx in any of the runs, and a frames request answered 504 once leaves
  the chart drawn 0.5 s later with no error state (before: the Retry banner).
- [x] The server does not finish reads nobody waits for: of 61 frames requests
  in the 60 × 250 ms run, 40 were aborted by the browser, 34 reads completed
  on the server (before 61), and server CPU for the run fell from 2.79 s to
  2.04 s; with a held key 3 requests are sent instead of 61.
- [x] A single click is not delayed: the highlight and the video URL follow in
  the same frame as before; playback carries over a switch; the Curate panel's
  sample count, end frame and trim range are the episode's own; a v2.1
  dataset's episode page behaves the same.
- [x] Memory stays bounded: two new caches, 24 MB and 16 MB by weight; RSS
  after reading every episode of both test datasets twice 459 MB (before 434 MB).

## Test Strategy

- Server unit and route tests: a caller leaving, the load stopping only when
  the last one left, the gate's queue (leave, newest first), the footer cache
  (same rows, statistics still skip row groups), the small-file cache and its
  budget, `thinFrames`, and — over a real socket — a dropped request whose
  episode is neither decoded nor cached, a second request that still gets its
  answer, and a dropped request that never takes a read slot.
- App tests: `useSettledValue`, `useEpisodeFrames`, and the page walked with
  clicks and with the arrow keys under a fake clock.
- The three browser runs above, before and after, at 50 %, 10 % and 6 % CPU.

## Notes

- Not verified on the live instance: whether the edge and the ingress close the
  origin connection when the browser aborts a request. If they do not, the
  server never learns the client left; the run with a gateway that hides aborts
  of frames requests still settles in 0.4–1.0 s at 10 %, because the page then
  sends far fewer and cheaper requests and the newest goes first.
