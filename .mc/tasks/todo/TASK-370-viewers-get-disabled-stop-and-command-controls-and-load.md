---
id: "TASK-370"
aliases: []
title: "Viewers get disabled stop and command controls, and Load sample is reachable again"
slug: "viewers-get-disabled-stop-and-command-controls-and-load"
status: "in-progress"
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

- The server admits every write (incl. all `/api/safety/*/estop` routes) to
  member and above only: `writeRoleGuard` in `server/src/middleware/auth.middleware.ts`.
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

- `stopStyles.ts` gains `useCanStop()` (= `robots:command`) and `STOP_FORBIDDEN_HINT`;
  all three E-stop buttons disable stop and resume for a role without it and say why.
  Operators (member), owners and super-admins keep the stop enabled at all times.
- Site map: zones are not clickable for a viewer, with the same hint under the map.
- CommandPanel: a viewer gets a "View only" note instead of the command bar.
- New scan (header and gallery empty state): disabled for a viewer.
- OrganizationsPage: a banner offers **Load sample (Acme Robotics)** while the list
  holds only the Default organization; it opens the create form prefilled.

### Docs

- `docs/multi-tenancy.md`: where Organizations is found (TopBar pill menu), the
  button labels, and that the sample prefills the form (it does not auto-submit).

## Acceptance Criteria

- [ ] A viewer sees Stop fleet / Stop robot / Stop zone (and Resume) disabled with a reason; member, owner and super-admin see them enabled
- [ ] Site-map zone stop, dashboard command bar and New scan are not offered to a viewer
- [ ] Load sample (Acme Robotics) is reachable for a super-admin while only the Default organization exists, and prefills Acme Robotics / acme
- [ ] Docs describe how to reach Organizations and the sample as they are
- [ ] Vitest covers each role gate and the sample offer

## Test Strategy

Vitest: `EmergencyStopButtons.roles.test.tsx`, `CommandPanel.roles.test.tsx`,
`OrganizationsPage.sample.test.tsx`, viewer cases in `SiteMap.test.tsx`,
`FleetPage.test.tsx` and `SitesGallery.test.tsx`. Full app vitest + `tsc` +
`e2e/demo-smoke.spec.ts` (PLAYWRIGHT_PORT=4187).

## Notes

Out of scope, left as-is: deleting a site from the Sites gallery is still offered to a
viewer (a management action, not a command).
