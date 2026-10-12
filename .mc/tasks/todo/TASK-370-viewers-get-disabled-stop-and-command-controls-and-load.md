---
id: "TASK-370"
aliases: []
title: "Viewers get disabled stop and command controls, and Load sample is reachable again"
slug: "viewers-get-disabled-stop-and-command-controls-and-load"
status: "review"
priority: 2
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
created: "2026-10-12"
updated: "2026-10-12"
---

# Viewers get disabled stop and command controls, and Load sample is reachable again

## Description

Two app findings from the k3d tenant test with auth on. (1) A `viewer` sees an
enabled **Stop fleet** button and gets a 403 when pressing it; the same holds for
other command controls on the dashboard and fleet pages. (2) `docs/multi-tenancy.md`
promises a **Load sample (Acme Robotics)** button on Organizations that never appears.

## Details

### Current state

- The server admits writes to member and above: `writeRoleGuard` in
  `server/src/middleware/auth.middleware.ts`. The exception is the halt class
  (`SAFETY_HALT_WRITES`, TASK-282/284): `POST /api/safety/fleet/estop` and an
  `emergency_stop` body on `POST /api/robots/:id/command` are granted to a viewer,
  because a read-only operator who sees a hazard must be able to stop it. The
  per-robot and zone stops under `/api/safety` and every resume stay member-only.
  The client mirror of that is the `robots:command` permission
  (`app/src/features/auth/types/auth.types.ts` — owner/super-admin/member hold it,
  viewer does not), already used by the robot detail panel through
  `usePermission('robots:command')` (`app/src/features/auth/hooks/useAuth.ts`).
- `FleetEmergencyStopButton`, `RobotEmergencyStopButton`, `ZoneEmergencyStopButton`
  (`app/src/features/safety/components/`), the site map's click-to-stop zones
  (`app/src/features/fleet/components/SiteMap.tsx`), the dashboard's "Command a robot"
  panel (`app/src/features/dashboard/components/CommandPanel.tsx`) and the Fleet ›
  Sites "New scan" buttons (`app/src/features/fleet/pages/FleetPage.tsx`,
  `app/src/features/digitaltwin/components/SitesGallery.tsx`) checked no permission.
- Organizations: the original TASK-155 UI showed the sample offer while only the
  Default tenant existed (`customerCount === 0`). The redesign in #313 (691af429)
  moved it into the DataTable's empty state, which renders only for an empty list —
  and the Default tenant is always listed, so the button became unreachable. A
  regression, not an intentional removal. The docs also still described the old
  sidebar "Admin › Organizations" entry; since #317 the link lives in the TopBar
  organization pill's menu (super-admin only).

### Frontend

- `stopStyles.ts` gains `useCanStop()` (= `robots:command`), `STOP_FORBIDDEN_HINT`
  and `RESUME_FORBIDDEN_HINT`. **Stop fleet stays enabled for every role**, viewer
  included (it is a halt the server grants them); only Resume fleet is gated.
  Stop robot / Stop zone and Resume robot are disabled for a viewer, with the
  reason on the button itself. Member, owner and super-admin keep every stop enabled.
- Site map: zones are not clickable for a viewer, with the same hint under the map.
- CommandPanel: a viewer gets a "View only" note instead of the command bar.
- New scan (header and gallery empty state): disabled for a viewer.
- OrganizationsPage: a banner offers **Load sample (Acme Robotics)** while the list
  holds only the Default organization; it opens the create form prefilled.

### Docs

- `docs/multi-tenancy.md`: where Organizations is found (TopBar pill menu), the
  button labels, and that the sample prefills the form (it does not auto-submit).

## Acceptance Criteria

- [x] Stop fleet is enabled and fires for every role, viewer included (TASK-284's AC)
- [x] A viewer sees Stop robot / Stop zone and every Resume disabled with a reason; member, owner and super-admin see them enabled
- [x] Site-map zone stop, dashboard command bar and New scan are not offered to a viewer
- [x] Load sample (Acme Robotics) is reachable for a super-admin while only the Default organization exists, and prefills Acme Robotics / acme
- [x] Docs describe how to reach Organizations and the sample as they are
- [x] Vitest covers each role gate and the sample offer

## Test Strategy

Vitest: `EmergencyStopButtons.roles.test.tsx`, `CommandPanel.roles.test.tsx`,
`OrganizationsPage.sample.test.tsx`, viewer cases in `SiteMap.test.tsx`,
`FleetPage.test.tsx` and `SitesGallery.test.tsx`. Full app vitest + `tsc` +
`e2e/demo-smoke.spec.ts` (PLAYWRIGHT_PORT=4187).

## Notes

Decisions from review (PR #393):

- **The k3d 403 on Stop fleet was not the role guard.** `writeRoleGuard` exempts
  `POST /api/safety/fleet/estop` for a viewer, and
  `server/src/__tests__/write-route-authorization.test.ts` proves it returns 200.
  Disabling the button would have been a safety regression, so it was reverted.
  The 403's real source (a stale image without the TASK-284 exemption, a path
  prefix in `originalUrl` that misses the `^/api/safety` anchor, or another
  route) is not found here and needs its own task, reproduced on k3d.
- **Zone stop stays member-only for now.** `SAFETY_HALT_WRITES` says to add the
  zone route "alongside a UI that needs it", and the TASK-331 site map is such a
  UI, so granting viewers `POST /api/safety/zones/:id/estop` is the likely next
  step. It widens server authorization, so it is left to a follow-up task rather
  than this UI fix; until then the zone stop is disabled for a viewer, matching
  today's server, and the hint points them at Stop fleet.

Out of scope, left as-is: deleting a site from the Sites gallery is still offered to a
viewer (a management action, not a command).
