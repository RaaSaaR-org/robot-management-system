---
id: "TASK-402"
aliases: []
title: "The robot agent records each episode between an explicit start and stop at an integer frame rate"
slug: "the-robot-agent-records-each-episode-between-an-explicit"
status: "in-progress"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "datacollection", "lerobot"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The robot agent records each episode between an explicit start and stop at an integer frame rate

## Description

Today the agent's `EpisodeRecorder` opens episode 0 the moment the session starts and can only roll from one episode straight into the next. Episode 0 runs while the operator is still putting the headset on. One session (`10021615…`) was lost entirely with "no frames recorded — teleop is not engaged". The written LeRobot v3.0 dataset also stores `fps: 30.21`.

The recorder needs a "between takes" phase, explicit begin/end of an episode, an optional per-episode auto-stop, a quick check per episode (joints moved, thumbnail), an integer dataset fps, and an honest `simulated` flag in its result. This task is the agent side only. TASK-408 wires the server, and TASK-410 and TASK-413 build the UI.

## Details

### Current state
- `robot-agent/src/recording/EpisodeRecorder.ts` (982 lines)
  - `start(req)` (~l.349-454) opens episode 0 at once. The tick is `setInterval(Math.round(1000/fps))` at ~l.450-451, i.e. 33 ms, a nominal 30.30 Hz.
  - `nextEpisode()` (~l.458) closes the current episode and opens the next one.
  - `discardEpisode(index)` (~l.509) can discard the live episode.
  - `stop()` (~l.556) encodes and writes the dataset.
    - `fpsActual = measuredFps()` (~l.570; `measuredFps` at ~l.857-875).
    - `fpsForFile = round(fpsActual, 2)` (~l.634) is passed as `fps` to the writer.
    - Episodes are re-indexed densely after discards (~l.676-681).
  - `episodeReports` is at ~l.899; `episodeDir` (per-episode JPEGs in scratch `ep_NNN/<cam>/`) at ~l.967.
  - Design comments at ~l.241 say "fps is measured".
- `robot-agent/src/recording/lerobot-writer.ts` uses `fps` in four places:
  - `info.json.fps` (via `buildInfo` ~l.596, written ~l.227)
  - every `video.fps` (~l.204)
  - ffmpeg `-framerate` (~l.293)
  - row `timestamp = i/fps` (~l.445)
  - The comments at ~l.65 and ~l.441-444 describe fps as measured.
- `robot-agent/src/api/rest-routes.ts` recording routes:
  - `POST /robots/:id/recording/next-episode` (~l.1506)
  - `POST …/recording/episodes/:index/discard` (~l.1532)
  - `GET …/recording/status`
  - `start`/`stop` sit next to them.
- Live status shape (`GET :41245/api/v1/robots/g1-edu-4/recording/status`): `{ok, recording, sessionId, episodeIndex, frames, totalFrames, dropped, totalDropped, fpsTarget, fpsActual, degraded, lastDropReason, cameras, scene, behindS, episodes:[{episodeIndex, frames, dropped, durationS, fpsActual, retargetModes}], recordingMode, omittedJoints}`.
- `EpisodeRecorder.simulated` is known and written to `info.json._neodem.simulated`, but the stop result does not carry it. The server therefore labels real-robot datasets "Teleoperation in simulation" (fixed in TASK-408).

### Robot Agent
**Phases.** The recorder has `phase: 'between' | 'capturing'` while recording.
- `start(req)` accepts `{…existing, startBetweenTakes?: boolean, episodeTimeS?: number | null}`.
  - With `startBetweenTakes: true`, the tick timer runs but no episode is open. Ticks in `between` are neither frames nor drops.
  - Without the flag, behaviour is unchanged (episode 0 opens at once), so old callers and the SO-101 path keep working.
