---
id: "TASK-466"
aliases: []
title: "An Escape that a dialog or popover handled never counts toward Esc Esc E-STOP"
slug: "an-escape-that-a-dialog-or-popover-handled-never-counts"
status: "backlog"             # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core, safety, ui]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "high"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# An Escape that a dialog or popover handled never counts toward Esc Esc E-STOP

## Description

On the session page, an Escape that closes Testing tools, a Systems cell
popover or a confirm also counts as the first press of Esc Esc. In the
2026-10-31 sim rehearsal, Esc to close one popover and Esc again within 1 s for
another fired the E-STOP: the take was discarded, the robot damped (on the real
G1 it sags into the gantry), and the slow recovery followed. PR #472 (TASK-453)
reuses the same `SessionEStopButton` on the robot's Teleop tab, and its review
noted the same thing there. This task stops a handled Escape from counting.

**Status `backlog`: a decision is open, because it touches TASK-435.**
TASK-435 (open, priority 1) wants the opposite for confirm dialogs: "the first
Escape closes the dialog and counts, the second fires", so Esc Esc works with a
dialog open. Both cannot hold for the same dialog. Decide one of:

- **A. No handled Escape counts, dialogs included.** Esc Esc with a dialog open
  then takes three presses; TASK-435's click on the E-STOP above the overlay
  stays the one-step path, and TASK-435's Esc Esc criterion is answered "not,
  because …" in its Notes, as its AC allows.
- **B. Popovers never count; modal confirms do (TASK-435's rule).** Testing
  tools and the Systems cell popovers stop counting; a `Modal`'s Escape keeps
  counting. The rehearsal's case (two popovers) is fixed; a confirm closed with
  Esc and a second Esc within 1 s still fires.

Whoever decides writes the choice into this file and TASK-435 so the two agree,
then sets this task to `todo`. Nothing below decides it.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `app/src/features/datacollection/components/session/SessionEStopButton.tsx:50-65`:
  a `window` keydown listener (bubble phase) counts every non-repeat Escape
  that is not typed into an input (`isTypingTarget`); two within
  `ESTOP_DOUBLE_ESCAPE_MS` (1000 ms, `:24`) fire. It never reads
  `defaultPrevented` and never checks whether a dialog or popover was open.
- Who handles Escape first:
  - `app/src/shared/components/ui/Modal.tsx:210-220`: a `document` listener;
    on Escape it calls `preventDefault()` and closes the top dialog, without
    `stopPropagation()`;
  - `app/src/features/datacollection/components/console/TestingTools.tsx:108-109`:
    a `document` listener closes the popover on Escape, without
    `preventDefault()`;
  - `app/src/features/datacollection/components/console/SystemsStrip.tsx:121-122`:
    the same for the cell popover (skipped while an `alertdialog` is open), also
    without `preventDefault()`.
- PR #472 (TASK-453, open): `KeyboardTeleopSection` on the Teleop tab renders
  `SessionEStopButton` with the hotkey on; the session page passes
  `estop={false}` to its embedded copies. A fix in `SessionEStopButton` covers
  both pages.
- TASK-435 (open): keeps the E-STOP clickable above every dialog overlay and
  asks for Esc Esc to work with a dialog open. Its AC accepts "or Notes says why
  not".

### Frontend

The shape of the fix, for either decision:

- Popovers that close on Escape mark the event as handled (`preventDefault()`
  in `TestingTools` and `SystemsStrip`).
- `SessionEStopButton`'s listener: an Escape that was handled
  (`ev.defaultPrevented`, or a dialog/popover open at keydown via
  `isDialogOpen()`) does not count and resets `lastEscape`. For decision B,
  exempt `Modal`'s Escape (for example a marker on the event, or checking
  `[aria-modal="true"]` at keydown).
- The listener must see the event after the handlers: they listen on
  `document` and the E-STOP on `window`, so bubble order already gives this.
  Keep it that way and say so in a comment.

### Key files

- `app/src/features/datacollection/components/session/SessionEStopButton.tsx`
- `app/src/features/datacollection/components/console/TestingTools.tsx`
- `app/src/features/datacollection/components/console/SystemsStrip.tsx`
- `app/src/shared/components/ui/Modal.tsx` (only for decision B's marker)
- `app/src/features/datacollection/components/session/__tests__/SessionEStopButton.test.tsx`
- `app/src/features/robots/components/tabs/__tests__/KeyboardTeleopEStop.test.tsx`
  (from PR #472, once merged)

## Acceptance Criteria

- [ ] The decision (A or B) is written here and in TASK-435.
- [ ] Esc closing Testing tools, then Esc within 1 s, does not fire the E-STOP;
  the same for a Systems cell popover.
- [ ] Esc Esc with nothing open fires the E-STOP, on the session page and on the
  Teleop tab.
- [ ] Dialogs behave as decided (A: a dialog's Escape never counts; B: it
  counts, as TASK-435 specifies).
- [ ] The E-STOP click path is untouched.

## Test Strategy

- App vitest for `SessionEStopButton`: Escape with `defaultPrevented` does not
  count; two plain Escapes fire; an Escape closing an open `TestingTools`
  followed by one Escape does not fire; the dialog case per the decision.
- Playwright in `app/e2e/datacollection-console.spec.ts`: open Testing tools,
  press Escape twice within 1 s, assert no `POST …/estop`; with nothing open,
  assert one.
- On `sim-g1-edu-dev`: the rehearsal's sequence (Esc to close Testing tools,
  Esc to close a Systems popover) leaves the robot standing.

## Notes

- Found in the 2026-10-31 sim rehearsal ("An Esc that closes a popover or
  dialog also counts toward the Esc-Esc E-STOP"), and by the PR #472 review.
- Workaround: close popovers and dialogs with the mouse (Testing tools again,
  Cancel, ×). Never press Esc twice on the session page unless you mean E-STOP.
- Not in scope: the E-STOP above an open dialog's overlay (TASK-435).
