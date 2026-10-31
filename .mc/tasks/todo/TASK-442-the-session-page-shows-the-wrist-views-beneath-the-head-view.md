---
id: "TASK-442"
aliases: []
title: "The session page shows the wrist views beneath the head view"
slug: "the-session-page-shows-the-wrist-views-beneath-the-head-view"
status: "review"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: ["[[TASK-441]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The session page shows the wrist views beneath the head view

## Description

On the data-collection session page, a session that records wrist cameras shows the head
view big with the two wrist views in a row beneath it (left on the left), and tells the
operator before Record when a chosen wrist camera is not delivering. A session without wrist
cameras looks and behaves exactly as today.

## Details

### Current state

- `app/src/features/datacollection/components/console/LiveView.tsx`: one main view in a 4:3
  frame + one picture-in-picture (PiP, twin or lead camera, ~115-127, 183-188); a view switch
  top-left listing Twin and every served camera (~122, 248-267); `leadCameraOf` = `/head/`
  match else first name (~41-44); `cameraLabel()` (~34-38); every camera name is mapped but
  only main/PiP mount (~215-235); bottom-left overlay row reserves space for one PiP
  (~279-286); "No head camera. Takes record without video." (~298) keyed on
  `names.length === 0`. Test ids: `session-lead-camera`, `session-camera-<name>`,
  `session-twin` with `data-slot` (asserted in `LiveView.test.tsx:33-87` and
  `app/e2e/live/two-person-session.spec.ts:229`).
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`: `useRobotCameras(robotId,
  5000)` (~500); Record console `lg:h-[var(--console-h,640px)]` with LiveView flex-1 over
  `SystemsStrip` (~1189-1206); Set up preview column (~893-918) is small.
- Readiness: `app/src/features/datacollection/utils/readinessRows.ts` camera row (~391-410,
  label "Head camera", value "N cameras"); `utils/preflight.ts` (~122-135) lists camera
  names, "no camera" is a warning; `utils/setupSteps.ts` has no camera systems cell (~72,
  520-600).
- E-STOP rule: E-STOP stays alone in the right zone of `SessionCommandBar`; no new control
  within 64 px of it (48 px at 1280 wide). Nothing here touches the command bar.
- From TASK-441: `session.cameras?: string[] | null`, `RobotCameraList.configured?`, and
  `app/src/features/datacollection/utils/cameras.ts` (`sessionWristCameras`,
  `cameraSetLabel`, `WRIST_CAMERAS`).

### Frontend

1. LiveView gets the session's wrist camera names (`sessionWristCameras(session)`). Empty
   → render exactly today's tree (no extra element, no extra stream).
2. Non-empty → a row of two 4:3 tiles **under** the main frame (not overlaid), left wrist on
   the left, right wrist on the right, each labelled ("Left wrist", "Right wrist"), test ids
   `session-wrist-left` / `session-wrist-right`. The head view stays the lead/main view;
   the twin keeps its PiP. Take the tile row's height from the main view so the console
   height is unchanged; check 1512 and 1280 wide and phone width.
3. Clicking a wrist tile swaps it into the main view and puts the head view in that tile;
   clicking again (or the head tile) swaps back. The view switch keeps listing every camera.
4. A wrist camera the session records but the robot does not serve right now → its tile
   shows a small "Left wrist camera offline" plate (no stream opened).
5. Hidden tiles open no stream; tiles unmount while the VR modal is open (as the page does
   for its other views today).
6. Readiness/preflight: for a session with wrist cameras, an extra "Wrist cameras" row
   (e.g. "2 of 2 live" / "Left wrist offline"); a chosen wrist camera that is not served is a
   **blocker** for Record with the reason "Left wrist camera is not being served". Head-only
   sessions: rows, labels and verdicts unchanged (do not turn tomorrow's Set up amber).
7. Show the session's camera set (`cameraSetLabel`) in the Record systems strip (a
   `SystemsCell` "Cameras · Head + 2 wrists") — only when the session has a camera list.
8. Set up preview: no wrist strip there (too small); the wrists are reachable via the view
   switch.

## Acceptance Criteria

- [ ] Head-only session (cameras null): DOM, test ids, streams and readiness identical to
      `main` (existing LiveView and SessionDetailPage tests pass unchanged).
- [ ] Head + wrists session: head big, two wrist tiles beneath (left/right correct), swap
      works, offline plate when a wrist is not served, Record blocked with a plain reason.
- [ ] No horizontal scroll at phone width; E-STOP clearance unchanged at 1512 and 1280.
- [ ] App typecheck + vitest green; a Playwright spec with mocked cameras covers both cases.

## Test Strategy

Vitest: LiveView head-only (unchanged) and head+wrists (tiles, order, swap, offline plate);
readinessRows/preflight for both session kinds. Playwright: a mocked spec
(`page.route('/api/robots/*/cameras')` → 3 names, `/api/robots/*/camera/*` → a static
multipart JPEG, session with/without `cameras`) at 1512, 1280 and 390 wide; screenshots in
the PR. Then a Playwright MCP walk against the dev sim with wrist cameras (TASK-440).
