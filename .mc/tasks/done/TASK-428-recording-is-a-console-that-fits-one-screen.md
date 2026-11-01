---
id: "TASK-428"
aliases: []
title: "Recording is a console that fits one screen"
slug: "recording-is-a-console-that-fits-one-screen"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ui"]
sprint: ""
parent: "[[TASK-425]]"
depends_on: ["[[TASK-427]]"]
spe: 8
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# Recording is a console that fits one screen

## Description

Third slice of [[TASK-425]]. On a `recording` or `paused` session, the page becomes a
console that fits a 1512×945 screen without scrolling, under the command bar from TASK-426:
- the big live view, with the camera as the main view and the twin as the PiP;
- a systems strip of seven cells under it;
- a take dock (pill, timer, one primary, readouts);
- the takes list, filling the rest of the right column.

This replaces the assistant grid, `SessionHud`, `EpisodePanel`, `OperatorCard`, the compact
"Robot side" panel and `QualityIndicator` in Record. The take hotkeys, toasts and confirms
stay exactly as they are.

Branch: `feat/task-428-recording-is-a-console-that-fits-one-screen`.

## Details

### Current state

- After TASK-426 and TASK-427:
  - the bar holds `hud-mute` and End session;
  - `utils/setupSteps.ts` returns the systems cells;
  - `components/console/LiveView.tsx` exists, used by the Set up preview.
- Record still renders the old `session-assistant-layout` grid:
  - the twin;
  - the lead camera;
  - `SessionHud` (`components/session/SessionHud.tsx`);
  - `OperatorCard` (with its Quest buttons);
  - `EpisodePanel` (`components/EpisodePanel.tsx`, 353 lines, which owns the take buttons
    and the Space / N / Backspace hotkeys);
  - the compact `RobotReadinessPanel`;
  - `QualityIndicator`;
  - the violet degraded banner;
  - `QuickCheckCard` above.
- The demo `#/data-collection/demo-session-takes` (`src/mocks/teleopTakesDemoHandlers.ts`)
  is a `keyboard_mouse` recording session. For the VR cells and the operator chip, add a VR
  variant of that fixture in the same file if the e2e needs one.

### Frontend

Build to the epic's section **"RECORD (recording, paused) — the console"**. It holds the
console grid, live view, systems strip, take dock, slot priority, readouts, takes list,
the dock variants diagram and the classes. Also apply Explicit changes 1, 6 (the degraded
message in amber) and 11 (the Quest controls in the Headset cell popover only).

What this slice decides and builds:
- **`hooks/useViewportFill.ts`.** It sets `--console-h` to `innerHeight − console top
  (page coords) − 24`, with a minimum of 520. It re-measures on resize and through a
  `ResizeObserver` on `document.body`, so the alarm banner shrinks the console, never the
  page.
- **`SystemsStrip`.** It renders the cells from `setupSteps.ts`. A cell click opens a popover
  with that step's body: the same controls as in Set up (`ControlLeaseBar` with
  `showEstop={false}` and `session-control-lease` only when the page uses its own inputs;
  `RobotModeControl variant="step"`; `QuestControls` while the operator is not in VR; or
  the Details rows).
- **`TakeDock`.** The root keeps `session-hud`.
  - The header row holds no control: it lies under the E-STOP.
  - The hero switches between the timer, `QuickCheckCard variant="dock"` and `00:00`.
  - The slot (`take-dock-slot`, `data-kind="recovery|blocker"`) has the priority recovery
    → blocker → quick check.
  - One 52 px primary.
  - Next take / Discard.
  - The readouts and the Motion meter.

  Fold `SessionHud` into it or reduce `SessionHud` to the header, timer and readouts. Keep
  every `hud-*` id.
- **`TakesList`.** `EpisodePanel`'s list rows, with the same row ids and confirms. Delete
  `EpisodePanel` once it is empty. Move its hotkey logic **unchanged** into
  `hooks/useTakeHotkeys.ts`.
- **`OperatorChip`.** It shows the avatar, the latency and the grip bars
  (`operator-status`, `operator-card`, `operator-grip-left`, `operator-grip-right`).
  `operator-why` and `operator-held` move to the Arms cell and the dock blocker.
  `OperatorCard` keeps only what feeds the chip; its Quest buttons go.
