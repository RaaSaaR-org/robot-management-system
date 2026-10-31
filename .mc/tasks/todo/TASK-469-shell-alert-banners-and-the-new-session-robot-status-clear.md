---
id: "TASK-469"
aliases: []
title: "Shell alert banners and the New-session robot status clear when the robot recovers"
slug: "shell-alert-banners-and-the-new-session-robot-status-clear"
status: "todo"                # backlog | todo | in-progress | review | done | cancelled
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: [core, ui]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# Shell alert banners and the New-session robot status clear when the robot recovers

## Description

In the 2026-10-31 sim rehearsal, "Robot offline: G1-EDU (supervisor sim)" stayed
on every page after the robot side was running, and covered the New-session
form; the form's robot select said Offline until a reload. After Reset E-stop
the red "Emergency Stop - <robot>" banner stayed on every page, the dataset
viewer included, until someone pressed Acknowledge. A banner that outlives its
cause teaches people to dismiss banners. This task makes the shell banner follow
the server's alerts live, resolves the E-stop alert when the latch is reset,
and makes the New-session robot select show a robot that came online.

Branch: `fix/task-469-shell-alert-banners-and-the-new-session-robot-status-clear`.

## Details

### Current state

Checked on `main` at `a600c27e`.

- Server:
  - `server/src/services/RobotManager.ts:1225-1246` and `:1270-1283`: on
    recovery and on reconnect it calls `alertService.resolveRobotStatusAlerts()`,
    which acknowledges the robot's active "Robot offline:" / "Robot error:"
    alerts (`server/src/services/AlertService.ts:53`, `:213-222`) and emits
    `alert_acknowledged`;
  - `:1294-1305`: the offline alert on connectivity loss;
  - `AlertService.sweepStaleAlerts()` (`:234-270`) does the same every 60 s;
  - `server/src/websocket/index.ts:465-479` fans every alert event out over the
    WebSocket;
  - `server/src/services/SafetyService.ts:229-237`: E-STOP creates a critical
    alert `Emergency Stop - <robot>` (source `robot`, sourceId the robot);
    `resetRobotEStop` (`:254`) resolves nothing, and the title is not in
    `ROBOT_STATUS_TITLE_PREFIXES`.
- App:
  - `app/src/components/layout/AppLayout.tsx:71` renders
    `app/src/features/alerts/components/AlertBanner.tsx`, which reads
    `useAlerts()` (`:168`);
  - `app/src/features/alerts/hooks/useAlerts.ts:146-150` fetches active alerts
    once on mount; nothing in `app/src` handles `alert_created` or
    `alert_acknowledged` (no match for either string). So a resolved alert stays
    on screen until a reload or a manual Acknowledge.
  - `app/src/features/datacollection/pages/NewSessionPage.tsx:108-120`: the
    robot list is re-read every 3 s only while the readiness snapshot of the
    selected offline robot says supervised and agent reachable. The rehearsal
    still saw Offline until a reload; why is not yet known (the server's robot
    status may lag the agent until its health check runs, or the readiness
    snapshot never reports `bringup`).

### Server

- `resetRobotEStop` resolves the robot's active `Emergency Stop - ` alerts once
  the reset succeeds (`acknowledgeAndEmit`, resolved by
  `system:estop-reset`). Fleet and zone E-stop alerts are out of scope.

### Frontend

- The alerts store listens to the server's `alert_created` and
  `alert_acknowledged` (and `alert_deleted`) events over the existing
  WebSocket connection and updates its list, so the banner appears and clears
  without a reload. Find the shared socket the app already uses for
  `robot_status_changed` (`app/src/features/robots/hooks/useRobotWebSocket.ts:116`)
  and add the alert events next to it, or refetch active alerts on those events.
- New session: find why the select stays Offline (check the readiness
  snapshot's `bringup` and the server robot status after Start robot side),
  then fix it, for example by refetching robots on the readiness snapshot's
  agent-reachable change or on `robot_status_changed`.

### Key files

- `server/src/services/SafetyService.ts`
- `server/src/services/AlertService.ts`
- `app/src/features/alerts/store/alertsStore.ts`
- `app/src/features/alerts/hooks/useAlerts.ts`
- `app/src/features/robots/hooks/useRobotWebSocket.ts` (or the shared socket)
- `app/src/features/datacollection/pages/NewSessionPage.tsx`

## Acceptance Criteria

- [ ] After Start robot side on an offline supervised robot, the "Robot
  offline" banner disappears and the robot select says Online, with no reload.
- [ ] After Reset E-stop, the robot's "Emergency Stop" banner disappears on
  every page with no click.
- [ ] A new alert still appears in the banner without a reload.
- [ ] Vitest covers the store's event handling and the E-stop alert resolution.

## Test Strategy

- Server vitest: `resetRobotEStop` acknowledges that robot's active E-stop
  alerts and emits `alert_acknowledged`; other robots' alerts stay.
- App vitest: the alerts store adds an alert on `alert_created` and removes it
  on `alert_acknowledged`; `AlertBanner` re-renders.
- On `sim-g1-edu-dev`: stop the robot side, see the offline banner, start it
  from New session, see the banner clear and the select turn Online; E-STOP,
  Reset, see the red banner clear.

## Notes

- Found in the 2026-10-31 sim rehearsal ("Stale shell banners and robot
  status").
- Workaround: check the robot really is fine (readiness checklist, systems
  strip), then press Dismiss / Acknowledge.
