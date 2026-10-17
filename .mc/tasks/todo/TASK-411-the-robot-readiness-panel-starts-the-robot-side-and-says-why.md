---
id: "TASK-411"
aliases: []
title: "The robot readiness panel starts the robot side and says why the arms are not following"
slug: "the-robot-readiness-panel-starts-the-robot-side-and-says-why"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "safety"]
sprint: ""
parent: ""
depends_on: ["[[TASK-409]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# The robot readiness panel starts the robot side and says why the arms are not following

## Description

The operator should never need a terminal on robot day. This task adds a **Robot readiness** panel in NeoDEM. It shows a checklist of link, bridge, sidecar, agent, robot mode, arms, each hand, camera and control lease, with one bold "why the arms are not following" line on top. It also has **Start robot side** / **Stop robot side** buttons, an explicit "Switch to arm control" step, and log viewers.

Data and actions come from TASK-409. The VR panels show the same reason (TASK-413).

## Details

### Current state
- **Server (TASK-409):**
  - `GET /api/robots/:id/readiness` → `RobotReadiness {robotId, at, agent:{reachable, error, readiness}, bringup: SupervisorStatus|null, reason:{code, severity, text, source}}`.
  - WS `robot:readiness`.
  - `GET /api/robots/:id/bringup`.
  - `POST …/bringup/start {mode, confirm?}`, `…/stop`, `…/sidecar-mode {mode, confirm}`, `…/steps/:step/adopt|leave`, `…/lan-up`.
  - `GET …/bringup/logs/:proc?tail=` and `…/stream` (SSE).
  - `base-mode` now carries `sidecarReachable`.
- **Agent readiness (TASK-405):**
  - `sidecar{reachable, connected, lowstateAgeS, writeMode, sim}`
  - `base{gate, mode, fsmId, ageS, error}`
  - `arms{armState, armed, armWeight, deadman, lastDisarmReason, trackErrRad, trackErrJoint, estopLatched}`
  - `hands{left,right: {present, ageS, error, motorFaults[], powerV}}`
  - `lease{enforced, state, holder, bound}`
  - `camera{source, cameras, detail}`
  - `telemetrySynthetic`, `reason`
- **App:**
  - `app/src/features/robots/hooks/useRobotBaseMode.ts` polls `/base-mode` at 1 Hz.
  - `app/src/features/robots/components/RobotModeControl.tsx`: `modeDisabledReason` (~l.84) renders "Mode control is off on this robot's sidecar" when the gate is `unknown`. That is wrong when the sidecar is simply unreachable.
  - The VR launch area: `app/src/features/robots/components/tabs/vr/VRTeleopSection.tsx` ("Launch VR" ~l.98, `QuestConnectHelp` ~l.132), rendered by `TeleopTab.tsx:379` and by the session page via `VRSessionPanel`.
  - The VR window header (`VRTeleopModal.tsx`) shows `RobotModeControl`.
  - The global robot socket hook `useRobotWebSocket` is mounted in `AppLayout.tsx:56`.

### Frontend
**Hook.** New `app/src/features/robots/hooks/useRobotReadiness.ts`:
- Subscribes to `robot:readiness` through the existing app socket, using the same handler registration the robots feature uses for `robot_telemetry`.
- Falls back to `GET /readiness` every 2 s when the socket is down, and refreshes the server's watch window every 20 s while mounted.
- Returns `{readiness, stale, actions:{start, stop, switchMode, adopt, leave, lanUp}, pending, lastError}`.

**Panel.** New `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx`:
- **Header.** The reason text, large and coloured by severity (red block, amber warn, green ok), plus its source.
- **Checklist rows.** Each row has an icon, a label, a value and the detail on hover or expand:
  1. Robot LAN (link step: carrier, IP, ping), with a **Bring up LAN** button when the carrier is up but the profile is inactive
  2. State bridge (bridge step: lowstate seen, Dex3 seen)
  3. Sidecar (`writeMode` read-only/arm, `lowstateAgeS`)
  4. Agent (reachable, `telemetrySynthetic` shown as "battery/IMU simulated")
  5. Robot mode (`limp`/`stand`/`balance`, measured age)
  6. Arms (armed weight, dead-man, last disarm reason, tracking error)
  7. Left hand / Right hand (present, age, each fault as `thumb_1 0x200`)
  8. Head camera (`source`, cameras, `detail`)
  9. Control (holder, plus a "2 sockets bound" warning)
  10. Quest: a row placeholder filled by TASK-412
- **Foreign process.** A step in state `foreign` shows pid, cmdline and age with **Adopt** and **Leave** buttons, and never "Kill".
- **Buttons**
  - **Start robot side**: read-only, no confirm.
  - **Switch to arm control**:
    - visible when the sidecar is `read_only` and ready;
    - needs the user's lease, otherwise disabled with "Take control first";
    - opens a `ConfirmDialog` explaining that the sidecar restarts in arm_sdk mode, nothing moves until Balance plus grip, and that xr_teleoperate must not run.
  - **Stop robot side**: confirm. If the measured mode is stand or balance, the dialog adds a **Limp first** option. It calls the existing `useRobotBaseMode().request('limp')`, waits for the measured limp, then stops.
  - **Logs**: a drawer with tabs bridge / sidecar / agent. It shows the tail plus a live SSE stream with auto-scroll and a pause toggle.
- **Pending and errors.** While a step runs, the row shows a spinner with the step's `detail`. Errors from POSTs show inline under the buttons.
- **Without a supervisor** (`bringup:null`), the bringup rows and buttons are hidden, and the agent rows still work (e.g. the sim robot).

**Placement**
- The robot detail Teleop tab (`TeleopTab.tsx`), above `VRTeleopSection`.
- Inside `VRTeleopSection.tsx`, above "Launch VR", as a compact variant (`variant="compact"`: reason line plus failing rows only). That covers the data-collection session page too, because the page renders `VRSessionPanel` → `VRTeleopSection`.
- The VR window header (`VRTeleopModal.tsx`): the reason line only, next to `RobotModeControl`.

**`RobotModeControl.tsx`.** When `sidecarReachable === false`, the disabled reason reads "Can't reach the robot sidecar. Start the robot side." instead of "Mode control is off on this robot's sidecar".

### Key files
- app/src/features/robots/hooks/useRobotReadiness.ts (new) + test
- app/src/features/robots/api/readinessApi.ts (new)
- app/src/features/robots/components/readiness/{RobotReadinessPanel.tsx, ReadinessRow.tsx, BringupLogsDrawer.tsx} (new) + tests
- app/src/features/robots/components/tabs/TeleopTab.tsx
- app/src/features/robots/components/tabs/vr/VRTeleopSection.tsx
- app/src/features/robots/components/tabs/vr/VRTeleopModal.tsx (header line only)
- app/src/features/robots/components/RobotModeControl.tsx (+ test)
- app/src/mocks/* (MSW handlers and a fixture for each reason, in a new file of their own; registering it is a one-line append, so it rebases cleanly against TASK-410)

## Decisions
- **D1 One reason line on top; the checklist explains it.** Rejected: a wall of green and red tiles with no verdict.
- **D2 Start always starts read-only.** Arm control is a second, confirmed, lease-gated step, so starting never puts the motion path up.
- **D3 Stop offers Limp first but never does it implicitly.** Stop never changes the FSM (TASK-403). Limp goes through the existing confirmed mode route.
- **D4 Adopt or Leave, never Kill**, matching the supervisor.
- **D5 A compact variant inside `VRTeleopSection`**, so the session page gets it without editing `SessionDetailPage.tsx`, which TASK-410 edits in the same wave.

## Acceptance Criteria
- [ ] With MSW fixtures for `bringup_stopped`, `bringup_failed:link`, `bringup_foreign:bridge`, `agent_unreachable`, `mode_not_balance`, `hand_fault`, `lease_duplicate` and `not_engaged`, the panel shows each reason text and highlights the matching row (component tests).
- [ ] Start → POST `start {mode:'read_only'}`. Switch to arm control is disabled without the lease and posts `sidecar-mode {mode:'arm_sdk', confirm:true}` after the dialog. Stop with a measured balance offers Limp first, and Limp then waits for the measured limp before posting stop.
- [ ] A foreign step shows Adopt/Leave and no destructive action.
- [ ] The logs drawer renders the tail and appends SSE lines.
- [ ] `RobotModeControl` shows the sidecar-unreachable text when `sidecarReachable:false`.
- [ ] Live, with branch builds on free ports and a supervisor on the `sim-g1-edu-dev.yaml` profile: Start walks the rows to green, and Stop returns them to stopped.
- [ ] `npx tsc` and the app vitest suites pass.

## Test Strategy
- **vitest + Testing Library** with MSW fixtures, one per reason and step state.
- **Playwright demo spec:** the panel renders, Start shows pending then ready using fixtures.
- **Live:** the sim profile only. Never the real-robot profile during development.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-17)

Decisions made while building, and where the merged code differed from this spec:

- **I1 The lease comes from the keyboard section.** On the Teleop tab the control lease lives in `KeyboardTeleopSection`; it now hands `{enabled, state, grant()}` up through `onLeaseChange`, and the panel reads `grant()` at click time only. The server (TASK-409) refuses `arm_sdk` without `leaseId` + `generation`, so the sidecar-mode POST carries them. With leases off on the server the button says so ("Arm control needs a control lease, and control leases are off on this server") instead of "Take control first".
- **I2 The compact variant also offers Start** while the robot side is stopped (read-only, no confirm). Its other buttons — arm control, Stop, logs — stay on the full panel.
- **I3 A "Back to read-only" button** (confirmed, no lease) appears while the sidecar runs `arm_sdk`; the route accepts it and without it the only way back is Stop.
- **I4 Reason → row.** `bringup_stopped` highlights the LAN/simulator row (the first step), `bringup_busy` the running step, `agent_*` / `supervisor_unreachable` the agent row, `hand_*` the hand with the fault (right first), the agent's codes their row; `following` highlights none. A preflight row appears only when preflight is not ok/idle.
- **I5 "Limp first" waits for `base.mode === 'limp'`** on `GET /base-mode` (500 ms poll, 15 s budget); on timeout it says so and does not stop. Its dialog is the stop dialog, so nothing limps without a second explicit click.
- **I6 Logs** read `GET …/logs/:proc?tail=200`, then follow `…/stream` with `fetch` (the route needs the bearer token, which `EventSource` cannot send). The supervisor's stream replays its last 50 lines first; lines already in the tail are skipped. A sim profile adds a `simulator` tab.
- **I7 Socket.** `robot:readiness` arrives as `{type, data: RobotReadiness}` (field `data`, per TASK-409) and lands in `store/readinessStore.ts`; the same store records whether the robot socket is open, which switches the hook between the 2 s fallback poll and the 20 s watch refresh.
- **Deviation: the RobotReadiness shape** has a `supervisor: {reachable, error} | null` field the spec did not list; the agent readiness has `sidecar.readOnly`, `arms.arming`, `arms.claims`, `lease.holder: {userId, displayName}`. Types in `api/readinessApi.ts` follow the merged code.
- **Deviation: the stop answer** is `{status, baseMode}`; the panel decides "Limp first" from the measured mode in the readiness snapshot (agent `base.mode`, else the supervisor's `lastBase`), not from the stop answer, because the offer has to be made before stopping.

### Live check (sim only)

Branch server :3111 on a copy of the dev DB (every robot URL repointed to `127.0.0.1:1`, a fresh `sim-g1-edu-dev` row on :41311), branch supervisor :8911 on a copy of `sim-g1-edu-dev.yaml` (DDS domain 61 / `lo`, sidecar :8811, agent :41311), branch app :1441. Start walked preflight → simulator → bridge → sidecar → agent to ok in about 7 s and the line became "The sidecar is read-only. Switch the robot side to arm control."; Stop returned every row to stopped and the line to "Robot side is stopped. Press Start." No page errors.
