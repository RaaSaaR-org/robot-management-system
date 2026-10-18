---
id: "TASK-416"
aliases: []
title: "The Quest opens the desktop's live session, and every take lands in the dataset as it was meant"
slug: "the-quest-opens-the-desktop-s-live-session-and-every-take"
status: in-progress
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "datacollection", "teleop"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-18"
updated: "2026-10-18"
---

# The Quest opens the desktop's live session, and every take lands in the dataset as it was meant

## Description

The end-to-end validation of the two-person flow on `main @ 12eb2326` found four ways a take can end up in the wrong place or with the wrong label. None of them shows an error.

1. The Quest's stable link `/data-collection/live?robot=<id>` jumps to any old READY session. The dev DB has one right now for g1-edu-4: "Appely", from 2026-10-16.
2. A desktop "Discard last" is silently cancelled when the headset starts the next take inside the 5 s undo window.
3. An E-stop leaves the take recording, and the aborted take is then kept by default.
4. A rehearsal on the supervisor's sim profile writes datasets labelled as real G1 data.

Fix all four so that the headset and the desktop always record into the same session, and a take is kept, discarded and labelled the way someone meant.

## Details

### Current state

- **Live link.** `app/src/features/datacollection/pages/LiveSessionRedirect.tsx:20-31`. `LIVE_SESSION_STATUSES = ['created','recording','paused']`, and `newestLiveSession()` takes the newest of those for the robot, with no age limit. The redirect fires once (`done.current`).
  - Repro: with no fresh session, `/data-collection/live?robot=sim-robot-g1-edu` redirected in 2.2 s to `f793f381` "Quest VR dry run UI - delete me", created more than a day earlier.
  - On the user's dev server, `GET /api/teleoperation/sessions?robotId=g1-edu-4&status=created` returns `90a5a59a` "Appely" (2026-10-16T15:04).
- **Discard race.** `app/src/features/datacollection/components/EpisodePanel.tsx:79-92` (`requestDiscardLast`). After a 5 s undo timer it calls `onDiscardLast(take)`, which posts `POST /api/teleoperation/sessions/:id/episodes/discard-last` with `expectedTake`.
  - If the headset started the next take in the meantime, `TeleoperationService.discardLast` (`server/src/services/TeleoperationService.ts:1090`) answers 409 `episode_conflict`.
  - `app/src/features/datacollection/utils/takeFormat.ts:91-94` turns that into "Take 10 was started elsewhere — showing it now". It does not say that take 9 was **not** discarded.
  - Measured: take 9 stayed in the exported dataset (episode 6, 123 frames).
  - A by-index discard already exists: `POST /api/teleoperation/sessions/:id/episodes/:index/discard` → `TeleoperationService.discardEpisode` (`:1131`, route `server/src/routes/teleoperation.routes.ts:~540`). It flags a finished take whatever is capturing now.
- **E-stop during a take.** `robot-agent/src/recording/EpisodeRecorder.ts:1032-1035` drops every tick while `hooks.isEStopTriggered()` is true ("an emergency stop is latched"). The take stays open:
  - the board and the HUD keep "● REC Take 11" and the timer runs on (17 s measured);
  - in VR every session button is dead except reset-estop, so only the desktop can stop it;
  - the take was then kept (107 frames, with only a "Dropped frames" warning).
  - The recorder already ends a take on its own for auto-stop: `endEpisode('time_limit')` at `EpisodeRecorder.ts:~1017`. The server already reconciles "a take boundary this server did not draw" (`TeleoperationService.ts:~1416`, `~1617`, `~2521`). `EpisodeStopReason` is `'operator' | 'time_limit' | 'next' | 'session_end'` (`server/src/types/teleoperation.types.ts:492`, `server/src/services/AgentRecordingService.ts:45`). The app shows the reason in a toast (`app/src/features/datacollection/store/datacollectionStore.ts:190`).
