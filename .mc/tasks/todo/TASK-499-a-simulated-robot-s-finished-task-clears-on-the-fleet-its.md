---
id: "TASK-499"
aliases: []
title: "A simulated robot's finished task clears on the fleet, its robot type reads Unitree G1, and its Voice and Teleop tabs say what a simulation lacks"
slug: "a-simulated-robot-s-finished-task-clears-on-the-fleet-its"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "simulation", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A simulated robot's finished task clears on the fleet, its robot type reads Unitree G1, and its Voice and Teleop tabs say what a simulation lacks

## Description

After TASK-497 (PR #494) the demo instance's simulated robot (`sim-robot-001`,
"SimBot-01", robot agent with `ROBOT_TYPE=g1`, no site) still showed three
defects a presenter walks straight into on https://neodem.emai.dev
(build `sha-8551d68`, 2026-11-13). This task fixes all three in code; nothing
needs a manual step on the instance.

## Details

### 1. "Current task: Charging · Running now" on an online, draining robot

**Current state.** TASK-497 made the agent clear its task name when a charge
ends (`robot-agent/src/robot/SimulationEngine.ts`). The fleet server never
heard about it, for two reasons that stack:

- `RobotStateManager.getRobotInterface()` (`robot-agent/src/robot/state.ts`)
  reported `currentTaskName: undefined`. JSON drops `undefined`, so on the wire
  "no task" and "this agent does not say" were the same absent field.
- The server wrote `currentTaskId` / `currentTaskName` **at registration only**.
  The 30 s health check (`performHealthChecks` in
  `server/src/services/RobotManager.ts`) synced status, battery, pose and
  identity, never the task. And on a re-registration,
  `RobotRepository.upsertWithRegistration` spreads `domainRobotToDb(robot)`
  into the Prisma `update`, where an `undefined` field is skipped — so a robot
  that re-registered idle kept the task of its previous registration. The
  `if (data.currentTaskName !== undefined)` guard in `RobotRepository.update`
  is the same shape, but that method was never called with a task field.

So a robot that registered while charging read "Charging" for as long as its
row lived.

**Robot Agent.** `getRobotInterface()` reports `currentTaskId` and
`currentTaskName` as `null` when there is no task. `Robot` in
`robot-agent/src/robot/types.ts` (and the CLI's copy in
`robot-agent/cli/src/api/types.ts`) types them `string | null`.

**Server.** Three states on the wire, three meanings:

| Reported | Meaning | Server does |
| -------- | ------- | ----------- |
| a string | the task | adopts it when it differs |
| `null` (or a blank string) | no task | clears the stored value |
| absent | the agent does not say (older build, partial payload) | nothing |

- `buildTaskUpdate(current, reported)`, `applyTaskUpdate(robot, update)` and
  `clearedTaskFields(reported)` in `server/src/services/RobotManager.ts`, with
  the types `RobotTaskUpdate` and `ReportedRobot`.
- `performHealthChecks` runs `buildTaskUpdate` on the robot data it already
  fetches, writes the diff with `robotRepository.update` and only then updates
  the cache (a failed write is found again by the next check). A task change
  emits `robot_status_changed` like the other changes.
- `registerRobot` passes the fields reported as `null` to
  `upsertWithRegistration(…, clearedTask)`, which spreads them into the
  `update` branch; the cached robot carries no task rather than a `null`.
- `RobotRepository.update` accepts `null` for the two task fields.

**Healing the live row.** The stale "Charging" on neodem clears by itself: the
server runs a health check right after start, the redeployed agent reports
`null`, and the row is cleared — no database action. It needs the server *and*
the robot-agent image of this change; an agent from before it omits the field,
which by the table above changes nothing.

### 2. Details tab: "Robot type —"

**Current state.** `GET /api/robots/:id/robot-type`
(`server/src/services/robotTypeLink.ts`) links a robot to a robot type — the
dataset configuration with state / action widths — by `metadata.robotTypeId` /
`robotTypeName`, else by its model string matching a type's name. The sim's
model is "Unitree G1 (simulated)" and it states no type. The robot types that
exist are the Dex3-hand G1 configurations (43 and 28 wide), the SO-101 follower
and the Microduck: none describes a plain 29-joint G1, so the server answers
`null` — correctly — and the row showed a dash.

**Frontend.** The link stays honest: the sim is not tied to a Dex3 type it does
not simulate. `RobotTypeValue` in
`app/src/features/robots/components/tabs/InfoTab.tsx` falls back, after the
linked type and the stated name, to the embodiment the agent reports
(`metadata.robotType` → "Unitree G1"), marked `data-linked-by="embodiment"`
with a tooltip saying no robot type with dataset widths is linked. A robot with
none of the three still shows "—".

### 3. Voice and Teleop tabs talk to a presenter like a developer

