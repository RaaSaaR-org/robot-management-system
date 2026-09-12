---
id: "TASK-301"
aliases: []
title: "Delete a digital twin without orphaning its scans and blobs"
slug: "delete-a-digital-twin-without-orphaning-its-scans-and-blobs"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, server, compliance]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Delete a digital twin without orphaning its scans and blobs

## Description

Deleting a digital twin removes one row and leaves everything it owned behind: sensor scans with a dangling session id, their point-cloud blobs in the bucket, and the twin's sim scene and model artifact. Once the row is gone there is no index left to enumerate those objects by, which defeats the erasure guarantee the GDPR portal promises. Every part of a correct cascade already exists and is unused; this task wires them behind the delete route and adds the first test that ever deletes a twin.

## Details

### Current state

`DELETE /api/digital-twins/:id` (`server/src/routes/twin.routes.ts:253-262`) calls `digitalTwinRepository.delete(req.params.id)` at `:255`. The bare `prisma.digitalTwin.delete()` is `server/src/repositories/DigitalTwinRepository.ts:92-99`, **inside a bare catch that swallows every error and returns false** — so a partial failure is indistinguishable from a missing twin.

This is user-reachable from a shipped button, not a latent endpoint — and from **two** of them. Both call `removeTwin` (`app/src/features/digitaltwin/store/twinStore.ts:62`) → `twinApi.deleteTwin` (`app/src/features/digitaltwin/api/twinApi.ts:81`):

- `app/src/features/digitaltwin/components/SitesGallery.tsx:113` (store hook at `:66`)
- `app/src/features/digitaltwin/pages/TwinViewerPage.tsx:192` (store hook at `:76`)

Note the first path: the parallel navigation session renamed `pages/SitesGalleryPage.tsx` → `components/SitesGallery.tsx` when it folded digital twin into Fleet (commit `2712f07b`, TASK-276). Verify both line numbers against your branch before quoting them — the rename was a 71 % match, so the surrounding code moved. The delete path itself survived the fold intact.

What survives the delete:

- `ScanSession` rows cascade (`server/prisma/schema.prisma:223`), but **`SensorScan.sessionId` is a plain FK with no Prisma relation** (`server/prisma/schema.prisma:96`). So scan rows survive with a dangling session id while their PCD blobs stay in the bucket.
- The twin's model artifact stays: `modelStorage.deleteTwinArtifact` (`server/src/storage/model-storage.ts:593`) has **one caller repo-wide and it is a test**.
- The twin's sim scene stays: `SimSceneRepository.deleteByTwinId` (`:184`) has **no caller at all**.

Every part of a correct cascade already exists, unused: `SensorScanService.deleteScan` (`server/src/services/SensorScanService.ts:222-243`) deletes blob + row, and `pruneSessionFrames` (`:253-267`) does the same for a session's frames.

**The one genuinely missing piece is an enumerate-scans-by-twin path.** `SensorScanRepository` has `listBySession` (`:152`) but no `listByTwin`; `ScanSessionRepository` has no `listByTwin` either. Without one there is no way to reach a twin's scans once its sessions are gone — which is why deletion order matters.

Worse in the case users actually hit: `failJob` (`server/src/services/DigitalTwinService.ts:306-333`) never prunes frames — frames are pruned only on a *successful* build (`:286-296`). So deleting a **failed** build, the natural user reaction, strands the full raw sweep.

The data at stake is merged point clouds of customers' buildings and raw LiDAR sweeps.

### Server

1. **Add the enumeration path.** `SensorScanRepository.listByTwin(twinId)` — or `ScanSessionRepository.listByTwin(twinId)` feeding the existing `listBySession` (`:152`); pick whichever matches the existing query shapes in those files and say so in the PR body.
2. **Add a service method that owns the cascade**, on `DigitalTwinService` (the service already owns `complete`/`fail`/`reap` lifecycle, so deletion belongs beside them). In order, inside one path that does not swallow errors:
   - enumerate the twin's scans and delete each blob + row via the existing `SensorScanService.deleteScan` (`:222-243`) / `pruneSessionFrames` (`:253-267`);
   - `SimSceneRepository.deleteByTwinId(twinId)` (`:184`);
   - `modelStorage.deleteTwinArtifact(...)` (`server/src/storage/model-storage.ts:593`);
   - then the `DigitalTwin` row, letting `ScanSession` cascade (`server/prisma/schema.prisma:223`).
3. **Point the route at it.** `server/src/routes/twin.routes.ts:255` calls the new service method instead of `digitalTwinRepository.delete`. Replace the swallowing catch at `DigitalTwinRepository.ts:92-99` with one that surfaces the failure, so a half-finished cascade cannot report success.
4. **Cover the failed-build case.** Deleting a twin whose build failed must prune its frames too — `failJob` (`DigitalTwinService.ts:306-333`) leaves them, so the delete path cannot assume they are already gone.

