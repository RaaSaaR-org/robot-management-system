---
id: "TASK-437"
aliases: []
title: "The arm-control confirm takes control again when the lease ran out"
slug: "the-arm-control-confirm-takes-control-again-when-the-lease"
status: "done"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "safety", "ui"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The arm-control confirm takes control again when the lease ran out

## Description

On the session page, Set up step 2's "Switch to arm control" was refused with
409 `lease_required` in a walkthrough with the sim robot `sim-g1-edu-dev`. The
lease that "Take control" had just taken ran out while the confirm was open:
the browser tab stopped running for about 12 s and missed its renewals, so the
robot expired the lease. The confirm then sent the switch with no lease. This
task makes the switch go out only with control held. The confirm takes control
again, which is the explicit press that taking control needs, or sends nothing
and says why. A VR session page now also says when its control ended on its
own. It also stops the supervisor sim from handing the lease over to a limp
robot the moment arm control comes on.

Branch: `fix/task-437-the-arm-control-confirm-takes-control-again-when-the-lease`.

## Details

### Current state

- The walkthrough of 2026-10-30, VR session
  `8d9eec53-a459-4cc0-9089-7db60914f2c0`. Server times are in
  `~/.local/state/neodem/logs/dev-server.log`, local time (UTC+1):
  - 20:51:32.928: `POST /api/robots/sim-g1-edu-dev/control-lease` 201
    (generation 28). The agent bound it, `take()` resolved, and the confirm
    opened.
  - 20:51:33.630 to 20:51:45.846: nothing from that page reached the server.
    Its 1 Hz base-mode poll and its 5 s camera poll stop, and the page sends no
    renew at all. In normal windows the page completes 17 to 19 requests per
    12 s. When it resumes, one of each poll arrives at once. That is a tab that
    did not run (a stalled main thread, with the WebGL context lost), not a
    slow server. Checked minutes later, the GPU on this box was at 100% from
    other processes.
  - The agent (`sim-g1-edu-dev-agent.log`):
    `[ControlLease] generation 28 expired` (TTL 5 s, no renewals), then
    `released generation 28`.
  - 20:51:45.846: `POST …/control-lease/release`. The page's lease hook ended
    the lease when it ran again: the agent had said `expired`.
  - 20:52:42.487: `POST …/bringup/sidecar-mode` 409 `lease_required`
    (`server/src/routes/robot-bringup.routes.ts` `requireLease`).
- The hand-over did not cause the release.
  - `leaseWorkDone()` (`app/src/features/datacollection/utils/setupSteps.ts`)
    needs `armControlOn()`, which is false while the sidecar is read-only.
  - `releaseOnStart` needs a session that is not `created`.
  - The VR-window trigger needs the window open.
- A remount did not cause it either: `useSessionControlLease` opened exactly
  one teleop socket (one `[TeleopProxy]` line).
- The same flow on the robot's Teleop tab at 19:11:57 renewed every second for
  the whole 19 s before the switch.
- A headless re-run of step 2 on the live stack held the lease, and renewed
  it, for 17 s through the open confirm.
- `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`
  `useReadinessActions`: the arm confirm's `onConfirm` sent
  `actions.switchMode('arm_sdk', lease?.grant() ?? null)`. With the lease gone,
  that is a body without `leaseId`. Nothing closed or re-checked the confirm
  when the lease ended.
- `SessionDetailPage.tsx`: on a VR session without simulated input, no
  `ControlLeaseBar` renders. The lease hook's notice ("Your control lease
  expired on the robot.") showed nowhere. Step 2 just went back to "Nobody has
  control".
- On the supervisor sim the hand-over fired early, about 1 s after the switch,
  with the robot limp. Reproduced live on main: Stop, Start, Take control,
  Switch, then the release and the "You gave control back" toast.
  - In that second, the snapshot looked like this: the supervisor already
    reports `sidecarMode: arm_sdk` (`armControlOn()` true), the restarting
    sidecar is unreachable, the agent has no base reading, and the mode gate
    reads off.
  - The readiness mode row of a `sim` sidecar without a base is `idle` ("not
    measured (sim)"). `stanceFacts()` counted that as "nothing to stand up",
    which made `leaseWorkDone()` true.
  - That shortcut is meant for the legacy MuJoCo facade (`sim_node.py`, no
    write mode, no supervisor). The supervisor sim runs the real
    `g1_sidecar.py`, which has the FSM.
  - A real sidecar (`sim: false`) reads `unknown` there, so `g1-edu-4` never
    took this path.

### Frontend

- `RobotReadinessPanel.tsx` `switchToArmControl()`, the arm confirm's action:
  - With a grant it switches, as before.
  - Without a grant and with leases on, it calls `lease.take()` (the session
    page's `useLeaseTake`, the Teleop tab's take). Then it switches with the new
    grant.
  - When the take fails, or the host offers none, it sends nothing. The error
    line reads "…so arm control was not switched on."
  - With leases off, it switches with no grant, as before.
- `components/console/PageLeaseLine.tsx` `PageLeaseLostLine`: an amber line
  "<notice> Take control again to go on." (`data-testid="setup-lease-lost"`).
- `SessionDetailPage.tsx` shows `PageLeaseLostLine` in these cases:
  - Conditions: a VR session without page inputs, the page asked for control
    (`leaseTake.wanted`), the lease is not bound, and the hook left a `lost`
    notice.
  - Where: in step 2 while arm control is off, and in step 3 once it is on.
  - A release on purpose leaves no notice, so neither Release nor the hand-over
    shows the line.
- `utils/setupSteps.ts` `noLocomotionFsm()`: step 3 skips "Stand up and
  balance" only on the legacy facade (a `sim` sidecar with no write mode, and
  no supervisor `bringup`). The `idle` mode row alone no longer counts.
