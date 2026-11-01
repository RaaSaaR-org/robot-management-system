---
id: "TASK-463"
aliases: []
title: "After an E-stop with no headset in VR, the session page takes control for Stand up and Balance"
slug: "after-an-e-stop-with-no-headset-in-vr-the-session-page-takes"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core, safety]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "high"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# After an E-stop with no headset in VR, the session page takes control for Stand up and Balance

## Description

On a VR session, after an E-STOP and Reset E-stop, the take dock's recovery
shows Stand up and Balance, but both stay disabled while nobody is in VR
(desktop testing, the headset off, the Quest crashed). The recovery says "Take
control in the VR window, or through the Control cell", and the Control cell
has no Take control on a VR session. So the assistant cannot stand the robot up
from the session page. The 2026-10-31 sim rehearsal hit this and had to go
through the robot's Teleop tab. This task gives the recovery its own Take
control, using the page's readiness lease the way Set up's stance step does,
offered only while no headset holds the lease, and given back once the robot
balances.

Branch: `fix/task-463-after-an-e-stop-with-no-headset-in-vr-the-session-page-takes`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
  - `:934`: `showRecovery = phase === 'record' && (stop !== null || notBalancing)`;
    `:926`: `notBalancing` is VR only;
  - `:953-966`: `modeControl`, the recovery slot's `RobotModeControl`
    (`variant="step"`, `dense`), gets
    `takeControlHint="Take control in the VR window, or through the Control cell."`
    and **no** `onTakeControl`;
  - `:815-833`: Set up's stance step passes `onTakeControl={readinessLease.take}`,
    so there Take control is the step's lit action;
  - `:722-727`: `readinessLease.take` is `leaseTake.take` on a VR session
    without simulated input;
  - `:476-482`: `releaseOnStart` releases the page's lease as soon as the
    session is no longer `created`. A take of the lease during Record would be
    given back at once by this effect;
  - `:1082-1098`: the Control cell on a VR session shows a read-only
    `ControlLeaseBar` and "The operator takes control in the headset. This page
    never takes it from them.";
  - `:986-998`: `EstopRecovery` with `headset={isVrSession}` and
    `standUp={isVrSession && measuredMode !== 'balance'}`.
- `app/src/features/robots/components/RobotModeControl.tsx`:
  - `:304`: `needsControl: !lease.enabled || lease.state !== 'bound'`;
  - `:423-428`: `offerTake` only when `onTakeControl` is passed, otherwise the
    hint line;
  - `:496-510`: the `robot-mode-take-control` button.
- The server never preempts a lease (`server/src/services/ControlLeaseService.ts`
  `acquire`, 409 `lease_held` for a second holder), so a page Take control
  while the headset holds control fails cleanly; it does not take control away.
- The relay (TASK-417, `requestFromHolder`) covers the case where the operator
  is in VR; this task covers the case where nobody is.

### Frontend

- The recovery slot's `RobotModeControl` gets `onTakeControl` when the session
  is VR, no simulated input runs, and the lease is not bound to anyone (no
  holder in the lease state). With a holder, keep today's hint and the relay.
- Taking control from the recovery must survive `releaseOnStart`: give the
  recovery take its own flag (for example `leaseTake.take({ purpose: 'recovery' })`
  or a separate `recoveryWanted` state) that the Record-phase release does not
  undo.
- Give the lease back on its own once the robot measures Balance (the mode the
  headset needs to drive the arms), and when the session ends. While the page
  holds it, the slot shows the existing `PageLeaseLine` ("You have control of
  <robot>." with Release).
- The Control cell's VR text changes to say the page takes control only while
  no headset holds it, after an E-stop.
- A take refused with `lease_held` shows "Someone else holds the robot. Ask the
  headset, or release control there." in the slot, not the raw error.

### Key files

- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/hooks/useLeaseTake.ts` (or wherever
  `useLeaseTake` lives; extend it for the recovery take)
- `app/src/features/robots/components/RobotModeControl.tsx` (reuse; change only
  if needed)
- `app/src/features/datacollection/pages/__tests__/SessionDetailPage.setup.test.tsx`
  (or a new `SessionDetailPage.recovery.test.tsx`)
- `app/e2e/datacollection-console.spec.ts`

## Acceptance Criteria

- [ ] On a VR session with no headset holding the lease, after Reset E-stop the
  recovery slot offers Take control; once bound, Stand up and then Balance work
  from the slot.
- [ ] The page gives the lease back on its own once Balance is measured, and on
  End session; the headset's Take control then succeeds.
- [ ] With the headset holding the lease, the slot offers no Take control and
  the relay still works.
- [ ] The Record-phase `releaseOnStart` does not undo the recovery take.
- [ ] Set up's steps and their lease behaviour are unchanged.
- [ ] Vitest covers the three lease states (free, held by the page, held by
  someone else); the E-STOP clearance checks stay green.

## Test Strategy

- `cd app && npx tsc --noEmit && npx vitest run`, with cases for the recovery
  slot: lease free (Take control shown, then the mode buttons enabled), lease
  held elsewhere (hint, no button), Balance measured (lease released).
- Playwright on the demo VR session with a latched stop: Reset, Take control,
  Stand up, Balance; assert the release request.
- On `sim-g1-edu-dev`: a `vr_quest` session, no headset, E-STOP, Reset, Take
  control, Stand up, Balance from the session page; then open the VR window and
  take control there.

## Notes

- Found in the 2026-10-31 sim rehearsal (finding "After an E-stop with no
  headset in VR, the session page cannot get control back").
- Workaround until this lands: `/robots/<robot>?tab=teleop` in another tab
  (Release keyboard control there first if held), Launch VR → Take control →
  Stand up → Balance → Close, then back to the session page.
- Related: TASK-454 gives non-VR humanoid sessions the arm-control and stance
  steps; TASK-459 refuses Start take while the stop is latched.
