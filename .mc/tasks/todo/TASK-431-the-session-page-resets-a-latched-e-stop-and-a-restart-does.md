---
id: "TASK-431"
aliases: []
title: "The session page resets a latched E-stop, and a restart does not invent a protective stop"
slug: "the-session-page-resets-a-latched-e-stop-and-a-restart-does"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "safety", "ui"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-30"
updated: "2026-10-30"
---

# The session page resets a latched E-stop, and a restart does not invent a protective stop

## Description

A live walkthrough of the data-collection session page with the sim robot
`sim-g1-edu-dev` found two problems.

1. The robot agent restored a stale `protective_stop` that no latch held. The
   sim reported it after every restart. The session page then said "E-stop is
   latched", and the command bar showed a red fault tally, while the sidecar
   reported `estop_latched: false`.
2. The real `g1-edu-4` will start tomorrow with a latched E-stop. That is
   correct, but the session page offers the desktop assistant no way to reset
   it.

This task makes the agent restore `protective_stop` only together with its
latch. It gives the session page one lit "Reset E-stop", the reset the VR window
already uses, as the blocker of the step the stop blocks. It also fixes Set up
step 2 for the supervisor sim, which showed "Arm control on" for a read-only
sidecar.

Branch: `fix/task-431-the-session-page-resets-a-latched-e-stop-and-a-restart-does`.

## Details

### Current state

- `robot-agent/src/robot/state.ts`, `restorePersistedState()`:
  - sets `this.state.status = rs.status` from the snapshot, even from a stale one;
  - the sim's `robot-agent/data/state-sim-g1-edu-dev.json` held
    `status: protective_stop` with `estopLatched: false`, 809707 s old.
- Only the E-stop latch is durable (`agentState.estopLatched`, TASK-196). A
  protective stop (comms loss, tilt, geofence) is not persisted.
- `robot-agent/src/safety/SafetyMonitor.ts` has two auto-release paths:
  - `clearCommunicationLossStop()` runs on a returning heartbeat;
  - `clearZoneViolationStop()` runs on positive geofence clearance.
  Both drop the latch and the warning, but leave `status: protective_stop`. The
  robot then reports a stop that nothing holds, and the next save persists it.
- `resetEmergencyStop()` with nothing latched (the "not triggered" path) clears
  stop warnings and returns `true`. It does not touch the status, so a reset
  cannot clear such a stop either. `CommandExecutor.stop()` clears the status
  only while it is `busy`.
