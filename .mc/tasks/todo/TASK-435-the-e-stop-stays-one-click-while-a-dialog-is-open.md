---
id: "TASK-435"
aliases: []
title: "The E-STOP stays one click while a dialog is open"
slug: "the-e-stop-stays-one-click-while-a-dialog-is-open"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 1                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: [core, safety, ui]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The E-STOP stays one click while a dialog is open

## Description

While any confirm dialog is open on the data-collection session page, the
dialog's full-screen overlay covers the command bar's E-STOP. A click there lands
on the overlay, not on the E-STOP. The walkthrough on 2026-10-30 also saw Esc
close the dialog instead of counting toward Esc Esc. The dialogs that are open
while the robot moves are the mode change (Limp, Stand up, Balance) and Stop
robot side's "Limp first". The rule for the E-STOP is that it is one click,
never behind a confirmation, and nothing makes it slower. This task keeps the
E-STOP above every dialog and clickable, and makes Esc Esc work with a dialog
open, or records why it cannot.

Branch: `fix/task-435-the-e-stop-stays-one-click-while-a-dialog-is-open`.

## Details

### Current state

- **The E-STOP.** `app/src/features/datacollection/components/console/SessionCommandBar.tsx`:
  - the bar is `sticky top-[88px] z-30` (`:228`);
  - the E-STOP zone (`data-testid="estop-zone"`, `:457-469`) holds the one
    `SessionEStopButton` (`data-testid="session-estop"`);
  - below 640 px the zone is a fixed bottom dock, `z-50` (`:464`), above the
    Testing tools popover (z-40, `:456`);
  - the button (`components/session/SessionEStopButton.tsx`) calls
    `triggerRobotEStop` (`app/src/features/safety/api/safetyApi.ts:38-46`,
    `POST /api/safety/robots/:id/estop`).
- **The overlay.** Every confirm is a `Modal`
  (`app/src/shared/components/ui/Modal.tsx`):
  - it portals into `document.body` (`:364`), with an overlay
    `fixed inset-0 z-50` (`:332`) and a `bg-black/60` dim;
  - a backdrop click closes it (`:261-263`). `ConfirmDialog` passes
    `closeOnBackdrop={!loading}` (`ConfirmDialog.tsx:83`), so while a confirm
    is loading the click does nothing;
  - Tab is trapped inside the dialog (`:223-241`), and the panel is
    `aria-modal` (`:315`).
  - The bar's z-30 makes its own stacking context, so the zone's z-index alone
    cannot lift it above the overlay. On a phone, the dock and the overlay are
    both z-50, and the portal comes later in the DOM, so the overlay wins there
    too.
- **The confirms on the session page:**
  - `pages/SessionDetailPage.tsx:363-367`: "Start the session on <robot>?"
    (`confirm()`);
  - `pages/SessionDetailPage.tsx:375-380`: "End this session?";
  - `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`:
    `readiness-arm-confirm` ("Switch the robot side to arm control?"),
    `readiness-read-only-confirm`, and `readiness-stop-confirm` /
    `readiness-restart-confirm`. The last two offer "Limp first, then stop".
    That keeps the dialog open and loading for up to `LIMP_WAIT_MS` = 15 s
    (`:53`) while the robot lowers itself;
  - `app/src/features/robots/components/RobotModeControl.tsx:396`:
    `robot-mode-confirm` (Limp, Stand up, Balance, with the gantry warning);
  - `components/console/TakesList.tsx:56`: discard or restart a take.
- **Esc Esc.** `SessionEStopButton.tsx:50-65`:
  - a `window` keydown listener fires on two Escapes within
    `ESTOP_DOUBLE_ESCAPE_MS` = 1000 ms (`:24`);
  - an Escape typed in an input, textarea or select does not count
    (`utils/hotkeys.ts:9-13`);
  - the file header (`:5-8`) says a single Escape keeps its usual job, closing
    a dialog.