- `beginEpisode()`: refused (`{ok:false, code:'already_capturing'}`) while capturing. Otherwise it opens `current` with `takeTeleopModes()`, stamps `startedAtMs`, and returns `{ok, episodeIndex, phase:'capturing', startedAtMs}`.
- `endEpisode(reason)`: refused (`not_capturing`) while between. Otherwise it pushes `current`, sets `current = null` and `phase = 'between'`, records `lastStop = {episodeIndex, reason, atMs}`, and returns `{ok, episodeIndex, phase:'between', report: EpisodeReport}`.
  - `reason` is one of `'operator' | 'time_limit' | 'next' | 'session_end'`.
- `nextEpisode()` becomes `endEpisode('next')` followed by `beginEpisode()`. If the recorder is between takes, it just begins.
- **Episode indices are monotonic take numbers and are never reused.** Discarding take 3 does not renumber takes 4+ during the session. Dense re-indexing happens only in `stop()`, as today. The stop result returns `indexMap: {take: number, datasetEpisode: number | null}[]`, so the server can store both.
- **Auto-stop.** If `episodeTimeS` > 0, the tick that crosses `startedAtMs + episodeTimeS*1000` calls `endEpisode('time_limit')`. It never auto-begins.
- `stop()` during `capturing` calls `endEpisode('session_end')` first. A between-takes session with zero kept episodes stops with `{ok:false, code:'no_episodes'}`, and no dataset is written. It is not an exception.

**Status.** `status()` adds:
- `phase: 'between' | 'capturing' | null`
- `episodeStartedAtMs`, `episodeElapsedS`
- `elapsedS` (since `start`)
- `autoStopS`
- `lastStop`

Each entry of `episodes[]` gains `discarded:false` (discarded takes stay listed with `discarded:true`) and `jointsMoved`.

**Quick check per episode.** `EpisodeReport` gains:
- `jointsMoved: {name: string, rangeRad: number}[]`: max−min of `state` per joint over the episode, joints with range > 0.05 rad, sorted descending, top 12.
- `groupsMoved: ('left_arm'|'right_arm'|'left_hand'|'right_hand'|'waist'|'legs')[]`, derived from joint-name prefixes in the active joint config.
- `thumbnail: {camera: string, frame: number} | null`: the middle JPEG of the first camera.
- `warnings: ('short'|'no_motion'|'dropped_frames')[]`:
  - `short`: durationS < 2
  - `no_motion`: no joint above threshold
  - `dropped_frames`: dropped > 5 % of wanted ticks

The computation is a pure function, `summarizeEpisode(frames, jointNames, groups)`, in a new file `robot-agent/src/recording/episode-quick-check.ts`.

**Integer fps.**
- Round `req.fps` in `start` (~l.349).
- Pass `fps: Math.round(this.fpsTarget)` to the writer instead of `fpsForFile` (~l.634). That one value then sets `info.json.fps`, every `video.fps`, ffmpeg `-framerate` and `timestamp = i/fps`.
- Keep the measured rate only in `_neodem.fpsActual`, which is already written.
- Replace `setInterval` (~l.450) with a deadline scheduler: `setTimeout` to `t0 + n·1000/fps`. If more than one period late, count the missed ticks as drops and skip ahead instead of bursting. The measured rate then sits at the target rather than 30.3.
- Update the comments at EpisodeRecorder ~l.241 and lerobot-writer ~l.65 and ~l.441-444.

**Stop result.** Add `simulated: boolean` and `indexMap`, and keep everything else.