- The sim agent's log (`~/.local/state/neodem/logs/sim-g1-edu-dev-agent.log:13156`)
  shows where it came from: `[SafetyMonitor] PROTECTIVE STOP: Server
  communication lost`.
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`:
  - `estopLatched` is `robot.status` protective_stop/error, or any agent or
    sidecar latch;
  - Record's recovery slot (TASK-428 `TakeDock`) then says "E-stop is latched.
    The operator resets it in the headset, or reset it at the robot.", with no
    button;
  - Set up (`utils/setupSteps.ts`) does not mention the latch;
  - the page reads `robot.status` only from the robot list that the app loaded,
    and starts its polled telemetry only if the robot was known online when the
    session loaded.
- The existing desktop resets:
  - `VRTeleopModal.resetEstop` calls `safetyApi.resetRobotEStop`
    (`POST /api/safety/robots/:id/estop/reset`). The server forwards it to the
    agent's `/safety/estop/reset`, which clears the SafetyMonitor latch, the
    durable latch, Agent Mode's latch and the sidecar's latch. It answers
    `robotStatus`, which the server mirrors.
  - Agent Mode's `EstopBanner` resets through `agentmodeApi.resetEstop`.
- `utils/setupSteps.ts` `armControlOn()` returns true for any reachable sidecar
  with `sim: true`. The supervisor sim runs the real `g1_sidecar.py` read-only
  (`sim: true, writeMode: "read_only", readOnly: true`), so step 2 showed "Arm
  control on" while the VR window said the sidecar is read-only. The legacy
  MuJoCo sim facade (`sim_node.py`, `isaac_capture.py`) reports `sim: true` and
  no `write_mode`. The agent's `explainNotFollowing` treats a sidecar as sim only
  when `sim && writeMode === null`.

### Robot Agent

- `state.ts` `restorePersistedState()`, rule 4: a saved `protective_stop` comes
  back as `online`. A restored latch re-applies `protective_stop` through
  `restoreLatchedEmergencyStop` as before. TASK-382 stays: a latched E-stop
  survives a restart and only a deliberate reset lifts it. The boot log says
  when a saved `protective_stop` had no latch.
- `SafetyMonitor.releaseUnlatchedStopStatus()` sets `protective_stop` back to
  `online` and clears the stop's task slot, only while nothing is latched. It
  runs in the following places:
  - `clearCommunicationLossStop()`;
  - `clearZoneViolationStop()`;
  - the not-triggered path of `resetEmergencyStop()`.
  An E-stop or another stop still latched keeps its status.

### Frontend

- `utils/robotStop.ts` (new), `robotStop()`:
  - A latch decides first. That is the agent's (readiness
    `arms.estopLatched`, or the mode read's `estopLatched`) or the sidecar's
    (`sidecarEstopLatched`).
  - Without a latch, `robot.status === 'protective_stop'` is a stop of kind
    `status`.
  - The agent's stop warning in its telemetry (`Emergency stop activated: …`,
    `Protective stop: …`) gives the cause and the reason.
  - Titles: "E-stop is latched.", "Protective stop is latched.", "Protective
    stop.". `resetText()` says what the button does.
- `hooks/useEstopReset.ts` (new): `resetRobotEStop(robotId)`. This is the VR
  window's call; no new API. A failed reset says "Reset failed: …. The robot is
  still stopped."
- `components/console/EstopRecovery.tsx` (new). It shows Reset E-stop (lit or
  secondary), "Reason: …", what the button does, the failure line, and "Then
  stand the robot up again: Limp, Stand up, Balance."
- `utils/setupSteps.ts`:
  - The input gains `stop`.
  - A stop fails step 3 "Stand up and balance" (summary "E-stop latched" /
    "Protective stop"), and the stop's title is its reason line. The model
    exposes `stopStep`.
  - Step 4 now also waits for step 3. Step 5 already did.
  - A readiness `estop_latched` reason belongs to step 3 and is not said twice.
  - A non-VR session has no step 3, so the stop blocks a running step 1.
  - `armControlOn()` uses the sim shortcut only for a sidecar without a write
    mode. A sidecar reporting `readOnly` or `writeMode: "read_only"` is never on.
- `SessionDetailPage.tsx`:
  - Set up's step 3 renders `EstopRecovery` above the mode track. Its Reset is
    the step's lit action, and the mode track is unlit while the stop holds.
    After the reset, step 3 says "The E-stop is reset. Stand the robot up again:
    Limp, Stand up, Balance." until the robot balances.
  - Record's recovery slot shows the stop's title. `EstopRecovery` comes right
    under it, its Reset lit. The take primary turns secondary
    (`TakeDock primaryLit`).
  - The command bar's fault tally counts the stop.
  - The robot's status is fetched on open and after a reset.
  - The polled telemetry starts once the robot is known online.
- `TakeDock.tsx`: `primaryLit` prop.

### Demo

- `src/mocks/readinessDemoHandlers.ts`:
  - fixtures `protective_stop_unlatched` and `estop_reset_limp`;
  - `FIXTURE_ROBOT` gives a pinned stop fixture the robot's status
    (`/api/robots/:id`) and the agent's stop warning (`/api/robots/:id/telemetry`);
  - `POST /api/safety/robots/:id/estop/reset` moves a pinned stop to
    `estop_reset_limp`.
  - All of this is set with the existing pin route
    `POST /api/__demo/robots/:id/readiness`.

### Key files

- `robot-agent/src/robot/state.ts`
- `robot-agent/src/safety/SafetyMonitor.ts`
- `robot-agent/src/robot/__tests__/state-durable-safety.test.ts`
- `robot-agent/src/safety/__tests__/SafetyMonitor.estop-latch.test.ts`
- `app/src/features/datacollection/utils/robotStop.ts`
- `app/src/features/datacollection/hooks/useEstopReset.ts`
- `app/src/features/datacollection/components/console/EstopRecovery.tsx`
- `app/src/features/datacollection/components/console/TakeDock.tsx`
- `app/src/features/datacollection/utils/setupSteps.ts`
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`
- `app/src/mocks/readinessDemoHandlers.ts`
- `app/e2e/datacollection-console.spec.ts`
- `docs/data-collection-two-person.md` (the runbook: Reset E-stop in step 3 and
  in the take dock, and the "Protective stop." row)

## Acceptance Criteria

- [ ] A saved `protective_stop` with `estopLatched: false` restores as
  `online`, fresh or stale. A saved latch still restores `protective_stop`, and
  only a reset lifts it.
