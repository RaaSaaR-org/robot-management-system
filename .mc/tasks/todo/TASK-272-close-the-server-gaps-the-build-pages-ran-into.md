---
id: "TASK-272"
aliases: []
title: "Close the server gaps the Build pages ran into"
slug: "close-the-server-gaps-the-build-pages-ran-into"
status: "todo"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-11"
updated: "2026-09-11"
---

# Close the server gaps the Build pages ran into

## Description

TASK-266 rebuilt the deployments, model registry, fleet learning, marketplace and secure-updates pages, and clicked every flow through against a live server. One flow fails on a server bug, and several acts the pages should offer have no server route, so the UI hides them for now. This task fixes the bug and adds the missing routes, so the pages can offer the full create/edit/delete set.

## Details

### Current state (found 2026-09-11)

- **Update rollback fails.** Rolling back an update package from `/updates` fails with a foreign-key error in `UpdateService.triggerRollback` (`server/src/services/`). The UI shows the error in the rollback form.
- **Fleet-learning rounds cannot be cancelled.** There is no cancel route. There was also no `/start` route: the client now selects participants and then distributes (TASK-266).
- **No delete routes** exist for update packages, fleet-learning rounds, deployments or model versions. Marketplace listings can be neither unpublished nor deleted.
- **A cancelled deployment** is stored with status `failed`.
- **`fetchModelVersions`** (app store) swallows errors, so `/models` cannot show an error state with Retry.

### Server

1. Fix the foreign key in `UpdateService.triggerRollback` and cover it with a service test.
2. Add `POST /fleet-learning/rounds/:id/cancel`, allowed while a round is not finished.
3. Add delete (or archive, where history must be kept for the audit trail) routes for update packages, rounds, deployments and model versions, plus unpublish for marketplace listings. Record every delete in the compliance log the same way creates are recorded.
4. Store a cancelled deployment as `cancelled`, and add it to the status enum and the Prisma schema if one exists.

### Frontend

5. Offer the new acts on the pages. Each destructive act goes through `confirm()` with the consequence spelled out and ends in a toast, per `docs/brand.md` §4.
6. Make `fetchModelVersions` surface errors to the page's ErrorState.

**Key files:**
- `server/src/services/UpdateService.ts`
- `server/src/routes/{update,fleetlearning,deployment,model,marketplace}*.routes.ts`
- `server/prisma/schema.prisma`
- `app/src/features/{updates,fleetlearning,deployment,contributions}`

## Acceptance Criteria

- [ ] Rolling back an update package succeeds in live mode.
- [ ] A round can be cancelled, and every entity above can be deleted, archived or unpublished from its page, through a confirm and a toast.
- [ ] A cancelled deployment reads as cancelled.

## Test Strategy

- Server route and service tests.
- `npx tsc`, `npx vitest run` and `npx playwright test`.
- Click each new act through in live mode.
