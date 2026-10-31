---
id: "TASK-457"
aliases: []
title: "A session shows which recorder records it, and a real robot never records joints only"
slug: "a-session-shows-which-recorder-records-it-and-a-real-robot"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# A session shows which recorder records it, and a real robot never records joints only

## Description

When the robot agent does not answer Start in time, the server records the
session with its own SimFrameRecorder: joints polled from telemetry, no camera,
and `action` no different from `observation.state`. Nothing on screen says so,
because the session response does not carry `recorderKind`. Takes, timer and
quick checks look normal, and the dataset is useless for VLA training. TASK-450
makes the agent's 5xx answers a refusal. This task closes the rest. A real robot
never falls back to SimFrameRecorder, also not on a timeout or a network error.
And the session page always shows which recorder records the session.

Branch: `fix/task-457-a-session-shows-which-recorder-records-it-and-a-real-robot`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `server/src/services/AgentRecordingService.ts:207-218`, `classify`: a 4xx
  other than 404 throws `AgentRecordingRefused`. Everything else (5xx, a
  timeout, a network error) logs and returns `null`, "this agent cannot
  record". TASK-450, in progress on its own branch, turns a 5xx with a JSON
  `code` into a refusal. Timeouts and network errors still return `null` after it.
- `server/src/services/TeleoperationService.ts:509-570`, `startSession`:
  - `:521`: `recorderKind` starts as `'sidecar'` or `null`;
  - `:553`: `'agent'` when the agent answered;
  - `:562-568`: on `null`, `recorderKind = 'sim'`, it logs "falling back to the
    server-side SimFrameRecorder (joints only, no video)" and calls
    `startSimRecorder`;
  - the fallback is the same for a real robot and a sim robot.
- `recorderKind` is stored (`server/prisma/schema.prisma:1797`) and used on
  the server (`TeleoperationService.ts:425`, `:623`, `:834` …), but
  `toSessionResponse` (`TeleoperationService.ts:2967-2987`) leaves it out. The
  app's `TeleoperationSession`
  (`app/src/features/datacollection/types/datacollection.types.ts:38`) has no
  such field.
- How the app tells a sim robot today:
  `app/src/features/datacollection/pages/SessionDetailPage.tsx:610`,
  `robot.id.startsWith('sim-') || /sim/i.test(robot.model ?? '')`. The server
  has no such helper.
- The command bar's identity line shows robot, input and fps:
  `app/src/features/datacollection/components/console/SessionCommandBar.tsx:346-354`.
- Agent start timeout: `HTTP_TIMEOUTS.MEDIUM`, 10 s
  (`AgentRecordingService.ts:230`, `HttpClient.ts:17`), which a busy agent can
  exceed.

### Server

- A helper `isSimRobot(robot)` with the app's rule: id starts with `sim-`, or
  the model matches `/sim/i`. Put it next to the teleoperation types.
- `startSession`: when `agentRecordingService.start` returns `null` and the
  robot is NOT a sim robot, do not start SimFrameRecorder. Throw a
  `ConflictError`: "<robot> did not answer the recording start (<why>). Nothing
  is recording. Wait a moment and start the session again." Leave the session in
  `created`. A sim robot keeps today's fallback, and the log line stays.
- `toSessionResponse` carries `recorderKind` (`'agent' | 'sim' | 'sidecar' |
  null`). Add it to `SessionResponse` in
  `server/src/types/teleoperation.types.ts`.

### Frontend

- `TeleoperationSession.recorderKind` in `datacollection.types.ts`.
- `SessionCommandBar` identity line, after fps:
  - `agent` → "Video + joints";
  - `sidecar` → "Sidecar";
  - `sim` → "Joints only, no video", amber;
  - nothing while `null` (a created session).
  Use `data-testid="session-recorder"`. Below 640 px it hides like input and fps.
- The Record phase's Camera systems value says "not recorded" when
  `recorderKind === 'sim'`.

### Key files

- `server/src/services/TeleoperationService.ts`
- `server/src/types/teleoperation.types.ts`
- `server/src/services/__tests__/TeleoperationService.test.ts`
- `app/src/features/datacollection/types/datacollection.types.ts`
- `app/src/features/datacollection/components/console/SessionCommandBar.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/mocks/teleopTakesDemoHandlers.ts` (demo fixture: `recorderKind: 'agent'`)

## Acceptance Criteria

- [ ] A real robot whose agent times out or is unreachable at Start: the
  session stays `created`, the operator reads why, and no SimFrameRecorder runs.
- [ ] A sim robot keeps the fallback.
- [ ] Every session response carries `recorderKind`.
- [ ] The command bar shows the recorder; "Joints only, no video" is amber.
- [ ] Vitest covers both robot kinds on the null path, and the bar's three labels.

## Test Strategy

- Server vitest: stub `agentRecordingService.start` to return `null` for
  `g1-edu-4` and for `sim-g1-edu-dev`. The first throws and leaves the
  status `created`, with `startSimRecorder` not called. The second records with
  `recorderKind: 'sim'`. `getSession` returns `recorderKind`.
- App vitest: render `SessionCommandBar` with each `recorderKind` and assert the
  label and tone.
- Live check on the sim robot: Start a session and read "Video + joints" in the
  bar.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (session hunt finding 1 and its
  first improvement; data hunt finding 5).
- Land after TASK-450, which edits `AgentRecordingService.classify` and the same
  `startSession` block. Rebase on it, do not duplicate its 5xx mapping.
- TASK-441 (PR #463, open) also changes `toSessionResponse` and
  `SessionResponse` (adds `cameras`). Expect a small merge.
- Workaround: after each Start, check the server log for `agent-side recording
  started on <robot>`. If it says `falling back to the server-side
  SimFrameRecorder`, end the session at once and start a new one.
