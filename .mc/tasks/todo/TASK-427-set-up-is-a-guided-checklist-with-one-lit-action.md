---
id: "TASK-427"
aliases: []
title: "Set up is a guided checklist with one lit action"
slug: "set-up-is-a-guided-checklist-with-one-lit-action"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ui"]
sprint: ""
parent: "[[TASK-425]]"
depends_on: ["[[TASK-426]]", "[[TASK-423]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# Set up is a guided checklist with one lit action

## Description

Second slice of [[TASK-425]]. On a `created` session, the page becomes two panels under
the command bar from TASK-426:
- "Get ready", a checklist of steps in bring-up order: robot side, arm control, stand and
  balance, Quest, operator in VR. The current step is expanded and holds the page's only
  primary button.
- "Preview", the twin with the head camera as a picture-in-picture.

This replaces `PreflightChecklist`, the "Control" and "Robot mode" panels, the compact
"Robot side" panel and the second copy of the Quest controls in Set up. Each problem is
stated once, in the step it belongs to.

Branch: `feat/task-427-set-up-is-a-guided-checklist-with-one-lit-action`.

## Details

### Current state

- After TASK-426, `SessionDetailPage.tsx` switches on the phase. For `created` it still
  renders the old blocks:
  - `PreflightChecklist` (`components/PreflightChecklist.tsx`, from `utils/preflight.ts`);
  - the "Control" panel (`session-control-lease`);
  - the "Robot mode" panel (`session-robot-mode` → `RobotModeControl`);
  - the twin and camera grid;
  - `OperatorCard` with `QuestControls`;
  - the compact `RobotReadinessPanel` (`session-readiness`).
- The Quest connect card (`QuestConnectHelp`, `quest-connect-help`) still sits in
  `VRSessionPanel`, now inside Testing tools.
- The readiness model is `app/src/features/robots/components/readiness/readinessRows.ts`:
  - the row ids;
  - `reasonRow()`, which maps the agent's one ordered reason code to its row;
  - `questSummary()`.
- **TASK-423 (PR #446) must be merged first.** It adds `BRING_UP_STEPS`, `bringUpNext()`,
  `data-next` and the test ids `robot-bringup` / `robot-bringup-next` to
  `app/src/features/robots/components/RobotModeControl.tsx`. Build on the merged file.

### Frontend

Build to the epic's sections, which hold the classes, copy and rules:
- **"SET UP (created) — guided rail and preview"**: the layout, the step row, the
  accordion, the body order, the start bar, the VR step table, the non-VR steps, the rules
  (current, waits, reason once, out of order) and the preview.
- **"Live view"** under RECORD: `LiveView` is built here, with the twin as the main view
  and the camera in the PiP; Record reuses it in TASK-428.
- **"Visual language"**: the lit current step (container, node, breathing ring) and the
  colour rules.
- **"Explicit changes"** 4, 5, 6 (the `unknown` mode in amber), 7 and 11.

What this slice decides and builds:
- **`utils/setupSteps.ts`.** A pure model; no React. It takes:
  - the readiness rows and the reason;
  - the preflight items;
  - the measured base mode and `bringUpNext`;
  - the lease;
  - the operator presence and `inVr`;
  - the Quest report;
  - the session type.

  It returns:
  - the ordered steps, each with `id`, `state` (`done|current|open|waits|fault`), a
    summary, the owned reason and the Details row ids;
  - the systems cells (`id`, label, value, `status`) that TASK-428 renders. The model owns
    both, so the cells and the steps never disagree.
- **`RobotModeControl variant="step"`.**
  - the node track for `BRING_UP_STEPS`;
  - one reason line (the first in `modeDisabledReason` order);
  - `unknown` in amber, in both variants;
  - the unverified-FSM note as one amber line;
  - `base.error` only in Details.

  `'panel'` (the Teleop tab and the VR modal) keeps its look apart from amber `unknown`.
  Every `ConfirmDialog` and "Ask the headset" stays.
- **Readiness.** Split the action buttons (Start robot side, Take control, Switch to arm
  control, read-only, logs) out of `RobotReadinessPanel` as `ReadinessActions`, add a `rows`
  filter prop, and make the values wrap instead of truncating. The full panel on the
  Teleop tab must look the same.
- **Quest.** `QuestControls` and the `quest-connect-help` / `data-mode` wrapper render once,
  in the step 4 body. Remove the card from `VRSessionPanel`, and drop `OperatorCard` from
  the Set up layout.
- **Preview.**
  - A missing camera is the one amber line "No head camera. Takes record without video."
    with a "Why" disclosure.
  - A robot offline is `EmptyState size="sm"`.
  - No invented "top" / "wrist" tiles.
- **Start bar.**
  - It is secondary while steps are open and primary once all are done.
  - It is disabled with visible reason text only when preflight is `blocking`.
  - The `confirm()`, Space and `startBlockedRef` stay as they are.

### Key files

Create:
- `app/src/features/datacollection/utils/setupSteps.ts`
- `app/src/features/datacollection/utils/__tests__/setupSteps.test.ts`
- `app/src/features/datacollection/components/console/SetupRail.tsx`
- `app/src/features/datacollection/components/console/SetupStep.tsx`
- `app/src/features/datacollection/components/console/LiveView.tsx`

Modify:
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`: the Set up layout (JSX
  only).
- `app/src/features/robots/components/RobotModeControl.tsx` and its tests.
- `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`,
  `ReadinessRow.tsx` and `QuestControls.tsx` (the wrapper).
- `app/src/features/datacollection/components/VRSessionPanel.tsx`: remove the Quest card.
- `app/src/features/datacollection/components/CameraStreamView.tsx`: `fit` in a frame, and
  the no-camera text behind Why.
- `.../pages/__tests__/SessionDetailPage.preflight.test.tsx`: `preflight-robot` →
  `setup-step-robot`, `preflight-camera` → `setup-preview`. The offline block and the
  Space block are kept.
- `app/e2e/quest-connect.spec.ts`: expand `setup-step-quest` (or rely on it being current)
  instead of opening Testing tools.
- `app/e2e/datacollection-console.spec.ts`: add the Set up block.

Delete:
- `.../components/PreflightChecklist.tsx`
- `.../components/__tests__/PreflightChecklist.test.tsx`

`utils/preflight.ts` and its tests stay.

### Live specs

The specs under `app/e2e/live/` run against a live stack (`npx playwright test
--config=playwright.live.config.ts`). They are not part of `test-all.sh` and the epic does
not list them, but several of them open the session page. Update their selectors in the
same PR, even if you cannot run them here, and say so in the PR.

In this slice:
- `datacollection-vr.spec.ts:71` reads `preflight-robot` (→ `setup-step-robot`; it has no `data-level`, so read its `data-state`).
- `readiness-bringup.spec.ts:86,94` reads `robot-readiness-compact` **on the session
  page**, which this slice removes. Point it at `setup-step-robot` and its Details. The
  epic says that only the vrLease vitest reads it; this live spec does too.
- `vr-estop-recovery.spec.ts` reads `session-robot-mode` (→ `setup-step-stance`) and
  `robot-mode-reasons`, which becomes one reason line.
- `datacollection-takes-sync` and `datacollection-vr` read `session-control-lease`, which
  in Set up is now in the `control` step body.

### Visual reference

While the scratchpad exists, compare against
`/tmp/claude-1002/-home-humanoid-develop-robot-management-system/80869d0d-8d7d-4554-975b-5fccdc543248/scratchpad/ui/mockup/setup-1512.png`,
`setup-step3-1512.png`, `setup-390.png`, `setup-390-full.png` and `setup-zema-1512.png`
(same folder). The page must match them closely.

## Acceptance Criteria

From the epic's criteria, the parts assigned to this child (ownership table under the
epic's "Split"):

- [ ] **Set up.**
  - The current step is the first open one, is expanded, and holds the page's only primary.
  - Start session is secondary while steps are open and primary when all are done.
  - It is disabled with visible reason text when the robot is offline, and Space then does
    not start it (the existing vitest is kept).
- [ ] **One lit action in Set up.** Exactly one visible kit `primary` button is on screen,
  not counting the E-STOP. A disabled primary counts as not lit.
- [ ] **Diagnostics.**
  - A robot with readiness reason `mode_not_balance` shows the reason in step 3 and nowhere
    else in Set up.
  - Steps after a failed step read "Waits for step N" without the error text.
  - The robot mode `unknown` renders amber (`text-signal-unknown`), in both
    `RobotModeControl` variants.
- [ ] **No duplicates in Set up, on a live VR session.**
  - At most one element each with `quest-connect`, `quest-open` and
    `quest-copy-viewer-link`.
  - The text "Open on headset" occurs once.
  - The readiness reason sentence occurs at most once in the DOM.
- [ ] **Every function within one disclosure, in Set up.** Each of these is reached with
  at most one click (expanding a step):
  - Start robot side, Take control, Switch to arm control;
  - Limp / Stand up / Balance, and Ask the headset;
  - Connect, Open on headset, Copy viewer link;
  - Start session;
  - swap view, expand view.
- [ ] **E-STOP stands alone, page-wide in Set up.** The nearest other interactive element
  is ≥ 64 px from the E-STOP at 1512×945 and 1920×1080, and ≥ 48 px at 1280×800, at scroll
  position 0. This holds with step 3 expanded and with Testing tools open.
- [ ] **Phone (390×844), Set up.**
  - No horizontal scroll (`scrollWidth <= clientWidth`).
  - Start session stays in the start bar in the page, not in the dock.
- [ ] **Brand, Set up.** It renders correctly in the light theme and with the ZeMA `brand/`
  config.
- [ ] **Screenshots.** The PR shows before/after screenshots of Set up at 1512×945,
  1920×1080 and 390×844.
- [ ] **Gates (every child).**
  - `design-drift.test.ts` passes, with no raw hex or hue utilities, no `backdrop-filter`
    and no glow shadows.
  - `./scripts/test-all.sh --skip-pw` is green.
  - The four Playwright specs are green, with only this slice's selector updates.

## Test Strategy

- **Vitest.**
  - `setupSteps.test.ts`:
    - step order for VR and non-VR (gamepad `input`, `control` only when the page uses its
      own inputs);
    - current = the first not-done step;
    - waits after a failure;
    - each `reasonRow` code landing in exactly one step and exactly one cell;
    - a missing hand as a non-blocking warning on step 1;
    - the systems cells from the same input.
  - `RobotModeControl` step variant:
    - one reason line;
    - amber `unknown`;
    - the confirm still required;
    - Limp still enabled where it is today.
  - The updated `SessionDetailPage.preflight.test.tsx` passes, and
    `SessionDetailPage.vrLease.test.tsx` still asserts `robot-readiness-compact` absent.
  - The Teleop tab's readiness panel tests pass unchanged.
- **E2E.** The Set up block in `datacollection-console.spec.ts`, on a created `vr_quest`
  demo session:
  - one primary;
  - the duplicate counts;
  - one-click reachability;
  - the page-wide E-STOP clearance at 1280, 1512 and 1920, with step 3 open and with
    Testing tools open;
  - no horizontal scroll at 390.

  `quest-connect.spec.ts` passes through step 4.
- **Manual.** Against the sim robot `sim-g1-edu-dev` (`docs/g1-edu-lab-bringup.md`), walk
  steps 1 → 5 and watch the lit step move and the twin stand up in the preview. Compare the
  screenshots with the mockup PNGs.
