---
id: "TASK-392"
aliases: []
title: "Starting a data collection session asks only for robot, task and input device"
slug: "starting-a-data-collection-session-asks-only-for-robot-task-and-input-device"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-10-18"
created: "2026-10-17"
updated: "2026-10-17"
---

# Starting a data collection session asks only for robot, task and input device

## Description
Operators who press "New session" in Data collection meet every option at once: six
input devices, robot, task, episodes, episode length and frame rate, all equal weight.
For a normal user that is too much. The page should ask only what every recording needs
(robot, task, input device, how many episodes) and keep everything else reachable behind
an "Advanced options" disclosure that remembers its values. The session page should then
say, before Start, whether the robot, camera, recorder and input are ready — so the first
real-robot collection with the Meta Quest (2026-10-18) does not start blind.

## Details

### Current state
- `app/src/features/datacollection/pages/NewSessionPage.tsx` renders two panels: an
  "Input" panel with `SessionTypeSelector` (six radio cards: Meta Quest VR, Vision Pro,
  Bilateral ALOHA, Kinesthetic Teaching, Keyboard & Mouse, Gamepad) and a "Robot and
  task" panel with robot `Select` (all robots, offline ones suffixed), task `Input`,
  episodes, episode length and frame rate — every field always visible.
- The server's `POST /api/teleoperation/sessions` (`CreateSessionDto` in
  `server/src/types/teleoperation.types.ts`) also accepts `datasetRepoId` (the
  LeRobot `repo_id` the recorder writes and the dataset name on export); the form never
  offers it, so every dataset is named after the task text.
- `app/src/features/datacollection/pages/SessionDetailPage.tsx` shows "Start recording"
  for a `created` session with no readiness check: an offline robot, a robot with no
  camera, or a gamepad that is not connected only show up after recording started.
  Its Cameras panel hard-codes `top` and `wrist`, which a G1 (`head_camera` via PC2's
  `pc2cam` source) never serves.
- There is no collapsible/disclosure component in the UI kit (`app/src/shared/components/ui`).

### Frontend
1. **Kit `Disclosure`** (`app/src/shared/components/ui/Disclosure.tsx`, exported from the
   kit barrel, listed in `docs/brand.md` §5): a button header with a chevron, title,
   optional one-line summary shown while collapsed, `aria-expanded`/`aria-controls`,
   controlled or uncontrolled `open`.
2. **NewSessionPage default view**, in one `Panel`:
   - **Robot** — `Select`, online robots first (status in the label), offline ones last;
     preselects the remembered robot when it is still online, else the only online one.
   - **Task** — one text field plus up to five recent instructions as `ToggleChip`s
     (remembered locally, newest first, deduplicated).
   - **Input device** — three large `ChoiceCard`s: Meta Quest VR, Keyboard & mouse,
     Gamepad. Defaults to the remembered device, else Meta Quest VR.
   - **Episodes** — number, default 10.
   - One primary "Start session" button in the sticky footer (+ ghost Cancel).
   - VR prerequisites hint stays when a VR device is chosen.
3. **Advanced options** (`Disclosure`, collapsed by default): episode length, frame
   rate, dataset name (`datasetRepoId`, optional, `name` or `owner/name`), and the
   other input devices (Vision Pro, Bilateral ALOHA, Kinesthetic teaching), plus the
   operator the session is recorded for (read-only, the signed-in user). While collapsed
   it shows a summary line of every value that differs from the default. Episode count,
   episode length, frame rate, device and robot are remembered per user in
   `localStorage` (`neodem.datacollection.newSession.v1:<userId>`, every access in
   try/catch); the dataset name is not remembered (it names one dataset). An invalid
   advanced field opens the disclosure so its error is visible.
4. **Pre-flight checklist** on `SessionDetailPage` while the session is `created`
   (`app/src/features/datacollection/components/PreflightChecklist.tsx` + pure
   `app/src/features/datacollection/utils/preflight.ts`): robot online (blocking),
   recorder — the robot agent's live stream is connected (warning), camera — from
   `useRobotCameras` (warning: records without video), input — per device: VR needs a
   secure context with WebXR in the headset browser (warning, with the adb reverse
   hint), gamepad connected via the Gamepad API (warning), keyboard always ready; and
   control taken when the server advertises leases (warning). Each row is ok / warning /
   blocking, and the panel names one next action. A blocking row disables "Start
   recording" and the Space hotkey; warnings do not. Hotkeys stay.
5. The Cameras panel shows the robot's real camera names from `useRobotCameras`
   (falls back to top/wrist when the robot answers none).

Out of scope: `SessionCompleted.tsx` (TASK-394), `VRSessionPanel.tsx` and
`app/src/features/robots/components/tabs/vr/*` (TASK-393), server changes.

