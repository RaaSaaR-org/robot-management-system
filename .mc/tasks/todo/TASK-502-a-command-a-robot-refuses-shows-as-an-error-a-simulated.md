---
id: "TASK-502"
aliases: []
title: "A command a robot refuses shows as an error, a simulated robot can charge, the Activity tab lists its commands, and the 3D model appears whole"
slug: "a-command-a-robot-refuses-shows-as-an-error-a-simulated"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "command", "simulation", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-14"
updated: "2026-11-14"
---

# A command a robot refuses shows as an error, a simulated robot can charge, the Activity tab lists its commands, and the 3D model appears whole

## Description

A review of the demo instance (https://neodem.emai.dev, 2026-11-14) found five
defects around robot commands and the 3D viewer that a presenter walks straight
into: a refused command toasts green, the dashboard's own "Return home" chip
fails, Charge cannot work on the simulated robot, the Activity tab is always
empty, and on a cold load the G1 assembles itself from floating fragments in
two colours. This task fixes all five with the smallest change each.

## Details

### 1. A refused command shows a green success toast

**Current state.** `POST /api/robots/:id/command` answers 200 with the command
as the agent returned it. A command the agent refuses has `status: "failed"`
and an `errorMessage` (Charge on SimBot-01: "Cannot find a charging place: this
robot has no registered place graph."). `robotsApi.sendCommand`
(`app/src/features/robots/api/robotsApi.ts`) returned it like any other, and no
caller read `status`, so every one toasted success.

**Frontend.** `robotsApi.sendCommand` throws `RobotCommandFailedError` (exported
from the same file; `message` is the robot's `errorMessage`, `command` the
refused command) when the returned command is `failed`. `sendToCharge`,
`returnHome` and `emergencyStop` go through it. Every caller already catches
and shows an error toast with the message: `RobotDetailPanel` (Charge / Home),
`CockpitCommandDock` (quick actions), `CommandBar` (via `commandStore` →
`commandApi.executeCommand`), `EmergencyStopButton`, `robotsStore.sendCommand`
(rethrows the message). `useScanSession`'s sweep moves already swallow
rejections. `useRobot`'s actions refresh the command history in a `finally`, so
a refused command still shows up in the Activity tab.

### 2. Dashboard "Command a robot": "Return home" is accepted and fails

**Current state.** Without an LLM key the server's keyword interpreter
(`server/src/services/CommandInterpreter.ts`, `fallbackInterpretation`) only
extracts a target behind "to/towards/at", so "Return home" is a `navigation`
with no target. `commandApi.executeCommand`
(`app/src/features/command/api/commandApi.ts`) picked the home / charge helpers
from `parameters.target` only, so it sent a bare `move`, which the agent
refuses with "No destination provided" — and the interpretation was then
PATCHed to `executed`.

**Frontend.** `targetlessAction()` in `commandApi.ts` maps a phrase with no
target, no destination and no objects to `return_home` (whole word "home") or
`charge` ("charge", "charging", "recharge"), for a `navigation` or `custom`
interpretation only — a status question or an emergency is never rerouted.
When the robot refuses the command, the interpretation is PATCHed to `failed`
(with the refused command's id) instead of `executed`, and the error is
rethrown so the toast is an error.

### 3. Charge on a purely simulated robot with no place graph

**Current state.** `CommandExecutor.beginCharge`
(`robot-agent/src/robot/CommandExecutor.ts`) asks
`getChargingStationLocation()` (`robot-agent/src/tools/navigation.ts`), which
throws when the robot has no registered place graph. The pure kinematic sim has
no sidecar, its pose frame is `odom`, and no graph ever registers — while the
simulation's own low-battery path (`SimulationEngine.chargingStation`) falls
back to a charger at the frame origin.

**Robot Agent.** New opt-in config `simulatedRobot` (`SIMULATED_ROBOT=true`,
default false; `robot-agent/src/config/config.ts`, `.env.example`), passed to
the executor as `simulated`. `beginCharge` falls back to
`simulatedChargerLocation()` (exported from `navigation.ts`, now also what
`SimulationEngine` uses) **only** when `simulated === true` **and**
`locomotion.engaged()` is false. A real robot, an unconfigured agent, and a
simulation that walks through the sidecar are all still refused with the same
message; `getChargingStationLocation()` itself is unchanged.

**Helm.** `robotAgent.env.simulated` (default `"true"` — the chart's robot
agent is the simulated robot) sets `SIMULATED_ROBOT`
(`helm/neodem/templates/robot-agent-deployment.yaml`, `values.yaml`,
`docs/deployment.md`). A deployment that keeps its own copy of the chart has to
add the env var itself for the simulated robot to charge.

### 4. Activity tab always says "No commands yet"

**Current state.** `robotsApi.getCommands` was a stub returning an empty list.
The agent keeps the history (`GET /api/v1/robots/:id/commands`,
`robot-agent/src/api/rest-routes.ts`) but the server had no route relaying it.

**Server.** `GET /api/robots/:id/commands` in
`server/src/routes/robot.routes.ts`: read-only relay of the agent's history;
`page` / `pageSize` pass through when positive integers; 404 for a robot
unknown here or to its agent, 502 when the agent cannot be reached or errors.
Documented in `docs/api.md`.

**Frontend.** `robotsApi.getCommands` calls it and reads 404 / 502 as an empty
list. `useRobot` (`app/src/features/robots/hooks/useRobots.ts`) loads the
history once the robot is known and not offline (an expected or offline robot
stays quiet, TASK-485), again when its status changes, and after each action;
a failed load keeps the list as it was.

### 5. The 3D model assembles from fragments, late meshes keep another colour

**Current state.** `URDFModel` in
`app/src/features/robots/components/visualization/RobotModel.tsx` showed the
robot as soon as the URDF text had parsed; `urdf-loader` then fetched each mesh
separately and each appeared as it landed. The custom material was applied in
`useFrame` only for the first 3 s, so a mesh arriving later kept the loader's
default material.

**Frontend.** New `visualization/modelLoading.ts`:
`watchModelLoad(manager, onState, timeoutMs)` watches the `THREE.LoadingManager`
the URDF and all of its meshes load through and reports `loading` → `ready`
(everything ended, failed meshes included) or `timeout` after
`MODEL_REVEAL_TIMEOUT_MS` (20 s: reveal what has loaded); `applyRobotMaterial`
restyles every mesh not yet carrying the model's material and skips
`userData.keepMaterial` meshes (linkOverlay). `URDFModel` mounts the robot
hidden behind the existing wireframe placeholder until the load settles, and
runs the material pass every frame with no time window. `Robot3DViewer` shows
"Loading 3D model… n / m" (`data-testid="robot-3d-loading"`) meanwhile through
the new `onLoadState` prop of `RobotModel`.

### Key files

- `app/src/features/robots/api/robotsApi.ts`
- `app/src/features/robots/hooks/useRobots.ts`
- `app/src/features/command/api/commandApi.ts`
- `app/src/features/robots/components/visualization/modelLoading.ts` (new)
- `app/src/features/robots/components/visualization/RobotModel.tsx`
- `app/src/features/robots/components/visualization/Robot3DViewer.tsx`
- `server/src/routes/robot.routes.ts`
- `robot-agent/src/robot/CommandExecutor.ts`, `robot-agent/src/tools/navigation.ts`,
  `robot-agent/src/robot/SimulationEngine.ts`, `robot-agent/src/robot/state.ts`,
  `robot-agent/src/config/config.ts`, `robot-agent/.env.example`
- `helm/neodem/templates/robot-agent-deployment.yaml`, `helm/neodem/values.yaml`
- `docs/api.md`, `docs/deployment.md`

### Left out on purpose

- Putting SimBot-01 on the site map / changing its pose frame — too risky two
  days before the demo.
- The status-push timing after Home (the robot starts charging right after it
  arrives home and refuses commands for about a minute).

## Acceptance Criteria

- [x] A command the robot refuses (`status: "failed"`) makes
      `robotsApi.sendCommand` / `sendToCharge` / `returnHome` / `emergencyStop`
      throw the robot's `errorMessage`; no caller shows a success toast for it.
- [x] "Return home" and "Charge" typed without a target send `return_home` /
      `charge`; a refused command marks the interpretation `failed`, never
      `executed`.
- [x] `charge` with no known charging place succeeds on an agent with
      `SIMULATED_ROBOT=true` and no real locomotion engaged, and is refused in
      every other combination (tests assert all four).
- [x] `GET /api/robots/:id/commands` relays the agent's history; the Activity
      tab lists it; 404 / 502 read as an empty list.
- [x] The URDF model is hidden until all meshes have loaded or 20 s have
      passed, the viewer shows a loading note meanwhile, and every mesh gets
      the model's material whenever it arrives; `keepMaterial` meshes are
      untouched.

## Test Strategy

- `app`: `npx tsc`, `npx vitest run` —
  `robotsApi.commands.test.ts`, `commandApi.execute.test.ts`,
  `modelLoading.test.ts`.
- `app` Playwright (demo build): `e2e/robot-model-loading.spec.ts` holds the
  mesh requests back and asserts the loading note, then its disappearance.
- `server`: `npm run typecheck`, `npx vitest run` — `robot-routes.test.ts`
  (`GET /api/robots/:id/commands`).
- `robot-agent`: `npm run typecheck`, `npx vitest run` —
  `command-executor-charge-sim.test.ts`; `navigation-places.test.ts` still
  asserts that a charger is never invented.

## Notes

- The demo instance needs new app, server and robot-agent images, and
  `SIMULATED_ROBOT=true` on its simulated robot agent.
- The command history lives in agent memory: it empties when the agent
  restarts, and refused commands are listed as failed.
