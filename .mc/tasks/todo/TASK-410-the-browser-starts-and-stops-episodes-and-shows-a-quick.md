---
id: "TASK-410"
aliases: []
title: "The browser starts and stops episodes and shows a quick check after each one"
slug: "the-browser-starts-and-stops-episodes-and-shows-a-quick"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "datacollection"]
sprint: ""
parent: ""
depends_on: ["[[TASK-408]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-18"
---

# The browser starts and stops episodes and shows a quick check after each one

## Description

TASK-408 gives the server explicit take start/stop/next/discard, a shared `LiveState`, and `teleop:episode:*` events. This task builds the browser side on the session page:
- Start/Stop take buttons and hotkeys;
- one take numbering everywhere;
- a server-synced take timer;
- a quick-check card after every take (duration, frames, which joints moved, thumbnail, Keep/Discard);
- toasts and sound cues when the other person acts;
- an E-stop button on the session page.

Recording should feel like "press, do, press, glance, next" rather than paperwork.

## Details

### Current state
- **`app/src/features/datacollection/pages/SessionDetailPage.tsx`** (537 lines)
  - Start, pause and end buttons at ~l.322-345. Start and End use `confirm()` (~l.171-195).
  - Hotkeys at ~l.199-220: Space start/pause, E end, N next.
  - Episodes are polled every 3 s while recording (~l.113-126), with a 2.5 s REST fallback.
  - The HUD duration falls back to the session `startedAt` (~l.102-111).
  - Hands `onNextEpisode` / `recording={episode, frames}` to `VRSessionPanel` (~l.456-483).
  - It has no E-stop.
- **`components/EpisodePanel.tsx`**: a Next button (~l.60-72) and per-row discard (~l.117-128). Rows read "Episode {episodeIndex}" (0-based), while the HUD and VR use `currentEpisode + 1`.
- **`components/SessionHud.tsx`**: duration, frames, fps and episode. TASK-406 removed "of N".
- **`store/datacollectionStore.ts`** (657 lines)
  - `handleTeleopEvent` (~l.410-464) **replaces** `recordingProgress` on every progress event (~l.417).
  - `nextEpisode` (~l.374) patches `currentEpisode` locally; `discardEpisode` is at ~l.394.
- **`hooks/useTeleopEvents.ts`** opens `/api/a2a/ws`, keeps `teleop:*` frames, and reconnects after 5 s.
- **Shared UI:** `app/src/shared/components/ui/FeedbackProvider.tsx` provides toasts. There is no audio anywhere in `app/src`.
- **Server (TASK-408):**
  - `GET /api/teleoperation/sessions/:id/live`
  - `POST …/episodes/start|stop|next|discard-last` with `{expectedTake, clientId, source}` → 200 `{live}`, or 409 `{code, live}`
  - `DELETE …/episodes/:take`
  - `GET …/episodes/:take/thumbnail`
  - WS `teleop:session:live {live}`, `teleop:episode:started|stopped|discarded {take, quickCheck?, reason?, by}`
  - `LiveState` and `QuickCheck` shapes as in TASK-408
- **E-stop API:** `app/src/features/safety/api/safetyApi.ts:43` posts `${BASE_URL}/robots/${robotId}/estop`, with reset at `:56`. `robotsApi.emergencyStop` is at `app/src/features/robots/api/robotsApi.ts:230`. Reuse the safety API call, which reaches the sidecar `/estop` path per TASK-398.

### Frontend
**Types and API**
- `types/datacollection.types.ts` gains `LiveState`, `QuickCheck` and `EpisodeActor`.
- `api` client gains `getLive`, `startEpisode`, `stopEpisode`, `nextEpisode` (with guard), `discardLast` and `thumbnailUrl(take)`.

**Store** (`datacollectionStore.ts`)
- `live: LiveState | null`, `lastQuickCheck: QuickCheck | null`.
- `clientId` is generated once per tab (`crypto.randomUUID()`).
- `teleop:session:live` replaces `live` as a whole (it is always complete).
- Legacy `teleop:session:progress` is **merged** into `recordingProgress`.
- `teleop:episode:*` updates `live` optimistically, refetches episodes, and sets `lastQuickCheck` on stopped.
- Actions `startTake(source)`, `stopTake(source)`, `nextTake(source)` and `discardLastTake(source)` send `expectedTake: live.take`. On 409 they adopt `live` from the body and show "Already started from the headset" (or similar, using `by`).
- The 3 s episode poll becomes a 10 s safety net while connected.
- Export `sessionStateSelectors` so TASK-413 (VR) and TASK-414 read the same state: `selectLive`, `selectTakeElapsedS(nowServerMs)`, `selectKept`.

**Numbering.** Everywhere in the UI a take is "Take N", where N = `take + 1`. Wire calls use the 0-based `take`. This covers the episode list, discard confirm, review table and `SessionCompleted.tsx`.

**`SessionHud.tsx`**
- Shows: big phase pill (`● REC` red / `READY` neutral / `PAUSED`), `Take N`, the take timer `mm:ss`, session total time, `kept K`, frames and fps, and a `DEGRADED` chip.
- The timer is computed from `takeStartedAt` plus the server offset (`live.at` vs `Date.now()`), so both clients agree.
- If auto-stop is set, it shows `auto-stop in Ns`.

**`EpisodePanel.tsx`**
- Shows one primary button by phase: **Start take** (between) or **Stop take** (capturing). Secondary buttons: **Next take** (capturing) and **Discard last**.
- Hotkeys:
  - Space: start/stop
  - N: next
  - Backspace: discard last, with a confirm toast that has Undo for 5 s; Undo cancels the request before it is sent
  - E: end session, still with a confirm
- Ignore hotkeys while typing in an input.
- Each row shows: Take N, duration, frames, a moved-groups chip (`L arm`, `R hand`…), the warnings as amber chips, a thumbnail (lazy `<img>`), and the actor ("by headset" / "by Anna").

**`QuickCheckCard.tsx` (new)**
- Appears for 8 s after every `episode:stopped`, or until dismissed.
- Contents: thumbnail, `Take N · 23.4 s · 707 frames · 30 fps`, moved groups, top 5 joints with range bars, and warnings (`short`, `no motion`, `dropped frames`).
- Buttons **Keep** (dismiss) and **Discard** (`DELETE …/episodes/:take`). A take with `no_motion` or `short` pre-focuses Discard.

**Cues**
- New `app/src/shared/utils/sessionCues.ts`: WebAudio-synthesized beeps, with no asset files:
  - take started: rising two-tone
  - take stopped: falling
  - discarded: low buzz
  - auto-stop warning: tick at −3 s
  - link or robot problem: double low
- A mute toggle on the HUD, persisted per viewer in `localStorage` (wrapped in try/catch).
- Toasts for remote actions: "Take 5 started from the headset", "Anna discarded take 4".

**Session lifecycle**
- Start (session) no longer starts a take: the session is "Ready", then Start take.
- Remove Pause for agent sessions. Keep End.
- Replace the `confirm()` dialogs with the shared `ConfirmDialog`.

**E-stop**
- Add a red **E-STOP** button, always visible in the session header. It calls `safetyApi` robot E-stop (`/robots/:id/estop`). Hotkey: `Escape` twice within 1 s.

**VR hand-off.** Keep passing `onNextEpisode` / `recording` to `VRSessionPanel` exactly as today, so VR keeps working. TASK-413 switches VR to the store.

### Key files
- app/src/features/datacollection/store/datacollectionStore.ts (+ test)
- app/src/features/datacollection/api/* (teleoperation client) (+ test)
- app/src/features/datacollection/types/datacollection.types.ts
- app/src/features/datacollection/hooks/useTeleopEvents.ts
- app/src/features/datacollection/pages/SessionDetailPage.tsx
- app/src/features/datacollection/components/{SessionHud.tsx, EpisodePanel.tsx, SessionCompleted.tsx, QuickCheckCard.tsx (new)} (+ tests)
- app/src/shared/utils/sessionCues.ts (new) (+ test)
- app/src/mocks/* (MSW handlers for the new routes, in a new file of their own; registering it is a one-line append, so it rebases cleanly against TASK-411)

## Decisions
- **D1 One primary button that changes with the phase.** Rejected: separate Start/Stop/Pause buttons, which make you read before you press.
- **D2 "Take N", 1-based, everywhere in the UI**, never reused after a discard (the TASK-402 take numbers).
- **D3 Keep is the default.** The quick check suggests Discard; it never auto-discards. Rejected: auto-discarding `no_motion` takes, because a still pose can be the task.
- **D4 Synthesized sounds**, muted per viewer. Rejected: audio files (assets, licensing).
- **D5 The E-stop is on the session page itself.** The assistant must not navigate away to stop the robot.

## Acceptance Criteria
- [ ] On a demo or MSW build, Start take → the HUD shows `● REC Take 1 00:00`, counting. Stop → the quick-check card appears with the thumbnail and moved groups. Discard → the row disappears and a toast says who discarded it.
- [ ] Two tabs on the same session (Playwright, MSW + a mocked WS or a live branch server): a start in tab A shows `● REC` and "started from …" in tab B within 1.5 s. Timers differ by ≤ 1 s.
- [ ] A stale `expectedTake` → 409 → the store adopts `live`, and the UI shows the toast, not an error page.
- [ ] A legacy `teleop:session:progress` with partial fields no longer wipes `frameCount` / `fpsActual` (store test).
- [ ] Hotkeys work and are ignored while typing. Backspace discard can be undone within 5 s.
- [ ] Take numbers are 1-based in every listed component (component tests).
- [ ] The E-STOP button is visible on the session page in every session state and calls the robot E-stop.
- [ ] `npx tsc` and the app vitest suites pass, as do the Playwright demo specs.

## Test Strategy
- **vitest:** store reducers for every event, the 409 adopt path, timer selectors with a server offset, `QuickCheckCard`, `EpisodePanel` hotkeys, and the `sessionCues` scheduling (mocked `AudioContext`).
- **Playwright demo build** with MSW handlers for the new routes, plus a two-context test.
- **Live run** with branch builds on free ports against the sim robot only.

## Implementation notes (2026-10-18)

Decisions made while implementing, and where the code differs from the spec above:

- **Store actions take the session id first**: `startTake(id, source)`, `stopTake`, `nextTake`, `discardLastTake(id, source, expectedTake?)`, `discardTake(id, take, source)`. Each returns whether the server took it; a refusal or a network error is a toast, never a thrown error or `state.error`. A second press while one is in flight is refused locally.
- **`clientId` is store state** (`useDataCollectionStore(s => s.clientId)`, typed on `DataCollectionState`), generated once per tab and kept across `reset()`; the same value is also exported as `CLIENT_ID` and sent with every take action.
- **API names**: `getLive`, `startEpisode`, `stopEpisode`, `nextEpisodeGuarded` (the old `nextEpisode` stays for recorders without explicit takes), `discardLast`, `discardTake` (DELETE with the guard body), `thumbnailUrl`, `fetchThumbnail`. Episode actions read a 409 body as `{ ok: false, code, live }` via `validateStatus`; the shared API client would otherwise drop `live`.
- **The 409 body has no `by`.** The conflict toast is chosen by `code`, and names the actor ("Already started from the headset") from the last `teleop:episode:*` event this tab saw for that take, when it saw one.
- **Cues and toasts fire exactly once per event**, whichever of the REST answer and its WebSocket echo arrives first (keyed by session, kind, take and start stamp). The tab's own start/stop gets a cue but no toast; its own discard toasts "You discarded take N"; everyone else's actions toast in words ("Take 5 started from the headset", "Anna discarded take 4", "Take 6 stopped automatically").
- **`confirm()` is already the shared `ConfirmDialog`** (the imperative host from `@/shared/components/ui`), so Start session and End session keep it. The session's Start button is renamed **Start session**: starting no longer records anything.
- **Discard last** (button and Backspace) uses the 5 s Undo toast and no dialog; the request is sent only when the window closes, pinned to the take that was last when it was asked for (`expectedTake`), so a take started in the meantime answers 409 instead of being discarded. The per-row trash keeps a confirm dialog; on the live row it reads **Restart take N** because the server restarts the take being recorded (TASK-408).
- **Pause** is hidden whenever the live state has a phase (agent and sim recorders); a recorder without explicit takes (SO-101 sidecar, `phase: null`) keeps Pause, Space-to-pause, N and the old Next episode button.
- **HUD**: the top bar carries the phase pill, `Take N` (between takes the number is the NEXT take, so a discarded number is never shown again), the take timer, `auto-stop in Ns`, `DEGRADED` and the mute toggle; the tiles are Session time, Frames, Frame rate and Kept.
- **Quick-check card**: hover or focus holds it past its 8 s; `no_motion` / `short` pre-focus Discard and turn it red, and nothing is ever discarded automatically (D3).
- **Thumbnails** are fetched through the API client as blobs (the route is behind auth) and cached per take (`utils/takeThumbnailCache.ts`); a take with `thumbnailUrl: null` or a 404 shows "No thumbnail". Rows only fetch once they scroll into view. When a take number starts again or is discarded, the store forgets its entry and revokes the blob URL, so a reused number never shows the old frame.
- **E-STOP** calls `safetyApi.triggerRobotEStop` with a reason naming the session page. Escape twice within 1 s fires it; Escape pressed while typing does not count, so closing a field cannot drop the robot.
- **Fixed on the way — every session hotkey was dead on a real page.** The shell keeps its closed mobile navigation drawer in the DOM as `role="dialog"` with `aria-hidden` + `inert`, and the old "a dialog is open" check matched it, so Space/E/N never fired outside unit tests. `utils/hotkeys.ts#isDialogOpen` ignores hidden, inert dialogs.
- **Layout**: below `xl` the Takes panel comes before the robot view and cameras, so an assistant on a tablet does not scroll for the controls.
- **The two-tab check is a live spec** (`app/e2e/live/datacollection-takes-sync.spec.ts`), not a demo spec: the demo build turns the WebSocket off, and two browser contexts share no MSW state. The demo spec (`app/e2e/datacollection-takes.spec.ts`) covers one tab end to end against new MSW handlers (`app/src/mocks/teleopTakesDemoHandlers.ts`, session `demo-session-takes`).
- `app/e2e/live/datacollection-vr.spec.ts` was updated to the new names (Start session, Start take, `take-next`, "Discard take 1") but not run; it already picked "the first robot" and used hash routes against a non-hash build.

Live check (2026-10-18, branch builds only: server :3110 on a copy of the dev DB with every robot and agent-card URL repointed to a dead port, agent :41310 `sim-t410-g1`, sim `sim_g1_dds` :8810 on DDS domain 60 / `lo`, app :1440). Before any write, a GET through the branch server showed the robot's sidecar at :8810 with the branch sim's boot id.
- Two browsers on one `vr_quest` session (simulated VR input driving the sim arms; the agent records only while commands reach the robot): A's Start take showed `● REC` and "Dev User started take 1" in B within 1.5 s; the two take timers differed by ≤ 1 s; Stop showed the quick check in both, with the head-camera thumbnail, 130 frames and L/R arm and hand moved; B's Discard removed the row in A and told A who discarded it; the header E-STOP latched the agent's E-stop.
- The 409 adopt path is covered by store tests only.
