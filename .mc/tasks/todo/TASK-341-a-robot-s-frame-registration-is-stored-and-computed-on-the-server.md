---
id: "TASK-341"
aliases: []
title: "A robot's frame registration is stored and computed on the server"
slug: "a-robot-s-frame-registration-is-stored-and-computed-on-the-server"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: "[[TASK-325]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# A robot's frame registration is stored and computed on the server

## Description

Store, per robot, the SE(2) transform from its odometry frame into its site twin's
world frame, and let an operator create it by standing the robot on a known place
(place anchor) or by typing it (manual). This is the server half of TASK-325; the
robot agent consumes it in TASK-342 and the app drives it in TASK-343.

## Details

### Current state

- `Robot.twinId` binds a robot to a site twin (TASK-327); `GET /api/robots/:id/places`
  serves that twin's place graph (`server/src/routes/robot.routes.ts`,
  `TwinPlaceGraphService.exportPlaceGraph`). Places are polygons in the twin frame.
- The server holds each connected robot's live pose in `robotManager`'s cache:
  `robot.location.x/y/heading` (heading in degrees) plus `location.frame`
  (`{kind:'sim'|'odom', id}`; for `odom` the id is the sidecar's boot id, which
  changes whenever odometry re-zeroes). Nothing stores a registration.

### Server

- Prisma model `RobotFrameRegistration` (one per robot, `robotId @unique`, cascade
  on robot delete): `twinId`, `odomFrameId` (the odometry frame id it was measured
  in), `x`, `y`, `yawDeg`, `method` (`manual | place-anchor`), `anchorPlaceId?`,
  `tenantId?`, `createdAt`. Migration beside the TASK-327 one.
- Transform convention: `twin = Rot(yawDeg) · odom + (x, y)`, yaw CCW, degrees.
- `server/src/services/FrameRegistrationService.ts` — pure SE(2) helpers
  (`composeAnchorRegistration(odomPose, twinPose)`, `applyRegistration`), and the
  service: `get`, `setManual`, `setFromPlaceAnchor`, `clear`, currentness.
- Routes in `robot.routes.ts`:
  - `GET /api/robots/:id/frame-registration` → 200 registration +
    `current: boolean`, `staleReason: string | null`; 404 `{error:'no frame registration'}`.
    `current` = same twin as `Robot.twinId` AND the robot's live frame is
    `{kind:'odom', id: odomFrameId}`.
  - `PUT` body `{method:'place-anchor', placeId, headingDeg}` — the robot stands at
    the centroid of place `placeId` of its site, facing `headingDeg` (twin frame);
    the transform is computed from its live odometry pose. Or
    `{method:'manual', x, y, yawDeg}`. Both need a connected robot with a site and a
    live `odom` frame (409 otherwise; 409 too for a `sim` frame, which is already
    in the twin frame); unknown place 404; bad numbers 400.
  - `DELETE` → 204, 404 when none.
- `robotManager.setRobotSite` deletes the registration when the site changes.

### Key files

- `server/prisma/schema.prisma`, `server/prisma/migrations/<ts>_task_341_robot_frame_registration/`
- `server/src/services/FrameRegistrationService.ts` (new), `server/src/routes/robot.routes.ts`,
  `server/src/services/RobotManager.ts`
- tests under `server/src/services/__tests__/` and `server/src/__tests__/`

## Acceptance Criteria

- [ ] PUT place-anchor with the robot's odom pose (1, 0, 0°) on a place centred at
      (3, 2) facing 90° stores a transform that maps (1, 0) → (3, 2) and heading 0° → 90°.
- [ ] GET reports `current: false` with a reason once the robot's live odom frame id
      differs from `odomFrameId`, or its site changed; changing the site deletes it.
- [ ] The 400/404/409 cases above are answered as specified; DELETE removes it.
- [ ] Unit tests cover the SE(2) math (round trip, yaw wrap) and the routes.

## Test Strategy

Vitest: pure transform tests; route tests in the style of
`server/src/__tests__/twin-routes.test.ts` with a mocked robot manager and repository.