- The hand-over trigger stays as TASK-427 defined it: arm control on, and the
  robot measured in Balance (`leaseWorkDone`). On `g1-edu-4`, Balance is FSM
  501 (`G1_FSM_BALANCE_REPORTED: "501"`), so the hand-over cannot fire before
  it. `setupSteps.test.ts` already covers stand, limp, and read-only while
  balancing.

### Key files

- `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`
- `app/src/features/datacollection/components/console/PageLeaseLine.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/utils/setupSteps.ts`
- `app/src/features/datacollection/utils/__tests__/setupSteps.test.ts`
- `app/src/features/datacollection/pages/__tests__/SessionDetailPage.armSwitchLease.test.tsx` (new)
- `app/src/features/robots/components/readiness/__tests__/TakeControlAndStaleCode.test.tsx`

## Acceptance Criteria

- [ ] Step 2: Take control, then confirm: the switch carries the lease taken
      in step 2, and nothing releases it before the switch.
- [ ] Take control, then the robot expires the lease while the confirm is
      open, then confirm: the page takes control again and the switch carries
      the new lease. No 409.
- [ ] If control cannot be taken again, no switch request goes out and the step
      says arm control was not switched on.
- [ ] A lease that ended on its own shows "<notice> Take control again to go
      on." in step 2 (step 3 once arm control is on). A deliberate release or
      the hand-over shows nothing.
- [ ] The hand-over still fires only on arm control on and measured Balance.
      That includes the supervisor sim while its sidecar restarts into arm
      control, where the mode is unread. The legacy MuJoCo facade still has
      nothing to stand up.
- [ ] app tsc and vitest pass, and the Playwright demo gate specs
      datacollection-console, datacollection-takes, quest-connect,
      datacollection-new-session and robot-readiness pass.

## Test Strategy

- `SessionDetailPage.armSwitchLease.test.tsx` runs the real
  `useSessionControlLease`, `useControlLease` and `useLeaseTake`. Only the
  lease API and the agent's socket are stand-ins. The sidecar-mode handler
  answers as the server does (409 without a lease).
  - The held lease reaches the switch, and nothing releases it.
  - The agent sends `{type:'lease', state:'expired'}` while the confirm is
    open. Before the change, the confirm sent `{"mode":"arm_sdk","confirm":true}`
    with no lease (the live 409). Now it binds generation 29 and switches with
    it.
  - When a re-take is refused, nothing is sent.
- `TakeControlAndStaleCode.test.tsx` covers the same at the panel:
  - the panel takes control again before the switch;
  - with no take offered, the panel sends nothing.
- `setupSteps.test.ts`:
  - The supervisor sim restarting into arm control (sidecar unreachable, base
    null, gate off, supervisor `arm_sdk/starting`) is not done. This failed
    before the change.
  - The legacy facade is still done.
- Live, sim only, 2026-10-30. Scripts drove headless chromium, and CDP
  `Debugger.pause` froze the tab for 9 s while the confirm was open.
  - On main (:1420): the lease expired during the pause, the page released it
    on resume, and the switch got 409 `lease_required`. That is the
    walkthrough exactly.
  - On this branch (a dev server on :1450 against the same API): step 2 showed
    "Your control lease expired on the robot. Take control again to go on."
    The confirm acquired generation 32, and the switch got 202 (arm_sdk).
  - Hand-over after a fresh read-only start, then Take control and Switch:
    - on main, the lease was released 1.0 s after the switch, with the robot
      limp;
    - on this branch, it was still held 15 s later.
  - Step 3, Stand then Balance: the hand-over toast and the release came 0.3 s
    after Balance was measured (FSM 500 on the sim), and not at Stand.

## Notes

- A tab that does not run for longer than the lease's local deadline (about
  3 s) loses control by design. The lease is the dead-man for the console. The
  fix makes that loss visible and recoverable. It does not stretch the lease.
- On a GPU that other processes saturate (Isaac, GR00T, training on the 5090),
  the session page's WebGL twin can stall the desktop browser like this. Keep
  heavy GPU jobs off the desktop that runs the session page during a
  real-robot session.
