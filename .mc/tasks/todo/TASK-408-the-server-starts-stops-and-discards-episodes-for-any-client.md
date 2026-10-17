---
id: "TASK-408"
aliases: []
title: "The server starts, stops and discards episodes for any client and shares one live session state"
slug: "the-server-starts-stops-and-discards-episodes-for-any-client"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "datacollection", "teleop", "compliance"]
sprint: ""
parent: ""
depends_on: ["[[TASK-402]]", "[[TASK-406]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The server starts, stops and discards episodes for any client and shares one live session state

## Description

Two people run a data-collection session: the operator in the Quest and an assistant in a desktop browser. Today they share only a 1 Hz progress event:
- a "next" wipes the other client's counters for up to a second;
- a discard is invisible to the other client for up to 3 s;
- a double press creates an empty episode;
- nobody can tell who did what.

This task makes episode start, stop, next and discard explicit server actions that any client can call. Each action is guarded against stale double presses, attributed to the person and device who made it, and broadcast. Every client gets one live session state with a server-stamped take timer. Takes are persisted when they stop, not only at session end. Real-robot datasets stop being labelled as simulation.

## Details

### Current state
- **Routes** in `server/src/routes/teleoperation.routes.ts`, mounted with `...protect` (`server/src/app.ts:390`):
  - `POST /sessions/:id/{start,pause,resume,end}` (~l.187-265)
  - `POST /sessions/:id/episodes/next` (~l.349) → `{episodeIndex, message}`
  - `GET /sessions/:id/episodes` (~l.374) → `{sessionId, episodes: EpisodeSummary[]}`
  - `DELETE /sessions/:id/episodes/:episodeIndex` (~l.396)
- **`server/src/services/TeleoperationService.ts`** (2033 lines)
  - `startSession` (~l.303) calls `agentRecordingService.start(robotId, {sessionId, fps, task, inputMode})`.
  - `nextEpisode` (~l.782-843) emits `session:progress {currentEpisode, running:true}`. Sidecar sessions are refused (~l.800).
  - `discardEpisode` (~l.936-984) emits nothing.
  - `listEpisodes` (~l.845-929): DB rows, else the agent `/recording/status`, else a frame groupBy.
  - `endSession` (~l.531-776).
  - `startAgentProgressPoller` (~l.1682, 1 s, `AGENT_PROGRESS_POLL_MS` ~l.57) emits `recordingProgress {frameCount, currentEpisode, episodesDone, fpsActual, running, degraded}`. It has no `elapsedS` and no per-episode timer.
  - `persistEpisodeSummaries` (~l.1730) upserts by index, and only at end.
  - `registerAgentDataset` (~l.1773) hardcodes simulation provenance: "Teleoperation in simulation" (~l.1806), source "MuJoCo sim" (~l.1830), "no recorded persons" (~l.1854). It rounds `fps` (~l.1811) but stores `infoJson` as is.
- **`server/src/services/AgentRecordingService.ts`** covers `start`, `nextEpisode`, `discard`, `status` and `stop`. `AgentRecordingStopResult` (~l.55) has no `simulated`.
- **`server/src/services/SimFrameRecorder.ts`**: `nextEpisode()` (~l.181), used by sim sessions whose frames are posted by the client.
- **`server/src/websocket/index.ts:451-477`** maps the `teleoperation:event` types to the `teleop:session:*` names, `teleop:session:progress` and `teleop:quality`, with the envelope `{type, data:{sessionId, session, recordingProgress, qualityFeedback, error}, timestamp}`.
- **`RecordingProgress`** is at `server/src/types/teleoperation.types.ts:419`.
- **Prisma `TeleoperationEpisode`** (`schema.prisma` ~l.1826) is `{id, sessionId, episodeIndex, frameCount, droppedFrames, durationS, fpsActual, retargetModes, createdAt}`, `@@unique([sessionId, episodeIndex])`.
- **Agent side (TASK-402, merged before this task)**:
  - `startBetweenTakes`
  - `POST /api/v1/robots/:id/recording/episodes/begin|end`
  - `GET …/recording/episodes/:idx/thumbnail`
  - status gains `phase`, `episodeStartedAtMs`, `episodeElapsedS`, `elapsedS`, `autoStopS`, `lastStop`
  - reports gain `jointsMoved`, `groupsMoved`, `warnings`, `thumbnail`
  - the stop result gains `simulated` and `indexMap`
  - take numbers are never reused within a session

### Server
**`AgentRecordingService`**
- Add `beginEpisode`, `endEpisode` and `thumbnail(robotId, take)` (it streams the agent JPEG).
- The `start` request gains `startBetweenTakes` and `episodeTimeS`; TASK-406 added the latter to the type.
- The stop result gains `simulated` and `indexMap`.

**`TeleoperationService`**
- `startSession` (agent recorder) always passes `startBetweenTakes: true`. The session goes to `recording` with `phase:'between'`.
- `startEpisode(sessionId, ctx)`, `stopEpisode(sessionId, ctx)`, `nextEpisode(sessionId, ctx)` and `discardLast(sessionId, ctx)` / `discardEpisode(sessionId, take, ctx)`. `ctx = {expectedTake?: number|null, clientId?: string, source: 'vr'|'desktop'|'hotkey', user: {userId, displayName}}`.
  - **Guard.** If `expectedTake` is given and differs from the live take, or the phase does not fit (start while capturing, stop while between), reject with `409 {code:'episode_conflict'|'already_capturing'|'not_capturing', live: LiveState}`. The client then re-syncs from `live`.
  - **Serialization.** Calls are serialized per session with a promise chain, so two simultaneous presses cannot both succeed.
  - Sim sessions (`SimFrameRecorder`) get the same four operations: add `begin`/`end`/`phase` to `SimFrameRecorder`. Client-posted frame sessions use their `clientEpisodeIndex` boundary.
  - SO-101 sidecar sessions answer `409 {code:'unsupported_recorder'}` for start/stop. They keep their fixed lerobot-record flow.
- **Persist at stop.** When a take stops, upsert its `TeleoperationEpisode` row with the quick-check fields.
  - At `endSession`, write `datasetEpisodeIndex` from `indexMap` and mark discarded takes.
  - A discard marks the row `discarded: true` and keeps it for the audit trail. Lists hide discarded rows unless `?includeDiscarded=1`.
- **Prisma migration** on `TeleoperationEpisode`:
  - `discarded Boolean @default(false)`
  - `datasetEpisodeIndex Int?`
  - `startedAt DateTime?`
  - `stopReason String?`: `operator`, `time_limit`, `next` or `session_end`
  - `quickCheck String?`: JSON of `{jointsMoved, groupsMoved, warnings}`
  - `startedBy String?` / `stoppedBy String?`: JSON `{userId, displayName, source}`
  - Postgres and SQLite both work. The CI Postgres drift check must pass, and it is reproducible in Docker.
- **LiveState.** One shape, built in a new pure module `server/src/services/teleoperation/liveState.ts` from session + agent status (or SimFrameRecorder):
```
LiveState = {
  sessionId, status, phase: 'between'|'capturing'|null,
  take: number|null,                 // current take while capturing, else last take, 0-based
  takeStartedAt: string|null,        // ISO, from the agent's episodeStartedAtMs
  takeElapsedS: number|null, takeFrames: number, totalFrames: number,
  kept: number, discarded: number,
  fpsTarget: number, fpsActual: number|null, degraded: boolean, lastDropReason: string|null,
  elapsedS: number|null, autoStopS: number|null,
  lastTake: QuickCheck|null,
  at: string                         // server time, for client clock offset
}
QuickCheck = { take, frames, durationS, droppedFrames, fpsActual, jointsMoved:{name,rangeRad}[],
               groupsMoved:string[], warnings:string[], thumbnailUrl: string|null, stopReason }
```
- **Poller.** It emits `session:live` (the full LiveState) at 1 Hz and immediately after every mutation.
  - It detects a stop it did not cause (the agent's `lastStop` changed, e.g. `time_limit`) and emits `episode:stopped` with `by: {source:'auto'}`.
  - The old `session:progress` stays for compatibility, but is built from LiveState with the old field names and **merged**, never partial: it always carries `frameCount`, `currentEpisode`, `fpsActual`, `running` and `degraded`.
- **Events** (`teleoperation:event`):
  - `episode:started {take, startedAt, by}`
  - `episode:stopped {take, reason, quickCheck, by}`
  - `episode:discarded {take, by}`
  - `session:live {live}`

  `by = {userId, displayName, source, clientId}`.
- **Provenance.** `registerAgentDataset` branches on `result.simulated`:
  - real: description "Teleoperation on <robot name>", source "<robotType> robot <robotId>", and copyright/consent text that says recorded persons may be present (the operator is in camera view);
  - sim: the current text.
  - It also rewrites `infoJson.fps` to the integer target when an older agent wrote a float.
- **Audit.** Every start/stop/next/discard writes a compliance log entry through the existing compliance service: actor, session, take, source.

**Routes** (`teleoperation.routes.ts`, all `...protect`, body validated):
- `GET /api/teleoperation/sessions/:id/live` → `LiveState`
- `POST /api/teleoperation/sessions/:id/episodes/start` with body `{expectedTake?: number|null, clientId?: string, source?: 'vr'|'desktop'|'hotkey'}` → `200 {live}` | `409 {code, live}`
- `POST /api/teleoperation/sessions/:id/episodes/stop` (same body) → `200 {live, quickCheck}` | `409`
- `POST /api/teleoperation/sessions/:id/episodes/next` (same body): the existing route, now guarded → `200 {episodeIndex, live}`
- `POST /api/teleoperation/sessions/:id/episodes/discard-last` with body `{expectedTake?, clientId?, source?}` → `200 {live}`
- `DELETE /api/teleoperation/sessions/:id/episodes/:take`: the existing route, now emits `episode:discarded`
- `GET /api/teleoperation/sessions/:id/episodes/:take/thumbnail` → `image/jpeg`, proxied from the agent, `Cache-Control: private, max-age=3600`, `404` when there is none

**WebSocket** (`server/src/websocket/index.ts`, the teleop `typeMap` and envelope only):
- `episode:started` → `teleop:episode:started`
- `episode:stopped` → `teleop:episode:stopped`
- `episode:discarded` → `teleop:episode:discarded`
- `session:live` → `teleop:session:live`

The envelope `data` gains `live`, `take`, `quickCheck`, `by` and `reason`, with existing keys unchanged.

### Key files
- server/src/services/TeleoperationService.ts
- server/src/services/AgentRecordingService.ts
- server/src/services/SimFrameRecorder.ts
- server/src/services/teleoperation/liveState.ts (new)
- server/src/routes/teleoperation.routes.ts
- server/src/types/teleoperation.types.ts
- server/src/websocket/index.ts (teleop typeMap and envelope only)
- server/prisma/schema.prisma + migration
- server/src/services/__tests__/{TeleoperationService.test.ts, SimFrameRecorder.test.ts, liveState.test.ts (new)}
- server/src/routes/__tests__/teleoperation.routes.test.ts

## Decisions
- **D1 Any session member may start, stop or discard; no control lease is needed.** These actions move nothing on the robot. The assistant must be able to press them while the operator holds the lease. The E-stop is separate and always available.
- **D2 Optimistic guard via `expectedTake` plus per-session serialization.** Rejected: a lock or "who owns the recording" role, which adds friction for two people standing next to each other.
- **D3 A session starts between takes.** The first take starts on purpose (button, hotkey or VR). Rejected: auto-starting take 0, which lost a whole session on 2026-10-16.
- **D4 Discarded takes are kept as rows with a flag**, for audit and for "undo" later. Rejected: deleting rows.
- **D5 The server stamps the take start time and sends its own clock (`at`)**, so both clients show the same timer. Rejected: each client counting from its own clock.
- **D6 Session pause/resume routes stay for compatibility.** The UI no longer offers Pause for agent sessions (TASK-410), because between takes is the pause.

## Acceptance Criteria
- [ ] Start → `teleop:episode:started` and `teleop:session:live` with `phase:'capturing'`. Stop → `teleop:episode:stopped` with a `quickCheck` (frames, durationS, jointsMoved, thumbnailUrl) and `phase:'between'`. Both carry `by.source`.
- [ ] Two concurrent `episodes/next` calls with the same `expectedTake` produce exactly one new take. The other answers 409 `episode_conflict` with the current `live` (service test with an artificial agent delay).
- [ ] `discard-last` and `DELETE …/episodes/:take` emit `teleop:episode:discarded`. The row is kept with `discarded:true` and hidden from the default list.
- [ ] Every progress event carries the full counters (regression test for the wipe after a next).
- [ ] An agent `time_limit` stop observed by the poller emits `teleop:episode:stopped {reason:'time_limit', by:{source:'auto'}}`.
- [ ] After end, rows carry `datasetEpisodeIndex` per `indexMap`. A real-robot result yields a Dataset without "simulation" text, and a sim result keeps it. `infoJson.fps` is an integer.
- [ ] The thumbnail route proxies the JPEG and 404s cleanly.
- [ ] Each mutation writes one compliance entry naming the actor and source.
- [ ] The Prisma migration applies on SQLite and Postgres, and the drift check passes. `npm run typecheck` and vitest pass.

## Test Strategy
- **vitest:** liveState builder, guards and serialization (fake AgentRecordingService), persistence and the index mapping, the WS typeMap, provenance branching, and routes with supertest.
- **Live check** with a branch server on a free port (e.g. `PORT=3099` with its own SQLite DB copy). Point it at a branch agent built with TASK-402 on a free port, which uses the sim sidecar :8777 (`ROBOT_ID=sim-…`). Create a session, start, stop, next, discard, and end. Watch `/api/a2a/ws` with `wscat`.
- Never use the real g1-edu-4.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Notes
- **This is at the ceiling.** If the session nears it, land these first, in order:
  1. guards and serialization
  2. LiveState and the events
  3. persist at stop and the migration

  Provenance (`registerAgentDataset`) and the thumbnail proxy can then move to a child task without blocking TASK-410. TASK-410 shows "no thumbnail" when `thumbnailUrl` is null.

## Implementation notes (2026-10-17)

Decisions made while implementing, and where the code differs from the spec above:

- **discard-last** discards the LAST take only. While capturing it ends the open take, then discards it, so the session goes between takes. A second press on a take that is already discarded answers `409 already_discarded`. It never walks back into the take before. With no take at all it answers `409 no_take`.
- **`DELETE …/episodes/:take` on the take being recorded restarts it** instead of discarding it. Every recorder (agent, SimFrameRecorder, client ledger) already treats "discard the live take" as "record it again" (TASK-402 D2), and the session page offers that trash icon on the Live row. The take keeps its number, its row is not flagged, and no `episode:discarded` is sent. It gets a fresh server start stamp, the audit entry is `episode.restart`, and the response carries `restarted: true`. Whether it restarted is read back from the recorder afterwards, so a take the robot auto-stopped in the meantime is discarded as a finished take. A take number the session never had answers `404 unknown_take`. An agent that does not carry out the discard answers `502 recorder_unavailable`, and nothing is flagged.
- **Auto-stops an action reads first.** An action records the agent's last stop as seen only when it is the take that action stopped. Any other unseen stop (the robot's `time_limit`) is persisted and broadcast as `by:{source:'auto'}` in the action's prelude, before the action's own events.
- **More refusal codes** than the spec lists: `not_recording` (409, the session is not `recording`) and `recorder_unavailable` (502, the agent did not answer or did not take the action). Every refusal body is `{code, error, live}`. When the refusal has no live state, the route reads one.
- **`takeStartedAt`** is the server's own stamp, taken when the begin returns (D5). It is not the agent's `episodeStartedAtMs`, which runs on the robot's clock. When there is no stamp (server restarted mid-take), it is derived from the agent's `episodeElapsedS` on the server clock.
- **`QuickCheck` gains `discarded`.** Every `episode:*` event also carries the full `live`, and `episode:started` carries `startedAt`. The WS envelope `data` therefore also gains `startedAt`.
- **New files beyond the list:**
  - `server/src/websocket/teleopEnvelope.ts` holds the typeMap and envelope, extracted from `websocket/index.ts` so they can be tested.
  - `server/src/services/teleoperation/takeLedger.ts` is the take bookkeeping shared by `SimFrameRecorder` and client-posted-frame sessions.
- **Rows are written at take start** (`startedAt`, `startedBy`) and completed at stop (quick check, `stopReason`, `stoppedBy`).
- **Persisting at end.** The agent's stop result numbers its `episodes` densely in dataset order. They are now mapped back to their take through `indexMap`. Before this, rows were written under the dataset index.
- **D3 also covers the SimFrameRecorder fallback.** It opens between takes, and its first take gets the next unused number.
- **Dataset `fps`** is the integer fps from `info.json` (else the session's fps), not the rounded measured rate. In the live check the measured rate was 15 while `info.json` said 30.
- **SO-101 sidecar sessions:** `episodes/next` now answers `409 unsupported_recorder` (it was a 400), with the same message.
- **Auto stops** (`time_limit`) are persisted with `stoppedBy {source:'auto'}` and broadcast. Only client mutations write a compliance entry.
- **Sidecar progress** events now carry defaults for `frameCount`, `fpsActual` and `degraded`, so every progress event is complete.
- **`thumbnailUrl`** is the server path `/api/teleoperation/sessions/:id/episodes/:take/thumbnail`, behind `protect`. A plain `<img>` only works with `AUTH_DISABLED`. TASK-410 has to fetch it with the bearer token (blob URL) when auth is on.
- **Behaviour until TASK-410:** a session starts between takes, so the existing "Next episode" button (or `episodes/start`) begins take 0.
- The write-route inventory (`src/__tests__/write-route-authorization.test.ts`) goes from 374 to 377: start, stop and discard-last, all on the guarded mount.

Live check (branch server :3108 with a DB copy, branch agent :41308, branch sim :8808 on DDS domain 58/lo). Every robot URL in the copy was repointed to a dead port first.
- A double start answers 409 `already_capturing`.
- Two concurrent `next` with `expectedTake:0` give one take 1 and one 409 `episode_conflict`.
- Stop returns a quick check with 62 frames, `jointsMoved` and a `thumbnailUrl`. The thumbnail is a 640x480 JPEG with `Cache-Control: private, max-age=3600`, and take 0 answers 404.
- discard-last, then discard-last again, gives 409 `already_discarded`. DELETE emits `teleop:episode:discarded`.
- End writes `datasetEpisodeIndex` 1→0, 4→1, 5→2. Discarded takes 2 and 3 are flagged, and the open take ends with `session_end`.
- A session with `episodeTimeS:2` emits `teleop:episode:stopped {reason:'time_limit', by:{source:'auto'}}`.
- 97 progress events were captured and all were complete. 12 compliance entries were written, one per mutation.
- Real-robot provenance is covered by unit tests only, since the real robot is off-limits.