- [ ] A returning heartbeat, or geofence clearance, that drops the latch also
  sets `protective_stop` back to `online`. An E-stop still latched keeps it.
- [ ] A reset with nothing latched clears a leftover `protective_stop`.
- [ ] Set up: a latched E-stop is step 3's blocker. Its "Reset E-stop" is the
  page's one lit action when step 3 is current, and steps 4 and 5 wait for step 3.
- [ ] Record: the recovery slot leads with a lit "Reset E-stop", and the take
  primary is secondary meanwhile.
- [ ] The reset is `safetyApi.resetRobotEStop`, the VR window's call. It has no
  confirm, and a failure says why.
- [ ] After the reset, the page says that the robot must be stood up again
  (Limp, Stand up, Balance), and step 3 drives it.
- [ ] No text says "reset it at the robot". The text says what the button does.
- [ ] The stop comes from the agent's and the sidecar's own latch. A
  `protective_stop` status without one reads "Protective stop." with the
  agent's reason when one exists, and the same reset clears it.
- [ ] The E-STOP stays alone. Reset E-stop is at least 64 px from it at 1512 and
  at least 48 px at 1280, in Set up and in Record. The console e2e clearance
  checks stay green and measure the new button.
- [ ] Set up step 2 is not "Arm control on" for a sidecar that reports
  read-only (`readOnly: true` or `writeMode: "read_only"`), sim or not. The
  legacy MuJoCo sim facade (`sim: true`, no write mode) still counts as on.
- [ ] The demo can pin both stops (`estop_latched`,
  `protective_stop_unlatched`), and its reset clears them to the robot limp.

## Test Strategy

- `cd robot-agent && npm run typecheck && npx vitest run`. The new cases are in
  `state-durable-safety.test.ts` (restore, reset) and
  `SafetyMonitor.estop-latch.test.ts` (heartbeat release, the not-triggered
  reset). Run with `HARDWARE_SIDECAR_URL` and `SERVER_URL` pointed at a closed
  port, so no test reaches a robot sidecar or the dev server.
- `cd app && npx tsc --noEmit && npx vitest run`. The new cases are in
  `robotStop.test.ts`, `setupSteps.test.ts` (stop in step 3, waits, non-VR, both
  sim kinds), `SessionDetailPage.setup.test.tsx` (lit Reset, the reset call,
  failure, the status-only stop, the status read on open) and `TakeDock.test.tsx`.
- Playwright demo specs: `datacollection-console`, `datacollection-takes`,
  `quest-connect`, `datacollection-new-session` and `robot-readiness`. The
  console spec gains the TASK-431 block: both stops in Set up and in Record at
  1280 and 1512, with clearance, through the reset.
- Take screenshots of Record and Set up with the latch at 1512 and 1280, before
  and after.

## Notes

- **Restart case.** Rule 4 covers it. A restarted sim no longer comes back in
  `protective_stop`, whatever its state file says.
- **Live run of `sim-g1-edu-dev`.** The server-loss watchdog can trip again.
  - `SafetyMonitor.checkCommunicationTimeout()` fires 30 s after the last inbound
    request. It is armed only after the first one. Inbound requests are any REST
    call through `createRestRoutes`, and the telemetry socket.
  - The profile points the agent's `SERVER_URL` at a closed port
    (`127.0.0.1:18700`). Its only inbound traffic is the dev server's polling and
    the session page.
  - The stop fires when that traffic stops for 30 s: the server is stopped, or the
    page is closed and only the server's 30 s health check is left, against a
    30 s timeout.
  - The stop clears on the next inbound request. Since this task, its status
    clears with it, so nothing is persisted.
  - There is no switch for the watchdog: `SAFETY_CONFIG.communicationTimeoutMs`
    is a constant in `state.ts`. `AGENT_HEARTBEAT_ENABLED` is Agent Mode's
    initiative heartbeat, not this. The sim profile is therefore unchanged, and
    no new safety code was added for it.
- **Real robot.** `g1-edu-4`'s state file holds a latched E-stop ("Platform
  E-Stop: Emergency stop triggered for G1-EDU-4 (real)", 2026-10-29). It will
  come back latched. The people at the robot reset it deliberately, now from the
  session page. Nothing in this task touches that file.
- **Telemetry.** The page's polled telemetry (the demo, and dev mode before the
  first broadcast frame) only started if the robot list arrived before the
  session. The page now hands the robot id to the stream only once the robot is
  known online, so the stream starts either way. The agent's stop warning, and
  so the stop's reason, comes from that stream.
