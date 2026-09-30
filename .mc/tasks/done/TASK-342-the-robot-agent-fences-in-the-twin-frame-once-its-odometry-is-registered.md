---
id: "TASK-342"
aliases: []
title: "The robot agent fences in the twin frame once its odometry is registered"
slug: "the-robot-agent-fences-in-the-twin-frame-once-its-odometry-is-registered"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent]
sprint: ""
parent: "[[TASK-325]]"
depends_on: ["[[TASK-341]]"]
spe: 8
effort: "high"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# The robot agent fences in the twin frame once its odometry is registered

## Description

Make the robot agent use the frame registration from TASK-341: a twin place graph
counts as registered for a robot whose odometry is not the twin frame while a
current registration exists, so places, navigation targets and keepouts work; and
make the MuJoCo sim able to boot with odometry offset from the twin, so this is
testable on the Mac.

## Details

### Current state

- `robot-agent/src/agent-mode/place-frame.ts` `assessFrameRegistration(graph, {poseFrame})`:
  twin graph + `poseFrame:'twin'` (sim) → `registered, how:'sim-twin-origin'`;
  twin graph + `odom` → unregistered. `robot/state.ts` (`adoptPlaceGraph`,
  `assessPlaceFrame`, `onPoseSample`, `evaluateGeofenceForPose`) fails closed on an
  unregistered frame; `tools/navigation.ts registeredPlaces()` and the local map
  route (`api/rest-routes.ts`) use `getPlaces()` only when registered.
- `HardwareClient.getOdometryFrame()` is `{kind:'sim', id: scene}` for a sim sidecar
  and `{kind:'odom', id: boot_id}` otherwise.
- `sim_node.py` publishes odometry in the MJCF world frame (= twin origin for the
  Demo Warehouse).
- TASK-341 serves `GET /api/robots/:id/frame-registration` →
  `{twinId, odomFrameId, x, y, yawDeg, method, current, staleReason, …}` with
  `twin = Rot(yawDeg) · odom + (x, y)`.

### Robot Agent

- `agent-mode/frame-registration.ts` (new): the registration record, SE(2) apply /
  invert, `graphInOdomFrame(graph, reg)` (inverse-transform every polygon and
  landmark), and a small source that GETs `/api/robots/:id/frame-registration`
  every `PLACE_REGISTRATION_REFRESH_MS` (default 5000) for a robot-bound graph; 404
  drops it, a network error keeps the last one.
- `place-frame.ts`: new input `registration` + `odomFrameId`; a twin graph on an
  `odom` pose is `registered, how:'registration'` only when the registration's
  `twinId` matches the graph and its `odomFrameId` matches the current odometry
  frame id; otherwise the existing reason (plus why the registration does not apply).
- `robot/state.ts`: when registered by registration, use the graph transformed
  into the odometry frame (so the tracker, geofence, navigation and map keep
  working in odometry unchanged); re-assess when the registration or the odometry
  frame id changes (new boot = unregistered again). Publish
  `location.sitePose = {x, y, heading}` (the pose in the twin frame) whenever
  `siteAligned`.
- Server relays `location.sitePose` like `siteAligned` (`RobotManager.ts` RobotLocation,
  `locationDiffers`).

### Sim

- `robot-agent/hardware/sim_g1_dds/sim_node.py`: `--odom-origin world|boot`
  (env `G1_SIM_ODOM_ORIGIN`, default `world`) and `--spawn X,Y,YAWDEG`. In `boot`
  mode odometry (`rt/odommodestate`, `/loco/odom`, `/state.odometry`) is the base
  pose relative to where it was at start-up, and `/health` adds `odom_frame:"boot"`,
  which `HardwareClient` maps to `{kind:'odom', id: boot_id}`.

### Key files

- `robot-agent/src/agent-mode/{place-frame,frame-registration}.ts`,
  `robot-agent/src/robot/state.ts`, `robot-agent/src/robot/types.ts`,
  `robot-agent/src/hardware/HardwareClient.ts`, `robot-agent/src/config/`,
  `robot-agent/hardware/sim_g1_dds/sim_node.py`, `server/src/services/RobotManager.ts`

## Acceptance Criteria

- [x] MuJoCo on the Mac: sim booted with `--odom-origin boot --spawn 3,2,90` bound to
      the Demo Warehouse twin reports "not aligned" and the fence does not enforce.
- [x] After a place-anchor registration, `location.place` is correct and a walk toward
      a keepout is stopped at the keepout's real edge in the twin (within 0.2 m).
- [x] Restarting the sim (new boot id) returns the frame to UNREGISTERED.
- [x] Vitest covers the transform, the gate and invalidation; pytest covers the sim's
      boot-origin odometry.

## Test Strategy

Vitest for `frame-registration.ts`, `place-frame.ts` and the state wiring; a pytest
for `sim_node` boot-origin maths; then the MuJoCo run above with the seeded Demo
Warehouse twin.