**Routes** (`rest-routes.ts`, recording block only; every route takes the same auth as `next-episode`):
- `POST /api/v1/robots/:id/recording/episodes/begin` → 200 `{ok, episodeIndex, phase, startedAtMs}` | 409 `{ok:false, code}`.
- `POST /api/v1/robots/:id/recording/episodes/end` with body `{reason?: 'operator'|'time_limit'}` → 200 `{ok, episodeIndex, phase, report}` | 409.
- `GET /api/v1/robots/:id/recording/episodes/:idx/thumbnail` → `image/jpeg` (the middle frame of that take's first camera) | 404 `{code:'no_thumbnail'}`. It is served from scratch only while the session lives. The route validates `idx` as an integer and resolves the path inside `episodeDir`, so there is no path traversal.
- The existing `next-episode` and `discard` routes keep their shapes.

### Key files
- robot-agent/src/recording/EpisodeRecorder.ts
- robot-agent/src/recording/episode-quick-check.ts (new)
- robot-agent/src/recording/lerobot-writer.ts
- robot-agent/src/api/rest-routes.ts (recording routes block only)
- robot-agent/src/recording/__tests__/* (extend EpisodeRecorder and lerobot-writer tests; new quick-check test)

## Decisions
- **D1 Between takes is opt-in through `startBetweenTakes`.** The server (TASK-408) always sets it for agent sessions. Rejected: changing the default, which would break the SO-101 and simulator paths and their tests in one go.
- **D2 Takes keep their number for the whole session**, and the dense dataset index is mapped only at stop. Two people saying "take 4" mean the same take. Rejected: renumbering live after a discard.
- **D3 The dataset fps is the integer target**, and the measured rate is metadata. LeRobot loaders expect an integer fps and use `i/fps` timestamps. Rejected: rounding the measured value, which can still produce 29 or 31.
- **D4 The quick check runs on the agent**, which holds the frames. The server only relays it. Rejected: the server reading frames back.
- **D5 Auto-stop never auto-starts the next take.** The operator resets the scene between takes.

## Acceptance Criteria
- [ ] With `startBetweenTakes`, `status()` after start reads `phase:'between'`, frames 0 and drops 0 for 3 s of ticks. `begin` → `capturing`, and `end` → `between` with a report.
- [ ] `begin` twice → the second returns 409 `already_capturing`. `end` while between → 409 `not_capturing`. `next` while between begins a take.
- [ ] `episodeTimeS: 2` ends a take by itself after about 2 s, with `lastStop.reason:'time_limit'`, and stays between.
- [ ] Discarding take 1 of takes 0-2 leaves take 2 numbered 2 in `status()`. The written dataset has episodes 0-1, and `indexMap` maps take 2 → 1.
- [ ] A written dataset has `info.json.fps === 30` (an integer) for a 30 fps session, `video.fps === 30` for every camera, ffmpeg `-framerate 30`, timestamps `i/30`, and `_neodem.fpsActual` within 0.5 of 30 in a 10 s fake-clock run.
- [ ] The report carries `jointsMoved`, `groupsMoved`, `warnings` and `thumbnail`. The thumbnail route serves a JPEG and rejects `../` and non-integer indices.
- [ ] The stop result carries `simulated` and `indexMap`.
- [ ] Old behaviour without the flag is unchanged: existing recorder tests pass unmodified.
- [ ] `cd robot-agent && npm run typecheck` and vitest pass.

## Test Strategy
- **vitest** with fake timers and a fake frame source:
  - phase transitions and 409s
  - auto-stop
  - discard and the `indexMap`
  - the deadline scheduler (late ticks become counted drops with no burst)
  - writer output: `info.fps` and `video.fps` are integers, and timestamps are `i/fps`
  - `summarizeEpisode` thresholds and groups
  - thumbnail path validation
- **Live check** with an agent built from this branch (the dev stack on :41246 runs `main`):
  - Run it on a free port (`PORT=41297`, `ROBOT_ID=sim-rec-check`, `ROBOT_TYPE=g1-edu`, `HARDWARE_SIDECAR_URL=http://localhost:8777`).
  - `POST /api/v1/robots/sim-rec-check/recording/start {sessionId:'manual-…', fps:30, startBetweenTakes:true}`, then begin, wait 3 s, end, then stop.
  - Check the dataset's `info.json`, then stop the agent.
  - Do not use the real g1-edu-4 agent (:41245).

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.
