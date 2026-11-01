---
id: "TASK-454"
aliases: []
title: "A keyboard and mouse session drives the real G1 from the session page"
slug: "a-keyboard-and-mouse-session-drives-the-real-g1-from-the"
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

# A keyboard and mouse session drives the real G1 from the session page

## Description

A `keyboard_mouse` session on the real `g1-edu-4` cannot drive the robot from
its own session page. The page holds the robot's one control lease, so the
Keyboard fallback's own Take control gets 409 `lease_held`. Set up never offers
Switch to arm control or Balance. A read-only sidecar is refused with advice
that sends the operator to the wrong fix. And Space both halts the joint and
starts or stops a take. This task hands the page's lease to the keyboard
fallback (the way the gamepad already joins it), gives humanoid non-VR sessions
the arm-control and stance steps, words the read-only refusal as "Switch to arm
control first", and makes every key mean one thing. It merges the first finding
of the 2026-10-31 VR/teleop hunt with the keyboard findings of the session hunt.

Branch: `fix/task-454-a-keyboard-and-mouse-session-drives-the-real-g1-from-the`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- **Two leases for one robot.**
  `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
  - `:439`: `gamepadEligible` is true for `gamepad`, `keyboard_mouse` and
    `bilateral_aloha`;
  - `:449`: `leaseInputs = gamepadEligible || (sessionIsVr && simulateVr)`, so a
    `keyboard_mouse` session opens the page's lease through
    `useSessionControlLease` (`:453-457`); Set up's Take control is the page's
    own `ControlLeaseBar`;
  - `:459-463`: `useGamepadJoints({ …, lease })` joins that lease. Its socket
    binds as a secondary socket through `useInputLeaseGate`
    (`app/src/features/datacollection/hooks/inputLease.ts:67-76`, `bindSocket`);
  - `:476` and `:478`: `pageHoldsLease` and `releaseOnStart` require
    `sessionIsVr && !leaseInputs`, so a non-VR page never gives its lease back;
  - `:665`: Testing tools → Keyboard fallback mounts
    `<KeyboardTeleopSection robot={robot} />` with no lease.
- `app/src/features/robots/components/tabs/TeleopTab.tsx`:
  - `:128-136`: `KeyboardTeleopSection` runs its own `useControlLease(robot.id, …)`
    and `ControlLeaseBar` (`:425`);
  - `:137`: `canDrive = !lease.enabled || lease.state === 'bound'`; a move key
    without it is dropped silently (`:312`).
- `server/src/services/ControlLeaseService.ts:295-330`: `acquire` answers 409
  `lease_held` to any second holder, the same user's other console included.
  So the fallback's Take control fails while the page holds the lease. The
  page's lease socket sends no keys, and on `arm_sdk` the gamepad socket sends no
  `{hb}`/clutch, so it gets `arm_requires_heartbeat`. No input on the page can
  drive the real arms.
- **No arm-control or stance step.**
  `app/src/features/datacollection/utils/setupSteps.ts:185-187`, `stepOrder()`:
  VR types get `['robot', 'arm_control', 'stance', 'quest', 'operator']`;
  everything else gets `['robot', 'input', 'control']`. The page polls the
  robot's mode only for VR sessions (`SessionDetailPage.tsx:467`,
  `useRobotBaseMode(…, { enabled: … && sessionIsVr … })`).
- **The read-only refusal.** `robot-agent/src/recording/EpisodeRecorder.ts:517-524`
  refuses a real read-only sidecar with code `RECORDING_REFUSED` (409) and
  "restart g1_sidecar.py with G1_WRITE_MODE=arm_sdk".
  `server/src/services/TeleoperationService.ts:544-549` wraps every
  `AgentRecordingRefused` in "Stop the recording on <robot> and start the
  session again." Both send the operator to the wrong fix: the page's own
  Switch to arm control is the fix.
- **Space handled three times.** All three are `window` keydown listeners in
  the bubble phase:
  - `TeleopTab.tsx:345-352`: Space sends `{preset:'stop'}` and calls
    `preventDefault()`;
  - `app/src/features/datacollection/hooks/useTakeHotkeys.ts:135-138`: Space
    starts or stops a take;
  - `SessionDetailPage.tsx:418-426`: Space opens the Start session confirm in a
    created session.
  None of them checks `ev.defaultPrevented`. During a take Space stops the joint
  and the take. Between takes it starts one.
- **Dialogs.** The page's and the take hotkeys return on `isDialogOpen()`
  (`app/src/features/datacollection/utils/hotkeys.ts:21`).
  `KeyboardTeleopSection`'s `handleKeyDown` (`TeleopTab.tsx:334-357`) does
  not, so arrow keys keep driving a joint under a confirm dialog.

### Frontend

- `KeyboardTeleopSection` takes an optional `lease?: InputLease` prop. With it,
  the section runs no `useControlLease` of its own and shows no
  `ControlLeaseBar`. Its socket joins the page's lease through
  `useInputLeaseGate` / `bindSocket`, as `useGamepadJoints` does, and
  `canDrive` reads the page lease's `state`. Without the prop (the robot's
  Teleop tab), nothing changes.
- `SessionDetailPage.tsx:665`: pass the page's `lease`.
- `setupSteps.ts`: for a humanoid non-VR session, `stepOrder` returns
  `['robot', 'input', 'control', 'arm_control', 'stance']`. Arm control needs the
  lease grant, so it comes after control. "Humanoid" is decided from the robot's
  readiness and mode capability, the facts the VR `arm_control` and `stance`
  steps already read, never from its name. The systems strip's Arm control and
  Mode cells follow the same order. Enable `useRobotBaseMode` for these
  sessions as well.
- Space is handled once:
  - `KeyboardTeleopSection` registers its `keydown` in the capture phase
    (`addEventListener('keydown', …, true)`) while connected, and calls
    `preventDefault()` on every key it handles;
  - `useTakeHotkeys` and the page's session hotkeys return early on
    `ev.defaultPrevented`.
  With the fallback connected, Space is the joint stop only, and takes start and
  stop with the mouse.
- `KeyboardTeleopSection` ignores key-downs while `isDialogOpen()`. A key-up
  still goes out, so a held joint stops. Move `isDialogOpen` to
  `app/src/shared/utils/` if importing it from `datacollection` into `robots`
  reads wrong.

### Robot Agent

- `EpisodeRecorder.ts:517-524`: refuse a real read-only sidecar with its own
  code `SIDECAR_READ_ONLY` (still 409), so the server can tell it from other
  refusals. Keep the message.

### Server

- `TeleoperationService.startSession`: map `AgentRecordingRefused` with code
  `SIDECAR_READ_ONLY` to a `ConflictError` saying "<robot> is not in arm
  control. Switch to arm control first (Set up), then start the session again."
  Other refusals keep today's wording.

### Key files

- `app/src/features/robots/components/tabs/TeleopTab.tsx`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/features/datacollection/utils/setupSteps.ts`
- `app/src/features/datacollection/hooks/useTakeHotkeys.ts`
- `app/src/features/datacollection/hooks/inputLease.ts` (reuse; change only if needed)
- `robot-agent/src/recording/EpisodeRecorder.ts`
- `server/src/services/TeleoperationService.ts`
- Tests:
  - `app/src/features/robots/components/tabs/__tests__/KeyboardTeleopLease.test.tsx`;
  - `app/src/features/datacollection/utils/__tests__/setupSteps.test.ts`;
  - `app/src/features/datacollection/hooks/__tests__/useTakeHotkeys.test.tsx`;
  - `robot-agent/src/recording/__tests__/EpisodeRecorder.test.ts`;
  - `server/src/services/__tests__/TeleoperationService.test.ts`.

