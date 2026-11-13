---
id: "TASK-497"
aliases: []
title: "The simulated robot is a Unitree G1 by default, its 3D model loads compressed, and it stops showing Charging once it is full"
slug: "the-simulated-robot-is-a-unitree-g1-by-default-its-3d-model"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "simulation", "demo", "helm", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The simulated robot is a Unitree G1 by default, its 3D model loads compressed, and it stops showing Charging once it is full

## Description

The demo instance's simulated robot (`sim-robot-001`, "SimBot-01") read as
unfinished next to the three seeded demo robots. A walkthrough of
https://neodem.emai.dev on 2026-11-13 (build `sha-19da473`) found the causes
below; this task fixes the ones that are code and lists the ones that need a
values change in the deployments repo.

## Details

### Current state (what the walkthrough found)

1. **It is an H1.** The Helm chart never passes `ROBOT_TYPE`, so the agent runs
   its default embodiment `h1` with the model string "SimBot H1" — on a platform
   whose demo is about the G1. As an H1 it also fabricates a wheeled-base sensor
   panel (sonars, bumpers, cliff detector, "Gripper closed: OK") and has no
   battery-health, IMU or motor-temperature panels ("Hottest motor — Not enough
   history yet"). The G1 simulation has all of those and no fabricated sensors.
2. **"Current task: Charging — Running now" on an idle robot at 79 % and
   draining.** `SimulationEngine.chargeBattery` set the status back to `online`
   at 100 % but left `currentTaskName = 'Charging'`, forever.
3. **The live 3D model is blank for many seconds.** `app/nginx.conf.template`
   has no MIME type for `.dae` / `.STL` / `.urdf`, so the 30-35 MB of meshes per
   robot go out as uncompressed `application/octet-stream` with no cache
   lifetime. On the demo instance the robot page showed an empty grid after 5 s
   and the control center half a robot.
4. **Front sonar "999.0 cm"** (an out-of-range sentinel shown as a reading) and
   left/right sonar without a unit.
5. **Details tab:** metadata printed as raw keys and booleans — "IS SIMULATED
   true", "HARDWARE CONNECTED false", "EMBODIMENT h1", "FOOTPRINT RADIUS M".
6. **Header "SimBot H1 · Place unknown"** on a robot that has no site, where a
   place cannot be known.

### Robot Agent

- `robot-agent/src/robot/SimulationEngine.ts` — clear the `Charging` task name
  when the battery is full, and on any tick where the robot is not charging
  (heals the snapshot the live agent already carries).
- `robot-agent/src/robot/telemetry.ts` — the idle front sonar reads a wall
  inside its 3 m range instead of 999.

### Helm

- `helm/neodem/templates/robot-agent-deployment.yaml` — pass
  `robotAgent.env.robotType` as `ROBOT_TYPE` when set.
- `helm/neodem/values.yaml` — default `robotType: "g1"`,
  `robotModel: "Unitree G1 (simulated)"`.
- `helm/neodem/README.md`, `docs/deployment.md` — the two values.

### Frontend

- `app/nginx.conf.template` — gzip and a one-day cache for
  `/assets/robots/**.(dae|stl|urdf|obj|glb)`.
- `app/src/features/robots/components/tabs/InfoTab.tsx` — metadata labels
  ("Simulated", "Hardware connected", "Footprint radius (m)"), Yes/No for
  booleans, the embodiment by name.
- `app/src/features/robots/components/RobotDetailPanel.tsx` — "No site" instead
  of "Place unknown" when the robot has no site.
- `app/src/features/robots/components/SensorGrid.tsx` — unit for left/right sonar.

### Not in this task

- **SimBot-01 on the site map.** Binding the kinematic simulation to a site
  shows it as "Not aligned — fence not enforcing", and "Align" answers "robot
  reports no odometry frame": only a sidecar-backed robot (MuJoCo `sim_g1_dds`
  or hardware) has a pose the place tracker accepts. Giving the kinematic
  simulation a site-frame pose would also arm the keepout fence on a simulator
  that moves in straight lines through racks, latching protective stops. That
  is a design change, not a cosmetic one — SimBot-01 stays under "No site".
- "Robot type —" on the Details tab: the server links a robot to a robot type
  by metadata or model string, and nothing links the simulation.

## Acceptance Criteria

- [x] A chart install with default values runs the agent with `ROBOT_TYPE=g1`; an empty `robotType` leaves the variable unset
- [x] A robot that finishes charging reports no current task; a stale `Charging` on a robot that is not charging is cleared on the next tick
- [x] Robot meshes are served gzip-encoded with a cache lifetime
- [x] The Details tab shows "Simulated: Yes", "Hardware connected: No", "Embodiment: Unitree G1"
- [x] A robot with no site reads "No site" in its page header

## Test Strategy

- `robot-agent/src/robot/__tests__/simulation-charging-task.test.ts`
- `app/src/features/robots/components/__tests__/unconnectedRobot.test.tsx` ("reads a simulated robot's metadata as words")
- `helm template` with and without `robotAgent.env.robotType`; `helm lint`
- `nginxinc/nginx-unprivileged:alpine` with the template: `torso_link.dae` 3.0 MB → 1.1 MB, `Content-Encoding: gzip`, `Cache-Control: max-age=86400`
- Local server + agent (`ROBOT_TYPE=g1`) + app, walked with Playwright

## Notes

The demo instance deploys from `RaaSaaR-org/deployments`, path `neoDEM/`, which
carries its own copy of the chart. After this merges and the image tags are
bumped, that copy needs the same two changes:

- `neoDEM/templates/robot-agent-deployment.yaml` — the `ROBOT_TYPE` block from
  `helm/neodem/templates/robot-agent-deployment.yaml`.
- `neoDEM/values.yaml`, under `robotAgent.env`:

```yaml
    robotModel: "Unitree G1 (simulated)"
    robotType: "g1"
```

The agent re-reports its identity only when a sidecar attaches or detaches, so
the fleet record keeps the old model string until the server pulls it again:

```bash
curl -X POST https://neodem.emai.dev/api/robots/register \
  -H 'Content-Type: application/json' \
  -d '{"robotUrl":"http://neodem-robot-agent:41243"}'
```
