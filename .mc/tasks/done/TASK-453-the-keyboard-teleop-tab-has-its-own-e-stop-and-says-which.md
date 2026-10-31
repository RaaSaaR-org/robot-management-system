---
id: "TASK-453"
aliases: []
title: "The keyboard Teleop tab has its own E-STOP and says which robot it drives"
slug: "the-keyboard-teleop-tab-has-its-own-e-stop-and-says-which"
status: "done"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The keyboard Teleop tab has its own E-STOP and says which robot it drives

## Description

The keyboard teleop section on a robot's Teleop tab (`/robots/:id?tab=teleop`)
has no E-STOP, and its header calls every robot "the simulated robot". On the
real G1 (`g1-edu-4`) Space only clears joint velocity — the arms stay armed — so
the keyboard operator has no emergency stop at hand. Give the section its own
one-click E-STOP, and make the header name the robot and say whether it is real
or simulated.

## Details

### Current state

- `app/src/features/robots/components/tabs/TeleopTab.tsx` —
  `KeyboardTeleopSection` renders a `Panel.Header` whose actions are the
  connection tag and Connect/Disconnect. No E-STOP. The description is
  hard-coded: `'Drive single joints of the simulated robot from the keyboard.'`,
  and once connected `` `${robotType} · ${n} joints · simulation` ``.
- The key legend (`KEY_DISPLAY`) labels Space `Stop`; Space sends
  `{ preset: 'stop' }`, which on the real robot only zeroes velocity.
- The only E-STOPs are `SessionEStopButton`
  (`app/src/features/datacollection/components/session/SessionEStopButton.tsx`,
  the session page's command bar) and the VR modal's.
- The app tells a simulated robot from a real one in one place, inline in
  `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
  `robot.id.startsWith('sim-') || /sim/i.test(robot.model ?? '')`.
- `KeyboardTeleopSection` is also embedded on the session page (keyboard
  fallback in `SessionDetailPage.tsx` and `VRSessionPanel.tsx`), where the
  command bar already holds the page's E-STOP.

### Frontend

1. Reuse `SessionEStopButton` in the keyboard section's header: one click calls
   `safetyApi.triggerRobotEStop(robot.id, …)`, Escape twice within a second
   fires it too (ignored while typing), never a confirmation dialog. Add
   optional `reason`, `triggeredBy` and `testId` props (defaults unchanged for
   the session page).
2. The E-STOP stands alone at the far right of the header in its own zone,
   behind a clear gap: no other control within 64 px at a 1512 px viewport,
   48 px at 1280 px. Normal actions (connection tag, Connect/Disconnect) stay
   to its left.
3. `KeyboardTeleopSection` takes `estop?: boolean` (default `true`). The session
   page's two embeddings pass `estop={false}` — the command bar's E-STOP is
   the page's one E-STOP, and a second Escape-twice binding would fire twice.
4. Move the sim rule into `app/src/features/robots/utils/simRobot.ts`
   (`isSimRobot`) and use it in both `SessionDetailPage.tsx` and the keyboard
   header. The header names the robot and says "real robot" or "simulated".
5. Space's legend label becomes `Stop joints (not an E-stop)`.
6. The key legend moves above the lease bar: it holds no control, so the lease
   bar's Take control / Stop robot stay >= 64 px below the header's E-STOP.

### Key files

- `app/src/features/robots/components/tabs/TeleopTab.tsx`
- `app/src/features/robots/utils/simRobot.ts` (new)
- `app/src/features/datacollection/components/session/SessionEStopButton.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/components/VRSessionPanel.tsx`
- `app/src/features/robots/components/tabs/__tests__/KeyboardTeleopEStop.test.tsx` (new)

## Acceptance Criteria

- [ ] The keyboard section on the Teleop tab shows an E-STOP for every robot, real or simulated.
- [ ] One click on it calls `triggerRobotEStop` for this robot; no confirmation dialog appears.
- [ ] Escape twice within a second fires it; Escape while typing does not.
- [ ] It sits alone at the far right of the header, >= 64 px from any other control at 1512 px and >= 48 px at 1280 px.
- [ ] The header names the robot and says "real robot" for `g1-edu-4` and "simulated" for `sim-g1-edu-dev`.
- [ ] Space's legend reads "Stop joints (not an E-stop)".
- [ ] The session page's embedded keyboard section shows no second E-STOP.

## Test Strategy

- Vitest (`KeyboardTeleopEStop.test.tsx`): the E-STOP is present for a real and
  a sim robot; one click calls the mocked `triggerRobotEStop` with the robot id
  and no dialog opens; header wording for a real and a sim robot; the Space
  label; `estop={false}` renders none. `isSimRobot` unit cases.
- Layout: a private vite at 1512x900 and 1280x800 on
  `/robots/sim-g1-edu-dev?tab=teleop`, the E-stop API route-mocked, measure the
  E-STOP's distance to its nearest other control.
- Gates: `npm run typecheck` and `npx vitest run src/features/robots src/features/datacollection` in `app/`.

## Notes

- 2026-10-31 layout check (private vite, `/robots/sim-g1-edu-dev?tab=teleop`,
  every non-GET `/api` call route-mocked in the browser): nearest other control
  to the E-STOP is Connect at 81 px (1512x900 and 1280x800); the lease bar's
  Take control sits 114 px (1512) / 152 px (1280) below. At 390 px the E-STOP
  takes its own row 48 px under Connect. One click sent one mocked
  `POST /api/safety/robots/sim-g1-edu-dev/estop` (`triggeredBy: teleop-tab`),
  no dialog opened.
- The lease bar keeps its own small `RobotEmergencyStopButton` (shown only with
  the lease capability on): it is the Teleop tab's only Resume path after an
  E-stop, and it still sits next to Take control.
