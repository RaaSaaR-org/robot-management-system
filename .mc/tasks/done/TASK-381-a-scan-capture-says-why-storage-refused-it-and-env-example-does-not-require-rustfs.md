---
id: "TASK-381"
aliases: []
title: "A scan capture says why storage refused it and .env.example does not require RustFS"
slug: "a-scan-capture-says-why-storage-refused-it-and-env-example-does-not-require-rustfs"
status: "done"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core", "storage"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# A scan capture says why storage refused it and .env.example does not require RustFS

## Description

Follow-ups from the TASK-350 review (PR #404, merged). Since TASK-350, a configured RustFS is required: storage callers throw `StorageUnavailableError` (503, `code: STORAGE_UNAVAILABLE`, with RustFS `state` and `errorKind`) while it is down. Two places hide that, and the dev template turns it on by default.

## Details

**Current state**

- `server/src/routes/robot.routes.ts`, `POST /:id/pointcloud/capture`: maps a network error to 502 and "not found" to 404, and everything else to a bare `500 {error: 'Failed to capture scan'}`. `SensorScanService.persistFrame` now throws `StorageUnavailableError`, which this swallows. `incident.routes.ts` already routes its clip failures through `sendFailure` (`server/src/utils/routeErrors.ts`), which answers a storage refusal as 503 with `code`, `state`, `errorKind`.
- `server/src/routes/patrol.routes.ts` `respondError` maps any `AppError` to `{error, code}` — a storage refusal loses `state`/`errorKind`, so its 503 body differs from the `sendFailure` shape.
- `server/.env.example` ships `RUSTFS_ENDPOINT=http://localhost:9000` uncommented under an "optional" header. `isRustFSConfigured()` is `Boolean(RUSTFS_ENDPOINT)`, so a dev copying the template without RustFS running gets 503s.
- `CLAUDE.md` "Current Limitations" says RustFS is simply optional.
- `server/src/jobs/storage-cleanup.ts` skips with "RustFS configured but unavailable (state=connecting, …)" — "unavailable" reads oddly next to `state=connecting`.

### Server

- Capture route: keep the 502 and 404 arms, then `sendFailure(res, error, 'Failed to capture scan', 500)`.
- Extract the storage-refusal body fields from `sendFailure` into an exported `storageRefusalFields(error)` in `routeErrors.ts`; use it in patrol `respondError`.
- Cleanup job reason: "RustFS configured but not ready (state=…, errorKind=…)".
- `.env.example`: comment out the three RustFS lines and say that setting `RUSTFS_ENDPOINT` makes RustFS required (no local-disk fallback, 503 while down).
- `docker-compose.yml` and the Helm chart set `RUSTFS_ENDPOINT` alongside a RustFS they deploy — deployment behaviour, left unchanged.

**Key files**

- `server/src/routes/robot.routes.ts`, `server/src/routes/patrol.routes.ts`, `server/src/utils/routeErrors.ts`
- `server/src/jobs/storage-cleanup.ts` (+ its test)
- `server/.env.example`, `CLAUDE.md`
- Tests: `server/src/routes/__tests__/pointcloud-capture-storage-routes.test.ts` (new), `server/src/__tests__/incident-clip-routes.test.ts`, `server/src/__tests__/patrol-routes.test.ts`

## Acceptance Criteria

- [x] `POST /api/robots/:id/pointcloud/capture` answers 503 with `code: STORAGE_UNAVAILABLE`, `state`, `errorKind` when the service throws `StorageUnavailableError`; 201, 404, 502 and the unechoed 500 are unchanged.
- [x] Patrol routes answer a `StorageUnavailableError` with the same body fields `sendFailure` gives it.
- [x] `PUT /api/incidents/:id/clip` has a route test for the 503 shape.
- [x] `server/.env.example` leaves `RUSTFS_ENDPOINT` unset and says setting it makes RustFS required.
- [x] `CLAUDE.md` "Current Limitations" states that RustFS is optional only while `RUSTFS_ENDPOINT` is unset.
- [x] The cleanup-job skip reason says "configured but not ready".

## Test Strategy

Supertest route tests with the service mocked to throw `StorageUnavailableError`; `npm run typecheck` and the full server vitest suite.
