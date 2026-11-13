---
id: "TASK-491"
aliases: []
title: "Switching episodes quickly never takes dataset browsing down, and a stuck storage call clears on its own"
slug: "switching-episodes-quickly-never-takes-dataset-browsing-down"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "storage", "reliability", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# Switching episodes quickly never takes dataset browsing down, and a stuck storage call clears on its own

## Description

Found on the demo instance (build 1812e1a) on 2026-11-13, on the path the demo
on 2026-11-16 walks. Opening the episode page of the v3.0 dataset
`g1-dex3-bottle-sorting-sim` (two cameras, each ONE ~208 MB chunk mp4 shared by
all 80 episodes) and clicking through 6–10 episodes about 350 ms apart made
video requests fail, then hang into the edge's 504, and finally every
storage-backed read hung — episode lists, frames, video, `/api/storage/stats` —
while `/health` reported storage `unavailable` / `unknown`. It did not recover
in 20 minutes; only a pod restart cleared it. DB-backed routes stayed fine.

## Details

### Current state (what the reproduction showed)

Reproduced locally before any code changed: the server built from `main`
(`NODE_ENV=production`, 768 MB heap) against a throwaway RustFS, the bottle
dataset uploaded with `rmsctl datasets upload`, the production app build behind
a small gateway, a latency proxy in front of the store, and a preload that
samples the S3 client's socket pool.

- **Mechanism.** `sendVideo` in `server/src/routes/datasets.routes.ts` awaited
  `rustfs.getStream(...)` and only afterwards registered `res.on('close')`.
  A `<video>` whose `src` changes drops its request; when that happened before
  the store had answered, `close` had already fired, nothing ever destroyed or
  read the S3 body, and its socket stayed checked out of the SDK's pool for
  good. The S3 client was built with defaults: 50 sockets, no connection
  timeout, no idle timeout, no deadline. Fifty such requests — over the life of
  the process, not in one burst — and every later storage call queued for a
  socket that never came back.
- **Numbers.** 200 ranged requests dropped after 0–60 ms: 67 store streams
  opened after their client had gone, 50 of them never closed, pool 50/50 busy
  with 120+ calls queued; episode list, frames, storage stats and a 1 MB video
  read all timed out; `/health` said `unavailable` / `unknown`, `attempts: 1`.
  In the real player, with 100 ms of store latency, 50 switches at 350 ms did
  the same, and it was still down 20 minutes later.
- **Not a regression of #482/#483/#488.** Build 5ba4cf5 dies the same way under
  the same driver (200 of 200 dropped requests, 50 leaked sockets). The leak is
  as old as the route; a freshly restarted pod simply starts 50 leaks away from
  it, which is why the same ten switches passed earlier that day.
- **The read gate is not the lock.** `coldReadGate` (six slots, #488) filled to
  6 active / 12 waiting, but its 30 s hold limit kept releasing slots; the reads
  behind it hung on the socket pool, not on the gate. What it could not do is
  settle a load that never returns, and a load shared through `ReadCache` then
  hangs every later caller of the same key.
- **`/health` was telling the truth late.** Its probe is a HeadBucket through
  the same exhausted pool, so it timed out. The state is recomputed on every
  probe; it had nothing to recover *to* while the pool was gone.
- **The same shape elsewhere.** `twin.routes.ts` (two places),
  `sensorscan.routes.ts` and `incident.routes.ts` pipe a store stream to the
  response with no cleanup at all when the client leaves.
- **A HEAD on a video** opened the store stream and read the whole object to
  throw it away.

### Server

- `server/src/utils/streamResponse.ts` (new): `clientGoneSignal(res)` — an
  `AbortSignal` that fires when the response closes unfinished, and says so at
  once when it already has — and `sendStream(res, open, …)`, the one way a route
  pipes a readable to a response: the signal exists before `open` is awaited, a
  stream that arrives for a client that left is destroyed, a stream error before
  the first byte is answered as JSON with the stream's headers taken back off,
  and one after it ends the response.
- `server/src/routes/datasets.routes.ts`: `sendVideo` goes through `sendStream`
  and hands the signal to `rustfs.getStream`; HEAD answers from the known size
  without opening anything; the HuggingFace proxy fetch takes the signal too.
- `server/src/routes/twin.routes.ts`, `sensorscan.routes.ts`,
  `incident.routes.ts`: the store streams go through `sendStream`.
- `server/src/storage/rustfs-client.ts`:
  - explicit transport settings instead of SDK defaults: connection timeout,
    socket idle timeout, and a deadline to the first response byte on every call
    that does not upload a body — `RUSTFS_CONNECT_TIMEOUT_MS` (5 s),
    `RUSTFS_SOCKET_TIMEOUT_MS` (120 s), `RUSTFS_RESPONSE_TIMEOUT_MS` (15 s);
  - two pools: short calls (`RUSTFS_MAX_SOCKETS`, 64) and long-lived streams
    (`RUSTFS_MAX_STREAM_SOCKETS`, 128), so streams can never starve a HEAD, a
    list or the health probe;
  - `getStream(bucket, key, range, { signal })` passes the signal to the SDK
    and destroys the body when it fires later;
  - uploads keep their own per-request connections (the SDK's
    `Expect: 100-continue` path) and have no deadline, only the idle timeout —
    a part that is moving is never cut off.
- `server/.env.example`, `helm/neodem`, `docs/deployment.md`: the five settings.

### Frontend

- `app/src/features/training/components/datasets/EpisodeViewer.tsx` /
  `api/datasetVideoApi.ts`: only what the measurements show to be worth it —
  see Notes.

### Key files

- `server/src/utils/streamResponse.ts`, `server/src/utils/__tests__/streamResponse.test.ts`
- `server/src/routes/datasets.routes.ts`, `server/src/routes/__tests__/datasets-video-routes.test.ts`
- `server/src/routes/twin.routes.ts`, `server/src/routes/sensorscan.routes.ts`, `server/src/routes/incident.routes.ts`
- `server/src/storage/rustfs-client.ts`, `server/src/storage/__tests__/rustfs-client-transport.test.ts`
- `server/.env.example`, `helm/neodem/templates/server-deployment.yaml`, `helm/neodem/values.yaml`, `docs/deployment.md`

## Acceptance Criteria

- [ ] A video request dropped before, while and after the store stream opens
      leaves no store socket checked out; so does a stream error mid-way and a
      HEAD or one-byte probe.
- [ ] 200+ rapid switches / dropped requests against the local reproduction:
      zero 5xx, storage reads as fast afterwards as before, socket count back to
      baseline, `/health` storage `ready`.
- [ ] A store that stops answering makes storage calls fail within the
      configured deadline instead of hanging, and they work again by themselves
      once it answers — no restart.
- [ ] `rmsctl datasets upload` of the bottle dataset and full-length playback of
      one video work with the new timeouts.
- [ ] Tests fail without the fix, including one that drops the client while the
      store stream is opening.

## Test Strategy

`cd server && npm run typecheck && npx vitest run`. The reproduction scripts and
their before/after output are named in the PR.

## Notes
