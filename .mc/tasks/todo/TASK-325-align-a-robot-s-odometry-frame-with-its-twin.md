---
id: "TASK-325"
aliases: []
title: "Align a robot's odometry frame with its twin"
slug: "align-a-robot-s-odometry-frame-with-its-twin"
status: "backlog"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, robot-agent, server]
sprint: ""
parent: ""
depends_on: ["[[TASK-274]]"]
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Align a robot's odometry frame with its twin

## Description

Give a robot bound to a digital twin a frame registration — the transform from its
odometry frame into the twin's world frame — so zone membership, named places and
keepout fences work for robots whose odometry origin is not the twin origin. Today
only a sim robot whose world origin *is* the twin origin gets them (TASK-274); every
other twin-bound robot is "not aligned — fence not enforcing". Decided in the
TASK-274 grill: `docs/records/TASK-274-two-zone-systems-describe-the-same-idea.md` (Q2).

## Details

### Current state

- `robot-agent/src/agent-mode/place-frame.ts:65-90` — `assessFrameRegistration`
  returns `registered: false` for any place graph whose frame has a `twinId`, or whose
  `kind` is not `'sim'`. Only `kind: 'sim'` with no `twinId` is `registered: true,
  how: 'identity'`. An unregistered graph makes the geofence (`agent-mode/geofence.ts`,
  `SafetyMonitor.updateGeofence`, `robot/state.ts` place/geofence paths) answer UNKNOWN.
- The twin's world frame origin is `ScanSession.originX/Y` — the robot's pose at scan
  start (`server/prisma/schema.prisma:224-225`). The robot's pose comes off
  `rt/odommodestate`, whose origin is wherever the base was when the sidecar (or sim)
  last came up. The two differ by an arbitrary SE(2) offset after any restart; there is
  no `frameOffset`/`registerFrame` code anywhere.
- After TASK-274: `Robot.twinId` binds a robot to a twin; the agent fetches that
  twin's places; a sim robot declaring "pose is in the twin frame" is treated as
  registered; everything else shows the TASK-201 "not aligned" warning.

### Server

- Store a per-robot registration: `x`, `y`, `yaw` (odom → twin), `method`
  (`manual | place-anchor`), `createdAt`, invalidated when the robot/agent reports a
  new odometry incarnation (boot lineage) or `Robot.twinId` changes. Expose
  `GET/PUT/DELETE /api/robots/:id/frame-registration`.
- A registration method that works without extra hardware: **place anchor** — the
  operator puts the robot at a known place (pose in twin frame) and confirms; the
  server computes the transform from the robot's current odometry pose. Manual
  `x/y/yaw` entry as a fallback.

### Robot Agent

- Fetch the registration with the place graph; apply it to every pose before place
  membership / geofence checks (or inversely transform the graph into odometry).
- `place-frame.ts`: a twin graph is `registered: true, how: 'registration'` when a
  current registration for this robot exists; otherwise stays UNREGISTERED with the
  existing reason. Drop the registration on odometry reset / new incarnation.
- Report registration state so the app can clear the "not aligned" warning.

### Frontend

- Robots → Site: "Align" action (pick an anchor place, confirm robot is on it) and a
  status (aligned / not aligned, since when). Aligned robots get plotted on the site map.

### Key files

- `robot-agent/src/agent-mode/place-frame.ts`, `robot-agent/src/agent-mode/place-graph-source.ts`,
  `robot-agent/src/agent-mode/geofence.ts`, `robot-agent/src/robot/state.ts`
- `server/prisma/schema.prisma`, a new route/service under `server/src/routes/` and
  `server/src/services/`
- `app/src/features/robots/` (Site / Align UI), the TASK-274 site map component

## Acceptance Criteria

- [ ] MuJoCo on the Mac: boot the sim robot **offset** from the twin origin (e.g. spawn
      at twin (3, 2, 90°)) so odometry ≠ twin frame; before alignment the fence reports
      "not aligned" and does not enforce.
- [ ] Align it against a known place; `location.place` becomes correct and a move
      toward a keepout is stopped at the keepout's real edge in the twin (within 0.2 m).
- [ ] `place-frame.ts` treats a twin graph as registered only while a current
      registration exists; restarting the sim/sidecar (new odometry origin) returns it
      to UNREGISTERED.
- [ ] The site map plots an aligned robot at its true twin position.
- [ ] Unit tests cover the transform, the gate, and invalidation.
- [ ] Optional: the same check in Isaac Sim on the Linux GPU box.

## Test Strategy

Vitest for the SE(2) transform (round trip, yaw wrap), `assessFrameRegistration` with
and without a registration, invalidation on incarnation change, and the server
anchor computation. Then the MuJoCo-on-Mac run above with the seeded Demo Warehouse
twin from TASK-274; Isaac Sim on the Linux box as an optional second check.

## Children

- [[TASK-341]] server: store and compute the registration (API) — done (#365)
- [[TASK-342]] robot agent + MuJoCo sim: fence in the twin frame once registered — done (#366)
- [[TASK-343]] app: Align action, status, site map plots the twin pose — done (#367)
- [[TASK-344]] backlog: the same check in Isaac Sim on the GPU box (needs that machine)

Every required acceptance criterion is met by TASK-341..343. The epic stays open,
in `backlog`, only for the optional Isaac Sim check (TASK-344), which needs the
Linux GPU box; it closes with that child.