- **Paused (legacy).** Resume is the primary in the dock, and Pause and Next episode are
  secondaries. Pause stays in the dock, never in the bar.

### Key files

Create:
- `app/src/features/datacollection/hooks/useViewportFill.ts`
- `app/src/features/datacollection/hooks/useTakeHotkeys.ts`
- `app/src/features/datacollection/components/console/SystemsStrip.tsx`
- `app/src/features/datacollection/components/console/TakeDock.tsx`
- `app/src/features/datacollection/components/console/TakesList.tsx`
- `app/src/features/datacollection/components/console/OperatorChip.tsx`

Modify:
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`: the Record layout (JSX
  only).
- `.../components/session/SessionHud.tsx` and its test.
- `.../components/session/QuickCheckCard.tsx` and its test: `variant="dock"`, keeping every
  `quick-check-*` id and the E-stop verdict.
- `.../components/OperatorCard.tsx` and its test.
- `.../components/console/LiveView.tsx`:
  - the camera main view;
  - the PiP swap;
  - the recording ring and reticle;
  - the operator chip slot.
- `.../components/index.ts`: exports.
- `app/e2e/datacollection-takes.spec.ts`: it reads only ids the dock and the list keep
  (`hud-*`, `take-*`, `quick-check-*`, `episode-row-0`, `session-estop`), so expect no
  change. Any change it needs is a selector update, nothing else.
- `app/e2e/datacollection-console.spec.ts`: add the Record block.

Delete:
- `.../components/EpisodePanel.tsx` and `__tests__/EpisodePanel.test.tsx`, once their cases
  are covered by `TakeDock` / `TakesList` / `useTakeHotkeys` tests.

### Live specs

The specs under `app/e2e/live/` run against a live stack (`npx playwright test
--config=playwright.live.config.ts`). They are not part of `test-all.sh` and the epic does
not list them, but several of them open the session page. Update their selectors in the
same PR, even if you cannot run them here, and say so in the PR.

In this slice:
- `two-person-session.spec.ts` and `vr-estop-recovery.spec.ts` read `operator-card`,
  `operator-status`, `operator-why`, `operator-grip-right` and `control-lease-holder`,
  which move to the operator chip, the Arms cell and the Control cell.
- `two-person-session.spec.ts:227-228` asserts that `session-twin` and
  `session-lead-camera` are absent while the VR modal is open. Keep that true.
- `datacollection-vr.spec.ts` reads `hud-episode`, `take-next` and `episode-discard-*`.

### Visual reference

While the scratchpad exists, compare against
`/tmp/claude-1002/-home-humanoid-develop-robot-management-system/80869d0d-8d7d-4554-975b-5fccdc543248/scratchpad/ui/mockup/record-1512.png`,
`record-check-1512.png`, `record-fault-1512.png`, `record-1280.png`, `record-1920.png`,
`record-tools-1512.png`, `record-390.png`, `record-390-full.png` and `record-zema-1512.png`
(same folder). The page must match them closely.

## Acceptance Criteria

From the epic's criteria, the parts assigned to this child (ownership table under the
epic's "Split"):

- [ ] **Record fits.** At 1512×945, on `#/data-collection/demo-session-takes` (demo build,
  MSW), in three states: during a take, between takes with the quick check open, and with a
  blocker in the slot. In each:
  - `document.documentElement.scrollHeight <= window.innerHeight`;
  - the live view, the systems strip, the take dock primary and the E-STOP are inside the
    viewport.

  The same holds at 1920×1080 and 1280×800. It is measured in
  `app/e2e/datacollection-console.spec.ts`.
- [ ] **One lit action in Record.** Capturing and between takes each show exactly one
  visible kit `primary` button, not counting the E-STOP. A disabled primary counts as not
  lit.
- [ ] **No duplicates in Record, on a live VR session.**
  - At most one element each with `quest-connect`, `quest-open` and
    `quest-copy-viewer-link`.
  - The text "Open on headset" occurs once.
  - The readiness reason sentence occurs at most once in the DOM.
  - The kept count is rendered once (`hud-kept`; `episode-progress` is gone).