No app change is needed: the delete button and store already exist and call the same route.

**Key files:**
- `server/src/routes/twin.routes.ts` — `DELETE :253-262` calls the new cascade method at `:255`
- `server/src/services/DigitalTwinService.ts` — new cascade method beside `complete`/`fail`/`reap`; note `failJob` at `:306-333` never prunes
- `server/src/repositories/DigitalTwinRepository.ts` — `delete` at `:92-99`; stop swallowing errors in the bare catch
- `server/src/repositories/SensorScanRepository.ts` — add `listByTwin`; `listBySession` at `:152` is the shape to follow
- `server/src/repositories/ScanSessionRepository.ts` — alternative home for `listByTwin`
- `server/src/services/SensorScanService.ts` — reuse `deleteScan` (`:222-243`) and `pruneSessionFrames` (`:253-267`)
- `server/src/repositories/SimSceneRepository.ts` — `deleteByTwinId` at `:184`, currently uncalled
- `server/src/storage/model-storage.ts` — `deleteTwinArtifact` at `:593`, currently called only by its own test
- `server/prisma/schema.prisma` — `SensorScan.sessionId` plain FK at `:96`; `ScanSession` cascade at `:223` (read only; no migration expected)
- `server/src/services/__tests__/DigitalTwinService.test.ts` — add the first deletion test

## Acceptance Criteria

- [ ] Deleting a digital twin removes its `ScanSession` rows, every `SensorScan` row belonging to those sessions, each of those scans' PCD blobs, its `SimScene` row, and its model artifact — asserted by a test, not by inspection.
- [ ] Deleting a twin whose build **failed** also removes its raw frames, covering the case `failJob` (`DigitalTwinService.ts:306-333`) leaves behind.
- [ ] `SensorScanRepository` (or `ScanSessionRepository`) exposes a `listByTwin` path, and it is the one the cascade uses to reach scans before their sessions are deleted.
- [ ] A failure part-way through the cascade surfaces as a failed request; `DigitalTwinRepository.delete` no longer returns `false` from a bare catch that hides the reason.
- [ ] `modelStorage.deleteTwinArtifact` and `SimSceneRepository.deleteByTwinId` each have a production caller — `grep -rn "deleteTwinArtifact\|deleteByTwinId" server/src --include=*.ts` shows a non-test call site for both.
- [ ] `cd server && npm run typecheck && npx vitest run` passes.
- [ ] No new file under `server/prisma/migrations/` unless a relation is deliberately added, in which case the PR body says why.

## Test Strategy

**There is no test that mocks this seam, because there is no test of it at all** — state that plainly rather than claiming a replaced mock:

- `server/src/__tests__/` has **no digital-twin route test** (only `sensorscan-routes.test.ts`).
- `server/src/services/__tests__/DigitalTwinService.test.ts` covers `complete`, `fail` and `reap`, and mocks the repositories and `SensorScanService` at `:11-48` — it never touches deletion.
- The single repo-wide caller of `modelStorage.deleteTwinArtifact` is `server/src/storage/__tests__/model-storage.test.ts:701-705`.

**The first test that deletes a twin is this task's proof.** Add to `server/src/services/__tests__/DigitalTwinService.test.ts` a case that deletes a twin with a **failed** session and asserts the scans, their blobs, and the `SimScene` row are all gone — the failed-session variant, because that is the path `failJob` leaves dirty and the one a user hits first. Follow the existing mocking style in that file (`:11-48`) for the repositories and `SensorScanService`, then add a second case asserting that a rejection from the blob delete propagates instead of being swallowed.

A route-level test in `server/src/__tests__/` asserting `DELETE /api/digital-twins/:id` reports a failed cascade as a failure — rather than the current unconditional success — is worth adding alongside it; there is no existing twin route test to extend, so it is a new file.

## Notes

This task was carved out of the ship-or-delete spike (TASK-302) deliberately. That spike's own terms forbid it from changing code, and this is a live data-orphaning defect reachable from a shipped button — deferring it behind another planning round would have left it covered on paper only.

The parallel navigation session's TASK-276 — folding digital twin into Fleet as a Sites tab — **has already landed** (`2712f07b`). Checked: that commit touched **no** file under `server/`, so this task's scope is unaffected by it. What it did change is the app-side entry point, which is why the delete call sites above are cited at their post-rename paths. **This task is server-side only and needs no app change.** Do not touch `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*` or `app/src/components/docs/DocsSidebar.tsx` — that session is still working in them.

Deletion order matters and is the main thing to get right: scans must be enumerated **before** their `ScanSession` rows cascade away, or the index needed to find them is gone. That ordering constraint is the reason `listByTwin` exists at all.

Tenant scoping of these same models is TASK-281's separate allowlist slice — do not fold it in here.
