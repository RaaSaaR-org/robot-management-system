---
id: "TASK-343"
aliases: []
title: "Operators align a robot to its site from the Robots tab"
slug: "operators-align-a-robot-to-its-site-from-the-robots-tab"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, frontend]
sprint: ""
parent: "[[TASK-325]]"
depends_on: ["[[TASK-341]]", "[[TASK-342]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Operators align a robot to its site from the Robots tab

## Description

Give the operator an "Align" action next to a robot's Site picker — pick the place
the robot is standing on and the direction it faces, confirm — plus the alignment
status, and plot an aligned robot on the site map at its twin pose, not its raw
odometry.

## Details

### Current state

- `app/src/features/robots/components/tabs/SiteSelect.tsx` (rendered by
  `InfoTab.tsx` as the "Site" row) binds a robot to a twin via
  `robotsApi` / `robotsStore` (`PATCH /api/robots/:id {twinId}`).
- `app/src/features/fleet/components/SiteMap.tsx` `groupSiteRobots` plots robots
  with `location.siteAligned === true`, at `location.x/y/heading` (line ~201, ~217).
- TASK-341 API: `GET/PUT/DELETE /api/robots/:id/frame-registration`; GET →
  `{twinId, odomFrameId, x, y, yawDeg, method, anchorPlaceId, createdAt, current,
  staleReason}` or 404; PUT `{method:'place-anchor', placeId, headingDeg}` or
  `{method:'manual', x, y, yawDeg}`; 409 with `{error}` when the robot cannot be
  aligned (offline, no site, sim frame).
- TASK-342: the agent reports `location.siteAligned` and, when aligned,
  `location.sitePose = {x, y, heading}` in the twin frame. A sim robot whose world
  is the twin is aligned without any registration.

### Frontend

- `robots.types.ts`: `RobotLocation.sitePose?`; a `FrameRegistration` type.
- `robotsApi.ts`: `getFrameRegistration`, `putFrameRegistration`,
  `deleteFrameRegistration`.
- `features/robots/components/tabs/SiteAlignment.tsx` (new), rendered under the Site
  row when the robot has a site: status line ("Aligned since …", "Aligned — the
  sim's world is the site", "Not aligned — fence not enforcing" + stale reason),
  an "Align" dialog (place select from the site's places via
  `twinZoneApi.getZones(twinId)`, heading input in degrees, confirm), and "Clear".
  Show the server's 409 text on failure.
- `SiteMap.tsx`: plot `location.sitePose ?? {x, y, heading}`.

### Key files

- `app/src/features/robots/{types/robots.types.ts,api/robotsApi.ts}`
- `app/src/features/robots/components/tabs/{InfoTab.tsx,SiteAlignment.tsx}`
- `app/src/features/fleet/components/SiteMap.tsx`

## Acceptance Criteria

- [ ] A robot with a site shows its alignment status; "Align" with a place and heading
      calls PUT and the status turns aligned; "Clear" calls DELETE.
- [ ] The site map plots an aligned robot at `sitePose` (its true twin position).
- [ ] Vitest (Testing Library) covers the component and the SiteMap pose choice.

## Test Strategy

Vitest + Testing Library with mocked `robotsApi` / `twinZoneApi`, in the style of
`app/src/features/robots/components/tabs/__tests__/SiteSelect.test.tsx`.