### Key files
- `app/src/shared/components/ui/Disclosure.tsx` (new), `app/src/shared/components/ui/index.ts`
- `app/src/features/datacollection/pages/NewSessionPage.tsx`
- `app/src/features/datacollection/utils/newSessionPrefs.ts` (new)
- `app/src/features/datacollection/components/PreflightChecklist.tsx` (new)
- `app/src/features/datacollection/utils/preflight.ts` (new)
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/components/CameraStreamView.tsx`
- `app/e2e/live/datacollection-vr.spec.ts`
- `docs/brand.md`

## Acceptance Criteria
- [x] The New session page shows exactly four fields by default: robot, task, input device (three cards) and episodes; one primary button "Start session". — `NewSessionPage.tsx:199` (robot), `:292` (episodes), `:387` (button)
- [x] "Advanced options" is collapsed by default and, while collapsed, summarises the values that differ from the defaults. — `NewSessionPage.tsx:117`, `:311`; `Disclosure.tsx`
- [x] Episode length, frame rate, dataset name and Vision Pro / ALOHA / kinesthetic input are reachable under Advanced options; no option the page offered before is gone. — `NewSessionPage.tsx:311-374`
- [x] Advanced values (except the dataset name) and the last robot and device are remembered per user and survive a reload; storage failures do not break the page. — `newSessionPrefs.ts:48`, `NewSessionPage.tsx:161`
- [x] The submitted request carries every advanced value, including `datasetRepoId` when set. — `NewSessionPage.tsx:158`
- [x] Robot and task are validated inline; an invalid advanced value opens the disclosure and blocks submit. — `NewSessionPage.tsx:147`
- [x] Online robots are listed first with their status; recent task instructions appear as chips that fill the task field. — `NewSessionPage.tsx:86`, `:236`
- [x] A `created` session shows a pre-flight checklist (robot, recorder, camera, input, control) with blocking vs warning states and one named next action; a blocking item disables Start recording and the Space hotkey. — `preflight.ts:96`, `SessionDetailPage.tsx:360`, `:297`, `:193`
- [x] The Cameras panel shows the cameras the robot actually serves. — `SessionDetailPage.tsx:399`
- [x] Design-drift test, app typecheck and app vitest pass.

## Test Strategy
- Vitest + Testing Library: `NewSessionPage.test.tsx` (default fields, advanced collapsed, summary line, persistence across remount, submitted request, validation, storage throwing), `Disclosure` in the kit tests, `preflight.test.ts` for the pure checklist logic, `PreflightChecklist.test.tsx` for rendering.
- `app/e2e/live/datacollection-vr.spec.ts` updated for the new labels.
- Screenshots of the new page in light and dark from a worktree dev server.

## Notes
- 2026-10-17: built for the 2026-10-18 real-robot collection run (G1 EDU + Meta Quest 3); TASK-391/393/394 run in parallel.
- 2026-10-17: implemented on the branch. Gates: app `tsc` clean, app vitest 214 files / 2868+ tests green (incl. design-drift),
  Playwright `app-routes`, `demo-api-contract`, `demo-smoke` green (153). `e2e/live/datacollection-vr.spec.ts` updated but not run
  (needs a live stack; the running one is in use). The default episode count is now 10 (was 3); frame rate stayed 10 fps (changed to 30 below).
- The robot is not preselected when more than one robot is online (real and sim side by side) — choosing between them stays explicit.
- 2026-10-17: reviewed (range `origin/main...HEAD`). One fix: the Recorder row no longer claims "it records every frame" when all it knows is
  that the agent's live stream is connected. "Recorder ready" is a proxy until the real recorder's state (TASK-391 sidecar health) reaches the app.
  Open for a human: frame rate default stays 10 fps (LeRobot G1 datasets usually use 30); `e2e/live/datacollection-vr.spec.ts` not run.
- 2026-10-17: owner decided the frame rate default is 30 fps ("30 is perfect"), the rate LeRobot G1 datasets use. Only the app
  had 10: the server (`TeleoperationService` `DEFAULT_FPS`), the Prisma column default and the agent's `EpisodeRecorder` were
  already 30. `NEW_SESSION_DEFAULTS.fps` is now 30 and the help text says so. Remembered values are now stored only where they
  differ from the default, and the storage key moved to `v2`, so a browser that used the form at 10 fps does not keep 10.
  Checked that 30 fps works with the inputs: the recorder samples the commanded pose (forwarded at 50 Hz) and the sidecar's
  newest camera JPEG on each tick, and the pc2cam reader answers at once with its held frame, so a ~15 fps head camera repeats
  its last picture rather than dropping rows; timestamps are `index / measured fps`. Pinned with an `EpisodeRecorder` test (15 fps
  camera at 30 fps: no drops, each row has the picture its tick was served, video frames = rows, fps ~30) and a sidecar test
  (30 Hz reads of a 15 fps publisher never block and repeat the held frame). Gates: app `tsc` clean, app vitest 214/2871 green
  (one unhandled undici WebSocket error from `DashboardPage.requests.test.tsx`, pre-existing on main); robot-agent typecheck
  clean, vitest 156/2566 green; `robot-agent/hardware/tests` 216 passed, 18 skipped.
