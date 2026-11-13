---
id: "TASK-491"
aliases: []
title: "Switching episodes quickly never takes dataset browsing down, and a stuck storage call clears on its own"
slug: "switching-episodes-quickly-never-takes-dataset-browsing-down"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
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
  - response bodies are timed by the client itself (`endWhenStalled`), because
    the SDK's `socketTimeout` is not: at any setting from 6 s up — the 120 s
    default included — it arms its timer three seconds into a request and
    cancels it when the answer begins, so a store that answered at once and
    went quiet halfway through a body left `download()` / `downloadRange()`
    pending for good (found in review, with a store that sends half a body).
    A body is ended when its reader has waited on a silent store for the idle
    timeout, or when nobody ever read it; a reader that is itself the slow
    side — a paused player — keeps its stream;
  - uploads keep their own per-request connections (the SDK's
    `Expect: 100-continue` path) and have no deadline, only the idle timeout —
    a part that is moving is never cut off.
  - `/health`'s HeadBucket probe goes through the same deadline helper, so a
    store that does not answer reads `connectivity`, not `unknown`.
- `server/src/storage/model-storage.ts`, `server/src/routes/storage.routes.ts`:
  `/api/storage/stats` stops at the first bucket the store does not answer for
  and says 503 `STORAGE_TIMEOUT`, instead of waiting out one deadline per bucket.
- `server/.env.example`, `docs/deployment.md`: the five settings. The defaults
  are what the demo instance should run with, so the Helm chart is untouched.

### Frontend

No change — measured, not assumed. Per switch the player makes four to five
video requests (per camera: `bytes=0-` for the index, then the seek to the
episode's window) and the browser itself cancels every one of them on the next
click: 1,019 video requests for 250 switches, 1,009 of them cancelled. The
one-byte probe of #482 only goes out after a `<video>` error. The obvious
saving — one URL per chunk file instead of one per episode, so the index is not
fetched again — saves nothing: Chromium asks for `bytes=0-` again when only the
`#t=` fragment changes (`url-experiment.json` in the evidence folder).

### Key files

- `server/src/utils/streamResponse.ts`, `server/src/utils/__tests__/streamResponse.test.ts`
- `server/src/routes/datasets.routes.ts`, `server/src/routes/__tests__/datasets-video-routes.test.ts`
- `server/src/routes/twin.routes.ts`, `server/src/routes/sensorscan.routes.ts`, `server/src/routes/incident.routes.ts`
- `server/src/storage/rustfs-client.ts`, `server/src/storage/__tests__/rustfs-client-transport.test.ts`
- `server/src/storage/model-storage.ts`, `server/src/routes/storage.routes.ts`
- `server/.env.example`, `docs/deployment.md`

## Acceptance Criteria

- [x] A video request dropped before, while and after the store stream opens
      leaves no store socket checked out; so does a stream error mid-way and a
      HEAD or one-byte probe.
- [x] 200+ rapid switches / dropped requests against the local reproduction:
      zero 5xx, storage reads as fast afterwards as before, socket count back to
      baseline, `/health` storage `ready`.
- [x] A store that stops answering makes storage calls fail within the
      configured deadline instead of hanging, and they work again by themselves
      once it answers — no restart.
- [x] `rmsctl datasets upload` of the bottle dataset and full-length playback of
      one video work with the new timeouts.
- [x] Tests fail without the fix, including one that drops the client while the
      store stream is opening.

## Test Strategy

`cd server && npm run typecheck && npx vitest run`. The reproduction scripts and
their before/after output are named in the PR.

## Notes

Measured on 2026-11-13, same machine, same dataset, same scripts before and
after (`NODE_ENV=production`, 768 MB heap, RustFS 1.0.0 in docker).

| | `main` (1812e1a) | this branch |
| --- | --- | --- |
| 200 ranged requests dropped after 0–60 ms | pool 50/50 busy, 123 calls queued, every storage read times out | 0 busy, 0 queued |
| 1,000 dropped after 0–120 ms | — (dead after the first 200) | zero 5xx; peak 7 sockets busy, 0 queued |
| real player, 100 ms store latency, 350 ms switches | dead within the first 50; 504s; still down 21 min later | 250 switches, 1,019 video requests, zero 5xx, both videos play |
| storage reads afterwards (list / frames of an episode not read before / 1 MB video) | no answer | 14 / 60 / 27 ms (fresh server: 196 / 117 / 75 ms cold, 13 / 9 / 28 ms warm) |
| `/health` storage afterwards | `unavailable` / `unknown` | `ready` |
| store frozen (accepts, never answers) | every call hangs for good | every call answered at 15.0 s (503 / 502); all work again within one probe period of it coming back, no restart |

Uploads and long streams under the new timeouts: `rmsctl datasets upload` of the
bottle dataset 10.9 s (8.2 s before, one run each) and, throttled to 1 MB/s per
connection so that a 32 MB part takes 32 s and the whole upload 161 s, `ready`
both times; one 216 MB video streamed whole at 1.4 MB/s over 150 s,
byte-identical to the source; the 1,856 s head video played first second to
last in Chromium at 16×.

Added in review, on the same kind of stack (own proxy and driver): a fake store
that sends half a body and stops left `download()`, `downloadRange()` and a
stream pending after 25 s with the idle timeout at 8 s, and ends all three at
8.0 s now with a `TimeoutError`. With the idle timeout at 4 s, a client that
stops reading for 15 s gets the whole 208 MB file afterwards (also when it stops
on the last 3 MB), and eight readers at 400 KB/s ran 90 s each without one being
cut — the first version of that check cut one in six, in the instant a slow
reader asks for more and nothing has landed yet, which is why a body is only
ended on two checks in a row with no byte in between. 2,000 dropped requests in
bursts of eight: zero 5xx, 0 sockets busy afterwards. Twenty uncached frame
reads against a silent store come back in waves of six, 15 s apart (the gate),
all answered by 60 s, none left behind; `/health` says `unavailable` /
`connectivity` meanwhile and `ready` one probe period after the store is back.

Not reproduced locally: the early `500 {"error":"Failed to stream video"}`
answers the live instance gave before it started hanging. Locally the same
phase shows up as requests waiting for a socket and timing out at the gateway.
The code path that produced the header-less 500 that still carried a
`Content-Range` is the one fixed here (a stream error after the 206 headers
were set and before they were sent); what RustFS itself answered on the
instance at that moment is not known.

Left alone on purpose: `coldReadGate` (its 30 s hold limit already releases a
slot, and with the deadline no load behind it can stay unsettled); the routes
that proxy a robot or a supervisor (`robot.routes.ts`, `voice.routes.ts`,
`robot-bringup.routes.ts`), which do not touch object storage.