- **Sim provenance.** `EpisodeRecorder.ts:522` sets `this.simulated = arm ? arm.sim : true` from the sidecar's `/health`.
  - On the supervisor's sim profile (`robot-agent/hardware/profiles/sim-g1-edu-dev.yaml`, `robot: sim`), the real `g1_sidecar.py` fronts the MuJoCo sim and does not know it, so it reports `sim: false`.
  - `info.json._neodem` then says `source: 'neodem-real-teleop'`, `simulated: false`, `simBootId: null` (`EpisodeRecorder.ts:876`).
  - The same profile sets no `robotIp`/`pc2Camera`, so `g1_sidecar.py`'s auto camera source (`:1642-1667`) probes the robot LAN (192.168.123.164:5600 and :60000).
  - The sim facade (`robot-agent/hardware/sim_g1_dds/sim_node.py`) binds 0.0.0.0.
  - `sidecarSpec()` is in `robot-agent/supervisor/src/profile.ts:484`.

### Frontend: the live link

- A session is a candidate when its status is `recording` or `paused` (any age), or when it is `created` and its `createdAt` is less than `LIVE_CREATED_MAX_AGE_MS = 4 h` old.
- Exactly one candidate → redirect as today.
- More than one → do not guess. Show a list, newest first: name, status, "created 12 min ago". Tapping one opens it. Keep polling, so a session the desktop creates now appears in the list.
- None → wait as today. The waiting text names any ignored stale session: "Ignoring 'Appely' (created 2 days ago, never started). End it on the desktop if it is not needed."
- `newestLiveSession` becomes `liveCandidates(sessions, robotId, nowMs)`, kept pure and unit-tested.

### Frontend: the discard

- When the undo timer fires, send the discard **by take index**: the take that was named in the toast, via the existing `episodes/:index/discard` route (add a `discardEpisode(sessionId, index)` call to `app/src/features/datacollection/api/datacollectionApi.ts` and the store if they are missing). Do not use `discard-last`, so a take started elsewhere cannot cancel it.
- If the server still refuses, the toast names the take that survived: "Take 9 was NOT discarded — <reason>. Discard it from the take list." Never only "showing it now".
- Undo still sends nothing.
- `takeFormat.ts`: the `episode_conflict` text for a discard must name the take that was not discarded.

### Robot Agent and Server: the E-stop ends the take

- In `EpisodeRecorder.tick()`: the first tick that sees `isEStopTriggered()` while a take is open ends the take with reason `estop` (same path as `time_limit`), then flags it discarded (`discardEpisode`). It never begins a new take.
- Add `'estop'` to the stop-reason unions on the agent, the server (`EpisodeStopReason`, `AgentEpisodeEndReason`) and the app. The agent's `POST /robots/:id/recording/episodes/end` validator (`robot-agent/src/api/rest-routes.ts:1549-1555`) does not need to accept it, because the server never sends it.
- The server's reconcile path turns the agent's own stop into `episode:stopped` (reason `estop`) and `episode:discarded` (`by: {kind:'robot', reason:'estop'}` or the closest existing actor shape). Both views then show the take as stopped and discarded. Board and HUD leave REC within one live-state update.
- The app toast and quick check say "Take 11 stopped by the E-stop — discarded".

### Hardware and supervisor: sim rehearsals are labelled sim

- `profile.ts` `sidecarSpec()`: when `profile.robot === 'sim'`, add `G1_SIM_BACKEND=1` to the sidecar env.
- `g1_sidecar.py`: read `G1_SIM_BACKEND` and report it in `/health` `arm.sim`, the same field the recorder already reads. Readiness then shows `sidecar.sim: true`.
- `sim-g1-edu-dev.yaml`: set the camera source so the sidecar never probes the robot LAN. Use `G1_CAMERA_SOURCE` = none/off, or whatever the sidecar's off value is. A head camera in sim is out of scope.
- Run `sim_node.py`'s facade on 127.0.0.1 when the profile passes it (add a `--host` arg defaulting to today's behaviour, and pass 127.0.0.1 from the sim profile).
- Python stays 3.9-compatible (`robot-agent/hardware/tests/test_fstring_portability.py`).

### Key files

