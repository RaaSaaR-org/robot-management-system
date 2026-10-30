---
id: "TASK-426"
aliases: []
title: "The session page has one command bar with every action on the left and the E-STOP alone on the right"
slug: "the-session-page-has-one-command-bar-with-every-action-on"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ui", "safety"]
sprint: ""
parent: "[[TASK-425]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The session page has one command bar with every action on the left and the E-STOP alone on the right

## Description

First slice of [[TASK-425]]. Replace the session page's `PageHeader` with a sticky command
bar: identity on the left, every normal action (presence, mute, Testing tools, End
session) packed right after it, and the E-STOP alone in its own zone on the far right,
behind a clear gap of at least 65 px. Below 640 px that zone becomes a bottom dock that
holds only the E-STOP. The developer tools move behind one "Testing tools" popover, the
headset gets its own Launch VR hero, and the page switches on the session's phase.

The user asked for this spacing because an accidental E-stop damps the real G1 mid-session:
"i dont like to press the e stop button in a accident". The E-STOP itself stays one press,
with no confirmation, so distance is the only guard.

The old blocks stay rendered under the phase switch. TASK-427, TASK-428 and TASK-429
replace them phase by phase. Behaviour, stores, hooks and server calls do not change.

Branch: `feat/task-426-the-session-page-has-one-command-bar-with-every-action-on`.
This PR also carries the TASK-425 epic file and the four child task files into
`.mc/tasks/todo/`.

## Details

### Current state

- `app/src/features/datacollection/pages/SessionDetailPage.tsx` (790 lines) renders
  `PageHeader` (line ~536). Its `meta` holds `SessionStatusBadge`, the Sim tag, the "Live"
  tag and `PresenceBar` (line 545). Its `actions` hold the read-only `ControlLeaseBar`
  (549), `SessionEStopButton` (551) and the status action. Its children hold
  `SessionStepIndicator` (555).
- The interactive "Control" panel (`session-control-lease`, line ~577) renders
  `ControlLeaseBar` with the default `showEstop = true`
  (`app/src/features/robots/components/tabs/ControlLeaseBar.tsx:51,122`). So the page shows
  a **second E-stop** today whenever that panel is shown.
- `VRSessionPanel` (`components/VRSessionPanel.tsx`, line ~714 on the page) carries a
  status tag, a WebXR line, a "Connect Meta Quest" card, Launch VR, "Test without a
  headset" (`simulate-vr-toggle`) and "Keyboard fallback". The non-VR "Manual control"
  panel (line ~727) holds `KeyboardTeleopSection` and `JointStateGrid`.
- `hud-mute` lives in `components/session/SessionHud.tsx:122`, which receives
  `muted`/`onToggleMute` as props. `SessionHud.test.tsx` covers it.
- The shell: `app/src/components/layout/TopBar.tsx` is `sticky top-0 z-40 h-14`; `main` in
  `AppLayout.tsx` holds `AlertBanner`, `SectionRail`, then the page.
- `EMULATOR_ACTIVE` (`robots/components/tabs/vr/vrConstants.ts:146`) is true only in a DEV
  build on localhost with `?xremu`.

### Frontend

Build to the epic's sections; they hold the classes, sizes and copy. Do not restate them
here, read them:

- **"Command bar (all phases)"**: the bar, the two sides, the left group order (presence,
  mute, Testing tools, End session), the clear gap (`flex-1 min-w-6`), the `estop-zone`, and
  "Below 640 px".
- **"Testing tools popover"**: the rows, kept mounted, Esc and outside click.
- **"Visual language"**: the tally table (`data-tally`), the typography of the h1, `<kbd>`
  hints, the `breathe` keyframe and the `media` token.
- **"Phase engine"**: the status → phase table and `useDeviceRole()`.

The sticky offset decision (2026-10-30, now in the epic under "Sticky offset"):
- The `bg-canvas` shim holds the bar **32 px** under the TopBar when it is stuck, not the
  mockup's 12 px. The bar's stuck top is then 88 px and the E-STOP's top 96 px, which keeps
  every TopBar control's hit box ≥ 48 px away (the Docs icon button, the nearest, 49.5 px;
  the account avatar 54.5 px). Amended in review round 1 from 28 px: at 28 the 38 px Docs
  button's box was 45.5 px from the E-STOP.
- At scroll 0 the bar stays where the layout puts it. The shim covers the full 32 px band,
  so no content shows between the TopBar and the bar while scrolling.

The phase switch:
- `created` → Set up, `recording`/`paused` → Record, `completed`/`failed` → Wrap up, one
  layout per phase. In this slice, each phase renders the old blocks that belong to it,
  unchanged, under the bar.
- Every hook and handler keeps running as today: the lease, presence (`assistant`),
  telemetry autoConnect, the cameras poll, the polling intervals, the VR goodbye and the
  hotkeys.
- Delete `SessionStepIndicator` and its `session-steps` / `session-step-*` ids (Explicit
  change 2).

What moves in this slice:
- The mute button (`hud-mute`, same `aria-*` and handler) moves from `SessionHud` into the
  bar's left group, in Record only. `SessionHud` drops its mute props.
