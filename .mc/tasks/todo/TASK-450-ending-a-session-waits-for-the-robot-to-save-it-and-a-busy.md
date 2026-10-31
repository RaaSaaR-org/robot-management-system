---
id: "TASK-450"
aliases: []
title: "Ending a session waits for the robot to save it, and a busy robot refuses a new session"
slug: "ending-a-session-waits-for-the-robot-to-save-it-and-a-busy"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Ending a session waits for the robot to save it, and a busy robot refuses a new session

## Description

Three faults on the data-collection session path that bite a real G1 session.
End session gives up in the browser after 30 s while the robot is still
encoding the takes. A session started while the robot is still writing the
previous one silently records joints only, with no video. Discard-last marks a
take discarded even when the robot did not discard it.

## Details

### Current state

- `app/src/api/client.ts` gives every request a 30 s axios timeout.
  `datacollectionApi.endSession` sets none of its own. The server waits up to
  `STOP_TIMEOUT_MS = 300_000` (`server/src/services/AgentRecordingService.ts`)
  for the robot agent's `/recording/stop`, which encodes every kept take's
  video. The operator gets "Couldn't end session - timeout of 30000ms
  exceeded", End comes back enabled, and a second End fails with
  "Cannot end session in status: completed".
- `AgentRecordingService.classify` raises `AgentRecordingRefused` only for a
  4xx other than 404. A 5xx returns `null`, including the agent's
  `503 RECORDING_UNAVAILABLE` ("the previous recording is still being
  written", `robot-agent/src/recording/EpisodeRecorder.ts` `start`). On `null`,
  `TeleoperationService.startSession` falls back to the server-side
  `SimFrameRecorder` (joints only, no video, action equal to state) for a real
  robot, and nothing on screen says so.
- `TeleoperationService.startSession` turns a refusal into a plain `Error`.
  `sendFailure` (`server/src/utils/routeErrors.ts`) answers a plain `Error`
  with its fallback, so the app shows "Failed to start session" and never the
  robot's reason.
- `TeleoperationService.discardLast` ignores the boolean from
  `backend.discard(take)`. `discardEpisode` checks it.

### Server

- `AgentRecordingService.classify` takes an opt-in flag. With it set, a 5xx
  whose JSON body carries a string `code` (the agent knows the route) is an
  `AgentRecordingRefused`. A `503 RECORDING_UNAVAILABLE` gets the message
  "The robot is still saving the previous session. Try Start again in a
  moment."; any other coded 5xx keeps the agent's own message. Only `start`
  sets the flag: it is the one call where `null` means "use the other
  recorder". A 404, a network error, a timeout and an uncoded 5xx still return
  `null`. The other routes keep their behaviour.
- `startSession` throws a `ConflictError` (409, an operational error, so the
  route passes its message through). A 4xx refusal keeps today's sentence. A
  5xx refusal ("not yet") is passed through as is, without "Stop the
  recording", which is the wrong advice while the robot is still writing.
- `discardLast` checks the boolean the same way `discardEpisode` does: on
  `false` it throws `EpisodeActionError('recorder_unavailable', …)` with
  "The robot did not discard take N", does not mark the take discarded, and
  emits no `episode:discarded`.

### Frontend

- `datacollectionApi.endSession` posts with its own `timeout: 330_000`, just
  over the server's 300 s.
- The store's `endSession`, when the request fails, fetches the session. If it
  is `completed`, it applies it as a success and raises no error.
- The session command bar's End button reads "Saving takes on the robot…"
  while the request is pending. It stays disabled (`isLoading`). The E hotkey
  does not open a second End confirm while one End is pending.

### Key files

- `server/src/services/AgentRecordingService.ts`
- `server/src/services/TeleoperationService.ts`
- `server/src/services/__tests__/AgentRecordingService.test.ts`
- `server/src/services/__tests__/TeleoperationService.test.ts`
- `app/src/features/datacollection/api/datacollectionApi.ts`
- `app/src/features/datacollection/store/datacollectionStore.ts`
- `app/src/features/datacollection/components/console/SessionCommandBar.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`

## Acceptance Criteria

- [x] `endSession` posts with a 330 000 ms timeout.
- [x] While End is pending, the End button is disabled and reads "Saving takes on the robot…".
- [x] An End request that fails after the server completed the session shows no error.
- [x] Start against a robot that answers 503 RECORDING_UNAVAILABLE fails with "The robot is still saving the previous session. Try Start again in a moment." and starts no SimFrameRecorder.
- [x] A coded 500 from the agent's start is a refusal. A 404, a network error and a timeout still fall back.
- [x] The start refusal reaches the app as a 409 with the refusal's message, not "Failed to start session".
- [x] Discard-last with a robot that did not discard throws `recorder_unavailable`, and the take stays kept.

## Test Strategy

- Server vitest, `AgentRecordingService.test.ts`: start with 503 + `RECORDING_UNAVAILABLE` → refused with the friendly text; 500 + code → refused with the agent's message; 404, network error and timeout → `null`; a coded 5xx on a route other than start → unchanged.
- Server vitest, `TeleoperationService.test.ts`: startSession with a refusing agent throws a 409 `ConflictError` with the message and starts no SimFrameRecorder; discardLast with `discard` answering `false` throws and leaves the take kept with no `episode:discarded`.
- App vitest: `endSession` passes `{ timeout: 330_000 }`; the store treats a failed End on a now completed session as a success; `SessionCommandBar` shows the pending label and a disabled End.

## Notes

Found in the 2026-10-31 bug hunt before the real G1 session.
