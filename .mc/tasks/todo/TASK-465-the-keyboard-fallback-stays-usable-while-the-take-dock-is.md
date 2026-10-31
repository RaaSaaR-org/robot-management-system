---
id: "TASK-465"
aliases: []
title: "The keyboard fallback stays usable while the take dock is used"
slug: "the-keyboard-fallback-stays-usable-while-the-take-dock-is"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The keyboard fallback stays usable while the take dock is used

## Description

The session page's Keyboard fallback lives inside the Testing tools popover,
and its console is mounted only while the popover is open. A click on the take
dock's Start take is an outside click: it closes the popover, the console
unmounts, disconnects and gives its control back, and no take starts. While the
popover is open it counts as a dialog, so Space stops the joint instead of
starting or stopping a take. Every reopen needs Connect, Take control and a
confirm again, and frames drop until then. The 2026-10-31 sim rehearsal hit it
on every keyboard take. This task moves a connected keyboard console out of the
popover into a visible panel, so it never unmounts while it drives and is never
hidden, and makes the take dock work while it is shown.

Branch: `fix/task-465-the-keyboard-fallback-stays-usable-while-the-take-dock-is`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `app/src/features/datacollection/components/console/TestingTools.tsx`:
  - `:31-39`: `ToolsOpenContext`. A row's in-place content renders only while
    the popover is open, on purpose: "closing the tools must not leave a hidden
    keyboard console driving joints";
  - `:176`: `{children && open && …}`;
  - `:99-110`: an outside `pointerdown` (capture phase) or Escape closes it;
    only the anchor and dialogs are exempt;
  - `:127`: the popover is `role="dialog"`, so `isDialogOpen()`
    (`app/src/features/datacollection/utils/hotkeys.ts:21`) is true while open.
- The fallback is mounted in three places:
  - `app/src/features/datacollection/pages/SessionDetailPage.tsx:650-666`
    (non-VR sessions);
  - `app/src/features/datacollection/components/VRSessionPanel.tsx:170-188`
    (the VR session's Testing tools variant) and `:232-246` (its panel variant).
- `app/src/features/robots/components/tabs/TeleopTab.tsx`:
  - `:128` own `useControlLease`, `:137` `canDrive`;
  - `:387`: `useEffect(() => () => disconnect(), [disconnect])`, so unmount
    disconnects;
  - `:345-352`: Space sends `{preset:'stop'}`.
- `app/src/features/datacollection/hooks/useTakeHotkeys.ts:133`: take hotkeys
  return while `isDialogOpen()`.
- TASK-454 (open) hands the page's lease to the keyboard section on
  `keyboard_mouse` sessions and makes Space mean one thing. It does not change
  where the console lives. Build on it if it has landed; the two touch the same
  files.

### Frontend

- Decided: the console is never hidden while it holds a connection, and never
  unmounts because a popover closed.
  - The Testing tools row keeps Open / Close. Open shows the console in a panel
    of its own on the page (for example under the take dock in the right
    column), not inside the popover, and closes the popover.
  - The panel stays mounted and visible until its own Close, which disconnects
    and releases control, as today's unmount does.
  - The popover's outside-click rule stays as it is for the popover itself.
- The panel is not a dialog (no `role="dialog"`), so the take hotkeys keep
  working while it shows. Space keeps the meaning TASK-454 gives it (the joint
  stop while the fallback is connected); takes start and stop with the mouse
  and the dock buttons.
- Applies to all three mounts. The panel fits the dock's one-screen budget
  (TASK-428) and keeps every control at least the TASK-426 clearance from the
  E-STOP.

### Key files

- `app/src/features/datacollection/components/console/TestingTools.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/components/VRSessionPanel.tsx`
- `app/src/features/robots/components/tabs/TeleopTab.tsx` (reuse; change only
  if needed)
- `app/e2e/datacollection-console.spec.ts`

## Acceptance Criteria

- [ ] With the fallback connected and in control, a click on Start take starts
  the take, and the console stays connected and in control.
- [ ] Opening or closing Testing tools never disconnects a connected console.
- [ ] The console is visible whenever it is connected.
- [ ] Its own Close disconnects and releases control.
- [ ] The E-STOP clearance checks in `datacollection-console.spec.ts` stay green
  at 1512, 1280 and phone width.
- [ ] Vitest and a Playwright block cover the click-through.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run`, with a test that the console
  stays mounted when the popover closes.
- Playwright on a non-VR and a VR demo session: Open the fallback, Connect,
  click Start take, assert the take started and no disconnect or release
  request was sent; then Close and assert the release.
- On `sim-g1-edu-dev`: a keyboard take driven end to end with Start take /
  Stop take clicked while the console is connected.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Keyboard fallback cannot be used
  together with the take controls").
- Workaround: with the popover closed, Space starts the take; then Testing
  tools → Keyboard fallback → Connect → Take control → confirm; drive; one Esc
  or a click on Testing tools closes it; wait more than 1 s; Space stops the
  take.