- `VRSessionPanel` gets `variant: 'tools' | 'hero'`. It stays the single owner of the VR
  modal, the simulated input and the goodbye, and it stays mounted while the popover is
  closed. Exactly one instance is mounted in either role: `tools` inside Testing tools on
  the desktop, `hero` inside `HeadsetHero` on the headset.
- Its "Connect Meta Quest" card (`QuestConnectHelp`: `quest-connect-help`, `data-mode`,
  `quest-copy-viewer-link`) **stays in this slice**, inside the tools variant. TASK-427
  moves it into step 4, and TASK-428 takes the Quest buttons out of `OperatorCard`. Until
  then `app/e2e/quest-connect.spec.ts` opens `session-tools-toggle` before it reads
  `quest-connect-help`. That is the only change to that spec here.
- The "Manual control" panel's `KeyboardTeleopSection` and `JointStateGrid` move into the
  Testing tools rows.
- Every `ControlLeaseBar` this page renders passes `showEstop={false}`.
- `PresenceBar` becomes the avatar stack, deduped by (user, role).
- The headset role (`useDeviceRole() === 'headset'`) leads every live phase with
  `HeadsetHero`, with Launch VR (`vr-launch`) as its primary. The desktop blocks sit behind
  one "Robot setup" disclosure.

### Key files

Create:
- `app/src/features/datacollection/components/console/SessionCommandBar.tsx`
- `app/src/features/datacollection/components/console/TestingTools.tsx`
- `app/src/features/datacollection/components/console/HeadsetHero.tsx`
- `app/src/features/datacollection/hooks/useDeviceRole.ts`, plus a unit test
- `app/e2e/datacollection-console.spec.ts`: the bar and E-STOP checks below. TASK-427,
  TASK-428 and TASK-429 add their phase blocks to it later.

Modify:
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`: the phase switch and the bar
  (JSX only).
- `.../components/session/SessionEStopButton.tsx`: restyle only (epic, item 5 of the
  command bar).
- `.../components/session/SessionHud.tsx` and `__tests__/SessionHud.test.tsx`: mute out.
- `.../components/PresenceBar.tsx`: the avatar stack and the dedupe.
- `.../components/VRSessionPanel.tsx`: the `tools` and `hero` variants (the Quest card stays for now).
- `.../components/index.ts`, `app/src/features/datacollection/index.ts`: exports.
- `.../pages/__tests__/SessionDetailPage.vrGoodbye.test.tsx` and `.vrLease.test.tsx`: click
  `session-tools-toggle` before `simulate-vr-toggle`.
- `app/e2e/datacollection-takes.spec.ts` and `app/e2e/quest-connect.spec.ts`: selector
  updates only, where the tools moved.
- `app/src/index.css`: `--bg-media` / `--color-media` and the `breathe` keyframe with
  `--animate-breathe`. Nothing else is added.

Delete:
- `.../components/SessionStepIndicator.tsx`

### Where the demo states come from

- `#/data-collection/demo-session-takes` (`src/mocks/teleopTakesDemoHandlers.ts`): Record.
  Its `/end` handler turns it into Wrap up.
- `src/mocks/liveSessionDemoHandlers.ts`: POST creates a `created` `vr_quest` session, which
  gives Set up.
- Add a demo fixture only if a state cannot be reached this way, in the same mocks folder.

### Live specs

The specs under `app/e2e/live/` run against a live stack (`npx playwright test
--config=playwright.live.config.ts`). They are not part of `test-all.sh` and the epic does
not list them, but several of them open the session page. Update their selectors in the
same PR, even if you cannot run them here, and say so in the PR.

In this slice:
- `datacollection-vr.spec.ts` reads `session-steps`, which is removed.
- `simulate-vr-toggle`, `sim-input-status`, `vr-launch`, `vr-prerequisites` and
  `vr-session-panel` move behind `session-tools-toggle` on the desktop role. The specs
  that use them are `datacollection-takes-sync`, `datacollection-vr`,
  `quest-live-link-and-takes`, `two-person-session`, `vr-estop-recovery` and
  `vr-session-board`.
- Where one of those specs runs as the headset, `vr-launch` is in `HeadsetHero` instead.

### Visual reference

Compare against the approved mockup while its scratchpad exists. The bar has to match the
mockup's look closely:
- `/tmp/claude-1002/-home-humanoid-develop-robot-management-system/80869d0d-8d7d-4554-975b-5fccdc543248/scratchpad/ui/mockup/record-1512.png`,
  `setup-1512.png`, `wrap-1512.png`, `record-1280.png`, `record-1920.png`,
  `record-tools-1512.png`, `record-390.png`, `record-390-menu.png` and
  `record-zema-1512.png`;
- the clearance probe in
  `/tmp/claude-1002/-home-humanoid-develop-robot-management-system/80869d0d-8d7d-4554-975b-5fccdc543248/scratchpad/ui/estop-gap.mjs`,
  which is the model for the e2e measurement.

## Acceptance Criteria

From the epic's criteria, the parts assigned to this child (ownership table under the
epic's "Split"):

