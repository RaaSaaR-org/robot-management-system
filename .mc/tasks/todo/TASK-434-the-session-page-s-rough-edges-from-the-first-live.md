---
id: "TASK-434"
aliases: []
title: "The session page's rough edges from the first live walkthrough are gone"
slug: "the-session-page-s-rough-edges-from-the-first-live"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: [core, ui]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The session page's rough edges from the first live walkthrough are gone

## Description

A Playwright MCP walkthrough of the redesigned data-collection session page
(TASK-425 epic) with the sim robot `sim-g1-edu-dev` on 2026-10-30 found five
small defects. None blocks a take, but each one shows the assistant a number or
a state that is not true. This task fixes all five:

- (a) a 0-frame take counts as kept in Wrap up but not in the end toast;
- (b) Wrap up shows a frame rate and a motion score for a session with no frames;
- (c) the page asks for the control lease of an empty robot id;
- (d) the dock does not say why every frame is dropped;
- (e) an in-app navigation from one session straight to another stays on
  "Loading…".

Branch: `fix/task-434-the-session-page-s-rough-edges-from-the-first-live`.

## Details

### Current state

**(a) Takes kept: 1 in Wrap up, "0 takes kept" in the toast.** The session had
one take, and it recorded 0 frames.

- Wrap up counts every take that is not discarded:
  `app/src/features/datacollection/components/session/SessionCompleted.tsx:257`
  (`kept = episodes.filter((e) => !e.discarded)`), shown at `:338`
  ("Takes kept").
- The end toast uses the live state's count:
  - `pages/SessionDetailPage.tsx:381-383` passes `summaryRef.current.kept` to
    `sessionSummary()` (`utils/takeStreak.ts:76-80`);
  - that count comes from `selectKept` (`store/datacollectionStore.ts:1033-1034`),
    which is `live.kept` when there is a live state;
  - the server's `live.kept` drops 0-frame takes:
    `server/src/services/teleoperation/liveState.ts:149` and `:187`
    (`!discarded && frames > 0`).

**(b) Frame rate "30.0 fps" and Motion "50% smooth" with 0 frames.**

- `SessionCompleted.tsx:260`: `fps = measuredFps(kept) ?? session.fps`. With
  nothing measured it falls back to the target, and `:347` prints it as if
  measured.
- `SessionCompleted.tsx:348-353` prints `session.qualityScore`. The server
  writes 50 for fewer than 2 frames:
  `server/src/services/TeleoperationService.ts:1981-1982`
  (`return 50; // Neutral score for insufficient data`) in
  `computeSessionQuality()` (`:1975`).
- `TeleoperationSession.qualityScore` is nullable (`Float?` in
  `server/prisma/schema.prisma`).

**(c) `GET /api/robots//control-lease`, twice, 404 on first render.**

- `SessionDetailPage.tsx:431-435` calls `useSessionControlLease(session?.robotId ?? '', …)`
  before the session has loaded.
- `app/src/features/datacollection/hooks/useSessionControlLease.ts:43` passes
  the id to `useControlLease`.
- `app/src/features/robots/hooks/useControlLease.ts:329-345` calls
  `getControlLease(robotId)` with no guard for an empty id. The URL is
  `app/src/features/robots/api/controlLeaseApi.ts:15`.
- Other hooks on the page get the same `?? ''`: `useTelemetryStream` (`:173`),
  `useRobotBaseMode` (`:445`), `useRobotReadiness` (`:498`). Check whether
  they fetch with an empty id too.

**(d) Every frame dropped, and the dock does not say why.**

- While recording with teleop not engaged, the agent drops every frame:
  `robot-agent/src/recording/EpisodeRecorder.ts:1047-1049`
  (`this.drop('teleop is not engaged')`) when `isTeleopActive()` is false
  (`robot-agent/src/robot/state.ts:1695`, keyboard or VR teleop not entered).
- The reason is in the agent's `/api/v1/robots/<id>/recording/status`
  (`lastDropReason`). The server copies it into the live state
  (`server/src/services/teleoperation/liveState.ts:154`), and the app has it as
  `LiveState.lastDropReason` (`app/src/features/datacollection/types/datacollection.types.ts:178`).
- The dock shows only "Frames 0 · 0.0/30" (`HudReadouts`,
  `components/session/SessionHud.tsx:133`, wired at
  `pages/SessionDetailPage.tsx:1119-1128`) and a dropped count. Nothing turns the
  reason into words.