- **Modal's Escape.** `Modal.tsx:210-220` handles Escape on `document`. It calls
  `preventDefault()`, closes the top dialog, and does not stop propagation.
  - From the code, the first Escape should both close the dialog and count
    toward Esc Esc, since the window listener does not check
    `defaultPrevented`.
  - The walkthrough saw otherwise. The first e2e must settle which is true
    before the fix.
- The E-STOP rule (TASK-426's command bar is built on it): normal actions left,
  the E-STOP alone on the right behind a wide gap, one click, never a
  confirmation; distance is the guard. The clearance checks are in
  `app/e2e/datacollection-console.spec.ts` (`:89-147`, the `estop-gap` probe).

### Frontend

- Keep the E-STOP zone above every modal overlay, and clickable, while a dialog
  is open.
  - For example, render the zone in a layer of its own above the Modal's z-50
    (a portal, or a z-index scale where the E-STOP layer is the top), at
    exactly the place the bar gives it, on desktop and in the phone dock.
  - It must not move or change size when a dialog opens or closes.
  - It sits above the dim, so it does not look disabled.
- A click on the E-STOP while a dialog is open fires it once and never confirms
  the dialog. Decide whether the dialog closes as well, and write it down. The
  "Limp first" wait must not swallow the click.
- Esc Esc fires the E-STOP with a dialog open: the first Escape closes the
  dialog and counts, the second fires. Typing targets still do not count. If
  this cannot work, record why in Notes; the click must work regardless.
- The focus trap may keep the E-STOP out of the dialog's Tab order, but nothing
  may make it `inert`, `aria-hidden` or unclickable.
- Do not change the E-STOP's clearances (no other control closer than TASK-426's
  65 px) or the Testing tools popover's place under the bar.

### Key files

- `app/src/features/datacollection/components/console/SessionCommandBar.tsx`
- `app/src/features/datacollection/components/session/SessionEStopButton.tsx`
- `app/src/shared/components/ui/Modal.tsx`
- `app/src/shared/components/ui/ConfirmDialog.tsx`
- `app/e2e/datacollection-console.spec.ts`
- `app/src/features/datacollection/components/session/__tests__/SessionEStopButton.test.tsx`
  (exists; add the Esc Esc path through an open `Modal`)

## Acceptance Criteria

- [ ] With each confirm open (Start session, End session, Switch to arm control,
  read-only, Stop / Restart robot side, including while "Limp first" runs, a mode
  change, discard take), one click on the E-STOP fires it: one
  `POST /api/safety/robots/:id/estop`, at 1512, 1280 and phone width.
- [ ] That click never confirms the dialog. Whether the dialog closes is decided
  and written down.
- [ ] With a dialog open, Esc Esc within 1 s fires the E-STOP, or Notes says why
  not.
- [ ] With a dialog open, the E-STOP sits where it sits without one, at the
  same size, not under the dim.
- [ ] The E-STOP clearance checks in `app/e2e/datacollection-console.spec.ts`
  stay green.
- [ ] An e2e block opens each confirm, clicks the E-STOP, and asserts that it
  fired.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run`, with a unit test for Esc Esc
  through an open `Modal`.
- Playwright, in `datacollection-console.spec.ts`, on the demo session pages
  (`demo-session-takes`, `demo-session-takes-vr`, and a Set up session from
  `app/src/mocks/readinessDemoHandlers.ts`):
  - first, before the fix, record whether Esc Esc fires with a dialog open,
    and note the result;
  - then, for each confirm: open it, click `session-estop`, and assert the
    `POST …/estop` request; then open it again, press Escape twice, and assert
    the same;
  - at 1512, 1280 and 390 px wide.
- Screenshots of an open confirm with the E-STOP above the dim, at 1512 and on
  a phone.

## Notes

- Found in the Playwright MCP walkthrough with `sim-g1-edu-dev` on 2026-10-30,
  filed from the TASK-424 preparation. Until this lands, the TASK-424 run sheet
  says to use the physical remote while a confirm is open.
