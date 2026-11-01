---
id: "TASK-459"
aliases: []
title: "Start take is refused while an E-stop is latched"
slug: "start-take-is-refused-while-an-e-stop-is-latched"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Start take is refused while an E-stop is latched

## Description

After an E-stop during a take, the dock lights Reset E-stop, but Start take
(secondary styling) and Space still work. A take started then opens take N+1,
the recorder's first tick sees the latch, ends it as `estop` and discards it,
and every client reads "Take N+1 was stopped by the E-stop … record it again".
That looks like a second E-stop, burns a take number and confuses the
assistant. This task makes the robot refuse to open a take while its E-stop is
latched, and disables the take primary and its hotkey while the page shows the
stop.

Branch: `fix/task-459-start-take-is-refused-while-an-e-stop-is-latched`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `robot-agent/src/recording/EpisodeRecorder.ts`:
  - `:624-642`, `beginEpisode()`: refuses only `not_recording` and
    `already_capturing`, and never reads the latch;
  - `:1030-1034`, the tick: `if (this.hooks.isEStopTriggered())` ends the open
    take with `'estop'` and discards it;
  - `:72`: the hook `isEStopTriggered: () => boolean` already exists;
  - `:156`: `BeginEpisodeResult`'s refusal codes.
- `robot-agent/src/api/rest-routes.ts:1538-1546`:
  `POST /robots/:id/recording/episodes/begin` answers 409 with `{ ok: false, code }`
  for a refusal.
- Server:
  - `server/src/services/AgentRecordingService.ts:266-284`, `beginEpisode`:
    `refusalCode(error, ['already_capturing', 'not_recording'])`, so any other
    code goes to `classify`;
  - `server/src/services/TeleoperationService.ts:1531-1533`, `takeBackend.begin`:
    maps a refusal to `not_recording` or `already_capturing`;
  - `:147-166`, `conflictMessage`, and `EpisodeConflictCode`
    (`server/src/types/teleoperation.types.ts:519`) hold the operator's words.
- App:
  - `app/src/features/datacollection/components/console/TakeDock.tsx:193-206`:
    Start take is `disabled={!!pending}` only. `primaryLit` (`:88`) only turns
    it secondary while the slot holds Reset E-stop;
  - `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
    - `:547`: `stop = robotStop({…})`, the latched-stop state;
    - `:1235`: `primaryLit={!(showRecovery && stop)}`;
    - `:342-352`: `useTakeHotkeys({…})` is called before `stop` is computed;
  - `app/src/features/datacollection/hooks/useTakeHotkeys.ts:76`:
    `canTake = isRecording && takeMode && !pending`.

### Robot Agent

- `beginEpisode()`: after the `not_recording` check, return
  `{ ok: false, code: 'estop_latched' }` while `this.hooks.isEStopTriggered()`.
  Add the code to `BeginEpisodeResult`. No take number is consumed
  (`nextTakeIndex` unchanged).

### Server

- `AgentRecordingService.beginEpisode`: accept `estop_latched` as a refusal code,
  and add it to `AgentBeginResult` (`AgentRecordingService.ts:100`).
- `takeBackend.begin` passes it through. Add `estop_latched` to
  `EpisodeConflictCode`, with the message "The robot's E-stop is latched — reset
  it and bring the robot to Balance, then start the take" (409).

### Frontend

- `useTakeHotkeys` takes a `blocked?: boolean`. `canTake` is false while it is
  set, so Space does not start a take. Stop take stays possible, because no take
  can be open under a latched stop.
- `SessionDetailPage`: pass `blocked: stop !== null` (move the `robotStop`
  computation above the hook, or feed it through a ref), and pass a
  `startBlocked` prop to `TakeDock`, which disables Start take with the title
  "Reset the E-stop first".

### Key files

- `robot-agent/src/recording/EpisodeRecorder.ts`
- `robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts`
- `server/src/services/AgentRecordingService.ts`
- `server/src/services/TeleoperationService.ts`
- `server/src/types/teleoperation.types.ts`
- `app/src/features/datacollection/hooks/useTakeHotkeys.ts`
- `app/src/features/datacollection/components/console/TakeDock.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`

## Acceptance Criteria

- [ ] With the E-stop latched, `episodes/begin` answers 409 `estop_latched`, and
  the next take after the reset still gets the next number.
- [ ] The server answers the E-stop sentence, not "recorder unavailable".
- [ ] While the page shows the stop, Start take is disabled and Space does not
  start a take.
- [ ] After Reset E-stop, Start take works again with no reload.
- [ ] Vitest covers the agent, the server mapping, the hook and the dock.

## Test Strategy

- Robot-agent vitest: a recorder with `isEStopTriggered` returning true refuses
  `beginEpisode` with `estop_latched`. After it turns false, the begin opens the
  take with the index that would have been next.
- Server vitest: `startEpisode` (`TeleoperationService.ts:998`) on an agent session whose agent answers 409
  `estop_latched` throws `EpisodeActionError` with that code and message.
- App vitest: `useTakeHotkeys` with `blocked` ignores Space; `TakeDock` with
  `startBlocked` renders Start take disabled.
- On the sim robot: E-stop during a take, then press Start take. The button is
  disabled. Reset, Balance, and the take starts.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (session hunt, finding 6).
- Workaround: after an E-stop, press Reset E-stop in the dock and wait for
  Balance before the next take.