- app/src/features/datacollection/pages/LiveSessionRedirect.tsx + `__tests__`
- app/src/features/datacollection/components/EpisodePanel.tsx + `__tests__`
- app/src/features/datacollection/utils/takeFormat.ts
- app/src/features/datacollection/api/datacollectionApi.ts
- app/src/features/datacollection/store/datacollectionStore.ts (stop-reason toast only)
- robot-agent/src/recording/EpisodeRecorder.ts + tests
- server/src/services/TeleoperationService.ts, server/src/services/AgentRecordingService.ts, server/src/types/teleoperation.types.ts + tests
- robot-agent/supervisor/src/profile.ts + tests
- robot-agent/hardware/g1_sidecar.py, robot-agent/hardware/sim_g1_dds/sim_node.py, robot-agent/hardware/profiles/sim-g1-edu-dev.yaml, robot-agent/hardware/tests/

Overlap with parallel tasks: TASK-418 may touch `datacollectionStore.ts` (completed-session refresh). Keep this task's store change to the stop-reason text.

## Decisions

- **D1 Ambiguity shows a list, never a guess.** A wrong jump puts two people on two sessions and takes in the wrong dataset. Rejected: always newest (today's bug). Rejected: matching on presence, because the server keeps presence in memory only and REST does not see it.
- **D2 `created` sessions expire for the live link after 4 h.** A READY session nobody started for 4 h is not the one the desktop means. Recording and paused sessions never expire here.
- **D3 Discard by index.** The take the toast named is the take that is discarded. Rejected: committing early when another client starts a take, which still races the server.
- **D4 An E-stop aborts the take and discards it.** Frames after the latch are already dropped, so the take is truncated by definition. Re-recording costs one take; a silently kept aborted attempt costs training data. Rejected: keep it with a warning (today), and rely on someone remembering.
- **D5 The sim flag comes from the profile, not from guessing.** The supervisor knows `robot: sim`; the sidecar cannot tell MuJoCo from a G1 over DDS.

## Acceptance Criteria

- [ ] `liveCandidates` unit tests:
  - a 2-day-old `created` session is ignored;
  - a 2-day-old `recording` session is kept;
  - two fresh candidates → list;
  - one → redirect.
- [ ] Live (branch stack, sim robot): with a stale `created` session present, `/data-collection/live?robot=…` waits and names it. After the desktop creates a new session, it redirects to the new one within 2.5 s.
- [ ] Live, two contexts: B discards take N, A starts take N+1 within 1.5 s → take N is discarded on all three views (server live, desktop HUD, headset board) and is absent from the exported dataset.
- [ ] A forced discard refusal (vitest) shows a toast that names the surviving take.
- [ ] Live, sim agent only: A starts a take and presses B (E-stop) → board and desktop leave REC within 1 s; the take shows "stopped by the E-stop — discarded"; the exported dataset does not contain it; the next take after the reset records normally.
- [ ] A recording through the supervisor's sim profile writes `_neodem.simulated: true`, `source: 'neodem-sim-teleop'` and a non-null `simBootId`. Readiness shows `sidecar.sim: true`.
- [ ] With the sim profile, the sidecar opens no connection to 192.168.123.0/24 (no probe in its log), and the sim facade listens on 127.0.0.1 only (`ss -ltnp`).
- [ ] `npm run typecheck` (server, robot-agent), `npx tsc` (app), vitest (all three), hardware pytest and supervisor tests pass.

## Test Strategy

- **vitest:**
  - `liveCandidates`;
  - EpisodePanel undo/discard (fake timers; the API is called with the index);
  - the conflict text;
  - EpisodeRecorder E-stop ending a take (fake hooks, fake clock);
  - the server reconcile of an `estop` stop into stopped + discarded events;
  - `sidecarSpec` for `robot: sim` sets `G1_SIM_BACKEND`.
- **pytest:** `/health` reports `arm.sim` from `G1_SIM_BACKEND`; the sim facade's bind host.
- **Playwright live** (two contexts, IWER, branch app/server on free ports, sim agent): the discard race and the E-stop take.

## Safety constraints (binding for this task)

- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- No DDS publishing on domain 0 in development or tests. Use the sim on its own domain over `lo`.
- The E-stop is exercised against the sim agent only. This task must not change what the E-stop does to the robot; it changes only what the recorder does with the open take.
- Development and tests use the sim stack only: branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack, and do not edit or delete sessions in the user's dev DB (work on a copy).