- The demo already sets a reason for its degraded fixture
  (`app/src/mocks/teleopTakesDemoHandlers.ts:163`, `agent_unreachable`).

**(e) Session → session navigation stays on "Loading…".**

- `useSessionDetail` in `app/src/features/datacollection/hooks/datacollection.ts:301-309`
  fetches only while `!hasFetched.current`. The ref is set once and never reset
  when `id` changes.
- So a hash navigation from one session page straight to another (same
  component, new `id`) never fetches the second session.
- The comment there says the ref guards an infinite loop (fetch fails →
  session stays null → re-fetch). That guard must stay.

### Frontend

- (a) One rule for "kept" everywhere: not discarded **and** at least one frame,
  as the server's live state counts. Wrap up's band uses it. The takes list may
  still show the empty take, marked as having no frames. A shared helper (e.g.
  in `utils/takeStreak.ts`) keeps the band and the toast from drifting.
- (b) With 0 frames, Wrap up shows "—" for Frame rate (not the target fps) and
  "—" for Motion. A session with frames keeps today's readouts. Decide whether
  Motion also shows "—" for exactly 1 frame (the server's 50 covers fewer than
  2) and note it.
- (c) `useControlLease` makes no request for an empty robot id. Check the other
  hooks listed above the same way.
- (d) While recording, a non-null `lastDropReason` shows in the dock as one plain
  sentence, next to the dropped count. Map the agent's known reasons to words,
  e.g. `teleop is not engaged` → "Frames are dropped: nobody drives the robot
  yet. Take control and move." Show unknown reasons verbatim. Keep it inside
  the dock's one-screen budget (TASK-428).
- (e) `useSessionDetail` resets its guard when `id` changes: remember which id
  was fetched, not just whether. The loop guard for a failing fetch of the same
  id stays.

### Server

- (b) Optional, if it is the cleaner fix: `computeSessionQuality()` returns
  `null` for fewer than 2 frames instead of 50, and the session stores no score.
  Check every reader of `qualityScore` for a null first. If the server keeps 50,
  the app's 0-frame rule above is enough.

### Demo

- `app/src/mocks/teleopTakesDemoHandlers.ts`: a fixture whose live state drops
  every frame with `teleop is not engaged`, and a completed session whose only
  take has 0 frames.

### Key files

- `app/src/features/datacollection/components/session/SessionCompleted.tsx`
- `app/src/features/datacollection/utils/takeStreak.ts`
- `app/src/features/datacollection/store/datacollectionStore.ts`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/components/console/TakeDock.tsx`
- `app/src/features/datacollection/components/session/SessionHud.tsx`
- `app/src/features/datacollection/hooks/datacollection.ts`
- `app/src/features/robots/hooks/useControlLease.ts`
- `app/src/mocks/teleopTakesDemoHandlers.ts`
- `server/src/services/TeleoperationService.ts` (only for the optional server fix)

## Acceptance Criteria

- [ ] (a) For a session whose only take has 0 frames, Wrap up and the end toast
  both say 0 takes kept. One helper defines "kept".
- [ ] (b) With 0 frames, Wrap up shows "—" for Frame rate and for Motion.
- [ ] (c) The session page's first render makes no request to
  `/api/robots//control-lease`, nor to any other URL with an empty robot id.
- [ ] (d) While every frame is dropped, the dock says why in one plain sentence;
  `teleop is not engaged` reads as words, not as the agent's string.
- [ ] (e) Navigating in the app from one session page straight to another shows
  the second session. A fetch that fails for one id is still not retried in a
  loop.
- [ ] Set up and Record keep exactly one lit action, and the E-STOP clearance
  checks in `app/e2e/datacollection-console.spec.ts` stay green.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run`, with new cases for:
  - `SessionCompleted` with a 0-frame take (kept 0, Frame rate "—", Motion "—");
  - the shared "kept" helper;
  - `useSessionDetail` re-rendered with a new id (a fetch for the new id, none
    repeated for a failing one);
  - `useControlLease('')` (no request);
  - the dock's drop sentence.
- If the server changes, run `cd server && npm run typecheck && npx vitest run`.
- Playwright demo specs `datacollection-console` and `datacollection-takes`, plus
  one new block: the drop fixture shows the sentence, and a hash navigation
  from `demo-session-takes` to another demo session renders the second one.
- Re-run the walkthrough with `sim-g1-edu-dev` and check the network log for
  `robots//`.

## Notes

- Found in a Playwright MCP walkthrough with `sim-g1-edu-dev` on 2026-10-30,
  filed from the TASK-424 preparation.
