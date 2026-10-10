---
id: "TASK-348"
aliases: ["TASK-348"]
title: "/health reports storage status"
slug: "health-reports-storage-status"
status: "in-progress"
priority: 2
owner: "FlrnFrmm"
projects: []
customers: []
tags: ["core", "storage"]
sprint: ""
parent: "[[TASK-346]]"
depends_on: ["[[TASK-347]]"]
spe: 2
effort: "low"
due_date: ""
created: "2026-10-10"
updated: "2026-10-11"
---

# /health reports storage status

## Description

On Live, `/health` answered 200 while object storage was disabled, so nothing
told an operator. Add the RustFS status to the `/health` body (status stays
200) and to the storage routes' 503. (GitHub #368.)

## Details

### Current state

- `server/src/app.ts:216` — `GET /health` returns
  `{ status, timestamp, version, startedAt, uptimeSeconds, nodeVersion, environment }`.
  It is also the Helm liveness/readiness path
  (`helm/neodem/templates/server-deployment.yaml:118`), which is why it must stay 200.
- `server/src/routes/storage.routes.ts:23` — `checkStorageAvailable` returns 503
  `{ error: 'Storage not available', message: 'RustFS storage is not initialized' }`.
- TASK-347 adds `getRustFSStatus(): RustFSStatus` to `server/src/storage/rustfs-client.ts`
  (exported from `server/src/storage/index.ts`):
  `{ configured, state: 'disabled'|'connecting'|'ready'|'unavailable', errorKind?, errorDetail?, lastAttemptAt?, attempts }`.

### Server

- `/health` adds
  `dependencies: { storage: { configured, state, errorKind, lastAttemptAt, attempts } }`
  — omit `errorDetail` here (`/health` is unauthenticated); keep HTTP 200 and
  `status: 'ok'` regardless of storage.
- `checkStorageAvailable` 503 body adds `state` and `errorKind` from
  `getRustFSStatus()`, and its message distinguishes "not configured" from
  "configured but unavailable (<errorKind>), retrying".

### Docs

- `docs/api.md` — server `/health` row: document `dependencies.storage`.

### Key files

- `server/src/app.ts`
- `server/src/routes/storage.routes.ts`
- `docs/api.md`
- a test next to the existing app/route tests in `server/src/__tests__/` or `server/src/routes/__tests__/` (find one that builds `createApp()` with supertest and copy it)

## Acceptance Criteria

- [ ] With `getRustFSStatus` mocked to `unavailable`/`auth`, `GET /health` is 200 and `body.dependencies.storage` has `state: 'unavailable'`, `errorKind: 'auth'` and no `errorDetail`.
- [ ] With it `ready`, `state: 'ready'`.
- [ ] `GET /api/storage/stats` while unavailable → 503 whose body carries `state` and `errorKind`.
- [ ] `cd server && npm run typecheck` and the touched test files green.

## Test Strategy

Supertest against `createApp()` with `../storage/rustfs-client.js` mocked; one
case per state above.
