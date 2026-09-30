---
id: "TASK-344"
aliases: []
title: "Frame alignment is checked in Isaac Sim on the GPU box"
slug: "frame-alignment-is-checked-in-isaac-sim-on-the-gpu-box"
status: "backlog"
priority: 4
owner: "huhn511"
projects: []
customers: []
tags: [extended, robot-agent]
sprint: ""
parent: "[[TASK-325]]"
depends_on: ["[[TASK-342]]"]
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Frame alignment is checked in Isaac Sim on the GPU box

## Description

Repeat the TASK-342 MuJoCo check (robot booted offset from the twin, aligned
against a place, stopped at a keepout's real edge) against the Isaac Sim stack on
the Linux GPU box. Optional second check from TASK-325; it needs that machine, so it
is parked in `backlog` until someone is at it.

## Details

### Current state

- TASK-342 adds the `--odom-origin boot` / `--spawn` mode to
  `robot-agent/hardware/sim_g1_dds/sim_node.py` only. The Isaac stack
  (`robot-agent/hardware/isaac_camera_facade.py`, `isaac_manip_bridge.py`) reports
  `/health.sim = true`, so the agent treats its pose as the twin frame.

### Robot Agent / hardware

- Give the Isaac facade the same `odom_frame: "boot"` + offset option, or run the
  real `g1_sidecar.py` against Isaac's DDS so the pose arrives as real odometry.
- Run the alignment flow from TASK-341/TASK-343 against the Demo Warehouse twin.

### Key files

- `robot-agent/hardware/isaac_camera_facade.py`, `robot-agent/hardware/isaac_manip_bridge.py`

## Acceptance Criteria

- [ ] On the GPU box, an Isaac-sim G1 booted offset from the twin reports "not
      aligned"; after a place-anchor alignment, a walk toward a keepout stops within
      0.2 m of its real edge.

## Test Strategy

Manual run on the GPU box (`GPU_BOX`), log excerpts attached to the PR.
