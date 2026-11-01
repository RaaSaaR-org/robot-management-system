---
id: "TASK-474"
aliases: []
title: "The apple configs' ego_view gets the calibrated ego_camera"
slug: "the-apple-configs-ego-view-gets-the-calibrated-ego-camera"
status: "todo"
priority: 3
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 1
effort: "low"
due_date: ""
created: "2026-11-01"
updated: "2026-11-01"
---

# The apple configs' ego_view gets the calibrated ego_camera

## Description

A VLA policy whose config asks for `ego_view` (the apple GR00T, pi05, lingbot and unifolm
configs) is fed the sim's `head_camera` when it runs on a robot, not the scene's
`ego_camera`. The apple scene has an `ego_camera` posed by PnP against the dataset, and
the offline sim evaluator already feeds that one as `ego_view`. On the robot path, the
policy sees a different view from the one it was trained and evaluated on.

## Details

**Current state.** `robot-agent/src/recording/camera-map.ts` `sceneCameraForPolicyKey`
looks a policy camera up by name only when it is one of the Unitree view keys
(`POLICY_VIEW_KEYS`, the values of `DEFAULT_CAMERA_KEYS`: `cam_right_high`,
`cam_left_high`, `cam_left_wrist`, `cam_right_wrist`). Every other name, `ego_view`
included, falls back to the head camera. TASK-449 kept that on purpose, because its AC6
required one-camera configs to behave exactly as before.
`robot-agent/src/vla/skill-executor.ts` `captureHardware` calls it through
`policyCameraSources`.

**Evidence.**
- `robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase_realism.xml` defines
  `ego_camera` (fovy 44). The head camera has fovy 89 and is yawed toward the old crate
  scene.
- `robot-agent/hardware/sim_evaluator/envs/g1_apple_env.py` (~:17-18, :393) renders
  `ego_camera` as the policy's `ego_view`.
- The sim sidecar lists `[head_camera, ego_camera]` for the apple scene.

### Robot Agent

- In `sceneCameraForPolicyKey`, map the policy key `ego_view` to `ego_camera` when the
  sidecar lists it, and to the head camera otherwise. Keep it to one explicit entry (a
  small `POLICY_ALIASES` record next to `POLICY_VIEW_KEYS`), not a general rename.
- Update the doc comment above `POLICY_VIEW_KEYS`, which points at this task.
- Update the TASK-449 test at `robot-agent/src/vla/__tests__/skill-executor.test.ts`
  (~:2236, "one-camera configs behave as before"), which currently pins `ego_view` to the
  head camera.

**Key files**
- `robot-agent/src/recording/camera-map.ts`
- `robot-agent/src/recording/__tests__/camera-map.test.ts`
- `robot-agent/src/vla/__tests__/skill-executor.test.ts`

## Acceptance Criteria

- [ ] With the sidecar listing `ego_camera`, an `ego_view` policy camera gets `ego_camera`.
- [ ] Without `ego_camera` listed, `ego_view` gets the head camera, as today.
- [ ] Every other policy key resolves exactly as it does after TASK-449.

## Test Strategy

- Vitest: `cd robot-agent && npx vitest run src/recording src/vla`, with cases for
  `ego_view` with and without `ego_camera` listed, and in both list orders.
- `npm run typecheck` in `robot-agent/`.

## Notes

- Found in the review of PR #468 (TASK-449) on 2026-11-01.