**Current state.** The Voice tab showed "Start it next to the robot agent:
`python -m voice_service`" with a Retry button and fired
`/voice/status` and `/voice/events`, both 502, every few seconds
(`app/src/features/robots/hooks/useVoiceChannel.ts`). The Teleop tab's
readiness panel said "Can't reach the robot sidecar (8767). Start the robot
side." — the agent's own reason (`robot-agent/src/readiness/why-not-following.ts`),
true for a real robot and meaningless for a robot that has no robot side.

Neither the agent nor the server can tell a pure simulation from a real robot
whose sidecar is down (`metadata.isSimulated` is `!hardwareConnected`), so the
rule is the fleet's existing one, `isSimRobot` in
`app/src/features/robots/utils/simRobot.ts` (id starts with `sim-`, or the
model says sim) **and** the service really being absent. A simulated robot that
does run the services — the `sim-g1-edu-dev` rehearsal robot — keeps the full
tabs, and so does every real robot, hints included.

**Frontend.**

- `useVoiceChannel(robotId, { whenAvailable })`: with the option, health is
  read first (`/voice/health` always answers 200) and the status call and the
  event stream wait until it says the service is up. `VoiceTab` sets it for a
  simulated robot and, when health says unavailable, shows one panel: "Voice is
  not available on a simulated robot". Without the option the hook behaves as
  before.
- `hasNoRobotSide(readiness)` in
  `app/src/features/robots/components/readiness/readinessRows.ts`: no
  supervisor configured, no bringup, agent reachable, sidecar unreachable.
  `TeleopTab` reads readiness once and, for a simulated robot in that state,
  shows "Nothing to start on a simulated robot" in place of the readiness panel
  and drops the compact readiness line from the VR launcher. Keyboard and VR
  teleop stay: they drive the agent's simulated joints.

### Key files

- `robot-agent/src/robot/state.ts`, `robot-agent/src/robot/types.ts`,
  `robot-agent/cli/src/api/types.ts`
- `server/src/services/RobotManager.ts`,
  `server/src/repositories/RobotRepository.ts`
- `app/src/features/robots/components/tabs/InfoTab.tsx`, `VoiceTab.tsx`,
  `TeleopTab.tsx`
- `app/src/features/robots/hooks/useVoiceChannel.ts`
- `app/src/features/robots/components/readiness/readinessRows.ts`

## Acceptance Criteria

- [x] A task the agent reports as `null` clears `currentTaskId` /
      `currentTaskName` on the robot row and in the server's cache, at
      registration and on the health check.
- [x] A payload that omits the task fields leaves a stored task untouched.
- [x] A task that starts or changes after registration reaches the fleet
      (it used to be frozen at the registration value).
- [x] A stale stored "Charging" clears on the first health check after start,
      with no database action.
- [x] The Details tab of the simulated G1 reads "Robot type: Unitree G1"; a
      linked type and a stated type still win; nothing known still shows "—".
- [x] The Voice tab of a simulated robot without a voice service shows one
      plain sentence, no start command, no Retry, and requests only
      `/voice/health`.
- [x] The Teleop tab of a simulated robot without a robot side names no sidecar
      port; Connect and Launch VR remain.
- [x] A real robot, and a simulated robot that has the services, see what they
      saw before.

## Test Strategy

- `server/src/services/__tests__/RobotManager.identity.test.ts` —
  `buildTaskUpdate` (clear on null, keep on absent, adopt, blank, no-op),
  `applyTaskUpdate`, `clearedTaskFields`.
- `server/src/services/__tests__/RobotManager.test.ts` — registration with
  `null` task fields clears them on the upsert and leaves none in the cache.
- `server/src/repositories/__tests__/RobotRepository.test.ts` — `update` writes
  `null`; `upsertWithRegistration` puts the cleared field into `update`.
- `robot-agent/src/robot/__tests__/robot-interface-no-task.test.ts` — the task
  fields are present and `null` after JSON.
- `app/src/features/robots/hooks/__tests__/useVoiceChannel.test.tsx` — health
  only while unavailable; status and stream once available; unchanged without
  the option.
- `app/src/features/robots/components/__tests__/unconnectedRobot.test.tsx` —
  the three tabs for the simulated G1, the rehearsal case and a real robot.
- Local run (server :3411, robot agent `ROBOT_TYPE=g1` :41411, app :1511):
  a row edited to `currentTaskName = 'Charging'` cleared within seconds of the
  server starting; a move command's task name reached the server on the next
  health check and cleared on the one after arrival; the Overview, Details,
  Voice and Teleop tabs checked at 1440x900, with no failed API call on any of
  them.

## Notes

- Not exercised live: the literal charge → full path. The local robot has no
  site and so no charger ("Cannot find a charging place"); the clear on a full
  battery is TASK-497's unit test, and the server half was run end to end with
  a move task, which takes the same adopt-then-clear path.
- The task name reaches the fleet on the health check, so it can trail the
  robot by up to 30 s in either direction.
- The VR window's own header still shows the agent's sidecar line for a
  simulated robot once Launch VR is pressed; the session page's readiness
  panels are untouched as well.