## Acceptance Criteria

- [ ] On a `keyboard_mouse` session with leases on, one Take control (Set up)
  is enough: the Keyboard fallback drives with the page's lease, shows no second
  lease bar, and the server sees no second `acquire`.
- [ ] The robot's Teleop tab keeps its own lease and behaves as before.
- [ ] A humanoid non-VR session shows Switch to arm control and the stance step
  in Set up, and the Arm control and Mode cells in Record. An SO-101 session does
  not.
- [ ] Starting a session behind a real read-only sidecar answers "Switch to arm
  control first", not "Stop the recording".
- [ ] With the fallback connected, Space stops the joint and does not start,
  stop or confirm anything else. With it closed, Space keeps its take and session
  meanings.
- [ ] Arrow keys do nothing while a dialog is open; a key-up still stops the
  joint.
- [ ] Vitest covers each of the above; typecheck passes in app, server and
  robot-agent.

## Test Strategy

- App vitest:
  - render `KeyboardTeleopSection` with a stub `InputLease` and assert that no
    `useControlLease` acquire happens and that a bound page lease lets a move
    key out;
  - `stepOrder` cases for a humanoid non-VR, an SO-101 and a VR session;
  - dispatch Space with the fallback connected and assert that the take and
    session handlers do not fire;
  - open a `role="dialog"` and assert that ArrowRight sends nothing.
- Robot-agent vitest: a real read-only sidecar answers `SIDECAR_READ_ONLY`.
- Server vitest: that code maps to the "Switch to arm control first" sentence.
- On the sim robot `sim-g1-edu-dev`: a `keyboard_mouse` session, Take control
  once, then Keyboard fallback → Connect → ArrowRight moves the selected joint.

## Notes

- Found by the 2026-10-31 pre-session bug hunt (VR/teleop finding 1, and the
  session hunt's keyboard_mouse and Space findings). Traced through the code,
  not run live.
- Workaround until this lands: record keyboard takes from
  `/robots/g1-edu-4?tab=teleop` in its own window (the TASK-424 run sheet). On a
  `keyboard_mouse` page, Release the page's lease (Set up) before Take control in
  the Keyboard fallback, and do not use Space as a take key there.
- Not in scope: the Teleop tab's E-STOP, its "simulation" wording and the Space
  label are TASK-453; the E-STOP above an open dialog is TASK-435.