- [ ] **Diagnostics in Record.** A robot with readiness reason `mode_not_balance` shows the
  reason in the Mode cell and the recovery slot, and nowhere else.
- [ ] **Every function within one disclosure, in Record.** Each of these is reached with
  at most one click:
  - Start / Stop / Next / Discard take, Keep and Undo;
  - through a systems cell: Start robot side, Take control, Switch to arm control,
    Limp / Stand up / Balance, Ask the headset, Connect, Open on headset and Copy viewer
    link.
- [ ] **E-STOP stands alone, page-wide in Record.** The nearest other interactive element
  is ≥ 64 px from the E-STOP at 1512×945 and 1920×1080, and ≥ 48 px at 1280×800, at scroll
  position 0. This holds while capturing, between takes and with a blocker, and with
  Testing tools open.
- [ ] **Phone (390×844), Record.**
  - No horizontal scroll.
  - Stop / Start take stays in the take dock in the page, not in the bottom dock.
- [ ] **Brand, Record.** It renders correctly in the light theme and with the ZeMA
  `brand/` config.
- [ ] **Screenshots.** The PR shows before/after screenshots of Record, capturing and
  between takes, at 1512×945, 1920×1080 and 390×844.
- [ ] **SectionRail clearance in every phase** (added 2026-10-30 by the main session). At
  1280×800, scroll 0, the shell's SectionRail tabs (`nav[aria-label="Section"]`,
  "Research" / "Activity") sat 35 px above the E-STOP in Record and Wrap up. TASK-427 fixed
  it for Set up only, with 16 px extra top padding between 640 and 1439 px. The spacing
  applies to the bar in every phase, not per phase, and the console e2e asserts the
  page-wide distance ≥ 48 px at 1280 **including the rail**, in Set up, Record and Wrap up.
- [ ] **Shell height** (added 2026-10-30). When a page is shorter than the viewport (Set up
  and Wrap up now fit one screen), the Sidebar's `bg-inset` column reaches the bottom of
  the viewport instead of stopping where the content ends:
  `app/src/components/layout/AppLayout.tsx` gives the flex row under the TopBar
  `min-h-[calc(100dvh-3.5rem)]` (or equivalent). Another short page (a settings page) still
  looks right, and nothing scrolls that did not before.
- [ ] **One rising edge per lease hand-over trigger** (added 2026-10-30, a nit from
  TASK-427's review). In `SessionDetailPage` the hand-over's two triggers no longer share
  one rising edge (`due = vrModalOpen || leaseDone`): `useLeaseHandOver` is called once per
  trigger with its own message, so opening the page's own VR window is a rising edge even
  when the robot already balances with arm control on, and the VR-window toast no longer
  claims "The robot balances with arm control on". A vitest covers both triggers.
- [ ] **Gates (every child).**
  - `design-drift.test.ts` passes, with no raw hex or hue utilities, no `backdrop-filter`
    and no glow shadows.
  - `./scripts/test-all.sh --skip-pw` is green.
  - The four Playwright specs are green, with only this slice's selector updates.

## Test Strategy

- **Vitest.**
  - `SessionDetailPage.takes.test.tsx` passes **unchanged**: the dock keeps every id, text,
    toast and hotkey.
  - `useTakeHotkeys`: Space, N, Backspace with Undo, and typing ignored.
  - `QuickCheckCard` dock variant: Keep, Discard, and the E-stop verdict.
  - `TakeDock` slot priority: recovery over blocker over quick check.
  - The vrGoodbye and vrLease tests pass.
- **E2E (`datacollection-console.spec.ts`, Record block).**
  - The fit measurement at 1280, 1512 and 1920 in each Record variant.
  - The page-wide E-STOP clearance in each variant, with Testing tools open too.
  - The duplicate counts and the one-primary count.
  - Reachability through the cells.
  - No horizontal scroll at 390.

  `datacollection-takes.spec.ts` passes with only the listed selector updates.
- **Manual.**
  - Against `sim-g1-edu-dev`, record three takes with Keep, Discard and Undo.
  - Trigger an E-stop during a take, recover from the slot, and resize the window with the
    alarm banner showing: the console shrinks and the page never scrolls.
  - Compare the screenshots with the mockup PNGs.
