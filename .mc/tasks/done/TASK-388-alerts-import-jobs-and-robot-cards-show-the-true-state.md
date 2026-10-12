---
id: "TASK-388"
aliases: []
title: "Alerts, import jobs and robot cards show the true state"
slug: "alerts-import-jobs-and-robot-cards-show-the-true-state"
status: done
priority: 3                   # 1=critical, 2=high, 3=medium, 4=low
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "low"
due_date: ""
created: "2026-10-13"
updated: 2026-10-13
---

# Alerts, import jobs and robot cards show the true state

## Description
A UI walk-through found four places where the app shows a state that is not true:
ghost dataset-import jobs never go away, identical alerts stack in the banner so
Dismiss looks dead, an offline robot shows its last task as "Running now", and the
Skill (VLA) panel ships a hard-coded lab LAN IP and stays usable on offline robots.

## Details

### Current state
- `apiClient` (`app/src/api/client.ts`) rejects with `ApiRequestError`, which carries
  `statusCode` and no `response`. Three callers still read
  `error.response?.status`, which is always `undefined`:
  `app/src/features/training/store/importJobsStore.ts` (backfill + reconcile),
  `app/src/features/robots/api/robotsApi.ts` (`isNotFound`, used by
  `getFrameRegistration` / `getSitePlaces`) and
  `app/src/features/command/api/commandApi.ts`. So a 404 is never recognised:
  ghost import jobs stay as FAILED with a Retry that also 404s.
- `server/src/services/SafetyService.ts` creates a new "E-Stop Reset" info alert on
  every reset, with no dedup. `app/src/features/alerts/components/AlertBanner.tsx`
  shows one alert at a time and dismisses only that id, with no count.
- `app/src/features/robots/components/RobotQuickStats.tsx` hints "Running now" for
  any `currentTaskName`, ignoring `robot.status`; the fleet grid card says
  "Task: ..." for offline robots too.
- `app/src/features/robots/components/VlaControlSection.tsx` defaults the VLA URL to
  a private LAN IP, never checks robot status, and `useVlaStatus` polls every 3 s
  unconditionally.

### Frontend
- Use `getErrorStatus` / `isNotFoundError` from `app/src/shared/utils/error.ts` in
  the three callers.
- Banner groups unacknowledged alerts by `title` + `sourceId`, shows `×N`, and
  Dismiss acknowledges the whole group.
- Quick stats and fleet card: offline robot shows the task as last known, not running.
- VLA panel: URL defaults to `VITE_VLA_SERVER_URL` or empty; Start skill disabled with
  "Robot must be online" on an offline robot; `useVlaStatus` takes an `enabled` flag
  and does not poll while offline.

### Server
- On E-Stop reset, acknowledge the earlier unacknowledged "E-Stop Reset" alerts for the
  same robot before creating the new one, so at most one stays active.

## Acceptance Criteria
- [x] An `ApiRequestError` with `statusCode: 404` drops the job in `reconcile()` and marks it "The dataset no longer exists" in `backfill()`.
- [x] `getFrameRegistration` returns `null` and `getSitePlaces` returns `[]` on a 404 `ApiRequestError`.
- [x] Repeated E-Stop resets of one robot leave one unacknowledged reset alert.
- [x] The banner shows `×N` for N identical alerts and one Dismiss clears them all.
- [x] An offline robot's current-task tile does not say "Running now"; the fleet card marks the task as last known.
- [x] No private LAN IP in the VLA panel; Start skill is disabled and polling stops while the robot is offline.
- [x] Typecheck and vitest pass for app and server.

## Test Strategy
Vitest: importJobsStore with a mocked `trainingApi` rejecting `ApiRequestError(404)`;
robotsApi 404 helpers; AlertBanner grouping; RobotQuickStats offline; VlaControlSection
offline; SafetyService reset dedup.

## Notes
- Server: `AlertService.replaceAlert` acknowledges still-active alerts with the same
  source, sourceId and title (`acknowledgedBy: system:superseded`) before creating the
  new one; the E-Stop reset path uses it. Existing stacked rows are handled by the
  banner grouping, so no data backfill is needed.
- VLA URL: `VITE_VLA_SERVER_URL`, else the viewer's last-used URL (localStorage), else
  empty; Start refuses an empty URL with a field error.