- [ ] **E-STOP always visible.**
  - Exactly one `session-estop` is in the DOM.
  - Scrolling in 200 px steps through the whole page, its box lies inside the viewport at
    every position: at 1512×945 in Set up, Record and Wrap up, and at 390×844 in all three.
  - It fires on one press with no dialog ("Emergency stop sent"), and Escape twice works.
- [ ] **E-STOP stands alone, in the bar.**
  - `estop-zone` holds the E-STOP and no other control, in every phase.
  - End session is never its neighbour.
  - The bar's gap from the E-STOP to the nearest bar control is ≥ 65 px at every width from
    640 px up (measured at 640, 1280, 1512 and 1920), with the Testing tools popover open
    as well.
  - On a scrolled page with the bar stuck, the bar's top is 88 px (TopBar + 32 px), and the
    TopBar's nearest control is ≥ 48 px from the E-STOP (49.5 px by construction).
  - From 640 to 1500 px of viewport (a tablet with the sidebar included) the E-STOP lies
    whole inside the bar and the viewport, and nothing in the bar overlaps: when the left
    group does not fit, it moves into the ⋯ menu (on the left, after the identity), line 2
    keeps only the robot, and when even the h1 does not fit beside the status tag the
    identity wraps as on a phone and the bar grows taller. The E-STOP zone never gives way.
  - On a phone an open Testing tools popover ends ≥ 17 px above the bottom dock, and the
    dock is stacked above it: every point of the E-STOP hits the E-STOP.
  - At 390×844 the bottom dock holds only the E-STOP, and End session, Testing tools and
    Mute sound cues are in the bar's ⋯ menu.
- [ ] **No duplicates.**
  - No `ControlLeaseBar` on this page renders an E-stop.
  - Presence shows one avatar per (user, role).
- [ ] **Every function within one disclosure.** These are reached with at most one click:
  - Simulate VR input, Launch VR, Keyboard fallback and Joint states, via
    `session-tools-toggle`;
  - mute and End session, in the bar;
  - the E-STOP, with zero clicks.
- [ ] **Testing tools.**
  - Simulated VR input, the desktop VR window, Keyboard fallback and Joint states exist
    only in Testing tools.
  - Turning simulation on shows a "Simulated input" sim tag in the bar.
  - Closing the popover does not unmount `VRSessionPanel`: the vrGoodbye and vrLease vitest
    files pass.
- [ ] **Phone (390×844), the bar.**
  - The h1 wraps to at most 2 lines.
  - Back, the status tag and the robot name stay in the bar.
  - The existing "the session page fits a phone" e2e passes.
- [ ] **Headset role.** With a Quest user agent, the page leads with the "This is the
  headset" hero, and Launch VR (`vr-launch`) is above the fold at 390×844 and 1280×800.
  `?xremu` gives the same result against `npm run dev` (checked by hand: `EMULATOR_ACTIVE`
  is false in the demo build).
- [ ] **Brand.**
  - Only the `media` token and `animate-breathe` are added to `index.css`.
  - Breathing stops under `prefers-reduced-motion`.
  - The bar and the phone dock render correctly in the light theme and with the ZeMA
    `brand/` config.
- [ ] **Gates (every child).**
  - `app/src/__tests__/design-drift.test.ts` passes, with no raw hex or hue utilities, no
    `backdrop-filter` and no glow shadows.
  - `./scripts/test-all.sh --skip-pw` is green.
  - The four Playwright specs (`datacollection-takes`, `quest-connect`,
    `datacollection-new-session`, `datacollection-console`) are green.

## Test Strategy

- **Vitest.**
  - `useDeviceRole`: a Quest user agent, a desktop user agent, and the override.
  - `SessionHud` without the mute.
  - A bar test: `hud-mute` exists in Record and not in Set up or Wrap up; one
    `session-estop` in every status, including completed and failed (the existing
    `SessionEStopButton` test still passes).
  - vrGoodbye and vrLease open Testing tools first, then pass unchanged.
  - `SessionDetailPage.takes.test.tsx` and `.preflight.test.tsx` pass unchanged; the old
    blocks still render.
- **E2E (`app/e2e/datacollection-console.spec.ts`, demo build).**
  - The visibility sweep: 200 px steps, at 1512 and 390, in all three phases.
  - The bar clearance at 640, 1280, 1512 and 1920, with Testing tools open too, using the
    rectangle distance from `estop-gap.mjs`.
  - The stuck-bar check: scroll by 400 px, then the bar's top is 88 px and the TopBar's
    distance to the E-STOP is ≥ 48 px.
  - The bar fit sweep, 640 to 1500 px in 20 px steps, in all three phases.
  - At 390×844 and 360×640, Testing tools open (Joint states expanded), `elementFromPoint`
    at the E-STOP's inset corners and centre hits `session-estop`.
  - The phone dock holds only the E-STOP, and the ⋯ menu holds the three actions.
  - Testing tools reachability.
  - The headset hero under a Quest user agent.
- **Manual.**
  - Screenshots of the bar in all three phases at 1512, 1280 and 390, light and dark, and
    ZeMA, side by side with the mockup PNGs.
  - Click End session and Testing tools quickly in a row: neither lands on the E-STOP.
