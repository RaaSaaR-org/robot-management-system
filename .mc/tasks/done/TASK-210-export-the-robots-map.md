---
id: TASK-210
title: Export the robot's map (PGM+YAML for ROS map_server, PNG, JSON)
status: done
priority: 3
tags: [core, agent-mode]
created: 2026-08-16
completed: 2026-08-16
---

## Description

After an Agent Mode run the robot holds a 2-D occupancy grid (TASK-206) but an
operator had no way to take it anywhere: it lived as JSON on `/map` and as
`AGENT_MAP_PATH` on the robot. Give the map an export in the format the rest of
the robotics world reads.

## Details

**Current state:** `GET /api/v1/robots/:id/map` returns the grid as
`int8-logodds-b64` (Int8 log-odds × 25, row-major, `originX/Y` = outer corner
of cell (0,0)); `?format=pgm` gave a P5 with ad-hoc greys and no YAML.

### Robot Agent
- `OccupancyMap.toPgm()` now writes ROS `map_server` greys (0 occupied / 254
  free / 205 unknown), north-up; new `toMapServerYaml(imageFile)`.
- `GET /map?format=pgm|yaml` serve both as attachments (`map.pgm`, `map.yaml`).
- Files: `robot-agent/src/agent-mode/occupancy-map.ts`, `robot-agent/src/api/rest-routes.ts`.

### Frontend
- `app/src/features/agentmode/utils/mapExport.ts`: decode the wire grid,
  PGM body/blob, map_server YAML, PNG (offscreen canvas, 4 px/cell), stem
  `map-<robot>-<lastIntegratedAt>`; `exportMap(robotId, grid, 'pgm'|'png'|'json')`
  (PGM saves the YAML alongside).
- `RobotMapPanel`: **Export** button + menu in the toolbar; disabled with no grid.

## Test Strategy
- `app`: `mapExport.test.ts` (row flip, greys, YAML origin, two-file PGM export,
  corrupt grid → nothing); `RobotMapPanel.test.tsx` export menu.
- `robot-agent`: `occupancy-map.test.ts` map_server greys + YAML.
- Manual: export the house map, `ros2 run nav2_map_server map_server --ros-args -p yaml_filename:=map.yaml`.
