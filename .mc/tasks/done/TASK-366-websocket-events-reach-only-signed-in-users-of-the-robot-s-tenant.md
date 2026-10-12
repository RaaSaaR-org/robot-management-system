---
id: "TASK-366"
aliases: ["TASK-366"]
title: "WebSocket events reach only signed-in users of the robot's tenant"
slug: "websocket-events-reach-only-signed-in-users-of-the-robot-s"
status: "done"
priority: 1
owner: "claude"
projects: []
customers: []
tags: ["core", "multi-tenancy", "security"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# WebSocket events reach only signed-in users of the robot's tenant

## Description

The server's event stream (`/api/a2a/ws`) sent every event to every open
socket, signed in or not. With auth on, an anonymous WebSocket reads the whole
platform's live fleet. With multi-tenancy on, one tenant's dashboard receives
another tenant's telemetry.

## Details

**Current state**

- `server/src/websocket/index.ts` `broadcast()` writes each event (robot
  telemetry, registrations, robot tasks, alerts, datasets, training, agent
  mode, ...) to every socket in `clients`. Only control-lease transitions
  (TASK-318) are filtered by identity and tenant.
- A socket gets an identity from `?token=` on the upgrade URL or an in-band
  `{type:'auth', token}` frame (`socketIdentity.ts`). In the app only
  `useControlLease` sends that frame; every other hook opens an anonymous socket.
- Measured on k3d (production chart, auth on, `MULTI_TENANCY_ENABLED=true`):
  a bare `new WebSocket('ws://…/api/a2a/ws')` with no token received
  `robot_registered`, 7 `robot_telemetry` and 128 `robot_telemetry_fast` frames
  in 15 s from tenant A's robot.

**Server**

- `server/src/websocket/eventFanout.ts` (new): `deliverEvent` sends only to
  identified sockets; when the event names a robot, it also requires
  `mayObserveTenant(identity, robotTenant)`. `RobotTenantResolver` caches
  robot id → tenant (looked up with `runAsPlatform`), forgets on
  (un)registration, and does not cache a failed lookup. A robot whose tenant
  cannot be read goes to super-admins only.
- `index.ts`: robot, robot-task, work assigned/cancelled, sensor-scan,
  agent-mode and deployment events are robot-scoped; every other event goes to
  identified sockets. Multi-tenancy off: robot events skip the tenant lookup.
- `AUTH_DISABLED=true` identifies every socket as the dev super-admin at
  upgrade, so local dev is unchanged.

**Frontend**

- `app/src/shared/utils/websocket.ts` `openServerSocket(url)` opens the socket
  and sends the access token in-band as its first frame (never in the URL).
  All eleven hooks that opened `new WebSocket(getWebSocketUrl())` use it.

**Key files**

- `server/src/websocket/eventFanout.ts`, `server/src/websocket/index.ts`
- `server/src/websocket/__tests__/eventFanout.test.ts`, `index.test.ts`
- `app/src/shared/utils/websocket.ts` and the hooks under `app/src/features/*/hooks/`

## Acceptance Criteria

- [x] With auth on, a socket that never authenticated receives no event.
- [x] A robot's events reach identified sockets of the robot's tenant and
      super-admins only.
- [x] The app's sockets authenticate in-band, and the dashboard stays live.
- [x] `AUTH_DISABLED=true` behaves as before.

## Test Strategy

- Unit: `eventFanout.test.ts` (routing rules, resolver caching) and two
  auth-on cases in `index.test.ts`.
- k3d, four sockets while tenant A's robot streams: anonymous got only
  `connected`, tenant B got `connected` + `auth` and no robot events, tenant A
  and the super-admin each got 118 `robot_telemetry_fast` + 6 `robot_telemetry`.
  In the browser, the demo owner's dashboard sends the auth frame first and
  receives telemetry, with no console errors.

## Notes

- Non-robot events (alerts, incidents, datasets, training jobs, processes,
  twins, teleop sessions, e-stop) now require a signed-in socket but are not
  yet routed by tenant. Their payloads carry no robot id; scoping them needs
  the tenant on each event. Follow-up.
