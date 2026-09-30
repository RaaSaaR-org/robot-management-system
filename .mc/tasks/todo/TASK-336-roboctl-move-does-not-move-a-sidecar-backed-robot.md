---
id: "TASK-336"
aliases: []
title: "roboctl move does not move a sidecar-backed robot"
slug: "roboctl-move-does-not-move-a-sidecar-backed-robot"
status: "backlog"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent]
sprint: ""
parent: ""
depends_on: []
spe:
effort: ""
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# roboctl move does not move a sidecar-backed robot

## Description

`roboctl move "CHARGING-A"` against the G1 EDU agent on the MuJoCo sim answers
`Status: completed` in 1 ms and the robot never moves. The `move` command only drives
the kinematic `SimulationEngine`; a robot whose pose comes from a hardware sidecar
(the MuJoCo sim, a real G1) ignores it. Either route it to real locomotion or refuse
it honestly.

## Details

### Current state (found live, 2026-09-30, TASK-274 end-to-end check)

- Setup: `sim_node.py --scene ../sim_evaluator/mjcf/g1_warehouse_scene.xml`, agent on
  `robot-agent/.env.g1-edu-agent-warehouse` (with `PLACE_GRAPH_PATH` unset), robot bound
  to the seeded "Demo Warehouse".
- `roboctl -u http://localhost:41246 move CHARGING-A` → command `completed`,
  `result.destination {x:0, y:-3.75, place:"CHARGING-A"}` — place resolution (TASK-329)
  is correct — but the robot stays at (0, 0) STAGING.
- `robot-agent/src/robot/CommandExecutor.ts` `moveTo` only sets `state.targetLocation`
  and `status: 'busy'` and returns success at once. The only consumer is
  `robot-agent/src/robot/SimulationEngine.ts` `updatePosition`, which moves the kinematic
  pose; with a sidecar the pose comes from odometry, so nothing walks.
- The same place reached through Agent Mode (`POST /api/v1/robots/:id/agent-mode/command
  {"text":"go to CHARGING-A"}`) walks there over `LocoClient` and `location.place`
  becomes `CHARGING-A` — the locomotion path exists, `move` just does not use it.
- Keepout refusal works on this path (`move RACK-A`, `move 4.5 -1` → failed, naming
  `RACK-A`), because it runs before `moveTo`.
- TASK-329's acceptance criterion "roboctl move CHARGING-A drives the sim robot to that
  place's centroid" holds only for the kinematic SimBot, not the MuJoCo G1.

### Robot Agent

- When a hardware sidecar provides the pose, `move` should hand the resolved target to
  the Agent Mode navigator (`goto` block to a point / place) or, until that exists,
  fail with an explicit "move is not wired to locomotion on this robot — use Agent Mode"
  instead of `completed`.
- The command must not report `completed` before the robot has arrived (or should
  report `accepted`/`executing` and complete on arrival).

### Key files

- `robot-agent/src/robot/CommandExecutor.ts`, `robot-agent/src/robot/SimulationEngine.ts`,
  `robot-agent/src/agent-mode/agent-mode-controller.ts` (navigator entry point),
  `robot-agent/src/tools/navigation.ts` (the Genkit move tool shares the gap)

## Acceptance Criteria

- [ ] On the MuJoCo G1, `roboctl move "CHARGING-A"` either walks the robot into
      `CHARGING-A` (location.place updates) or fails with an explicit message — never a
      `completed` with no motion.
- [ ] The kinematic SimBot behaviour is unchanged.

## Test Strategy

Vitest over `CommandExecutor` with a pose-authority stub; live check with the MuJoCo
warehouse sim as above.
