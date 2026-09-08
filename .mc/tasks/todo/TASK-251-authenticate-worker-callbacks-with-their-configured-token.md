---
id: "TASK-251"
title: "Authenticate worker callbacks with their configured token"
slug: "authenticate-worker-callbacks-with-their-configured-token"
status: "in-progress"
priority: 2
owner: "huhn511"
tags: ["core"]
created: "2026-09-08"
updated: "2026-09-08"
spe: 3
effort: "medium"
---

# Authenticate worker callbacks with their configured token

## Description

Authenticated deployments reject every external training/twin worker even when it sends the configured WORKER_API_TOKEN: regular JWT authentication runs first. Training callbacks also mount a router whose paths already include /workers underneath /api/training/workers, so the intended route is not reached there.

## Details

- `server/src/app.ts` mounts the dedicated training worker router independently of user authentication, and uses worker authentication for twin callbacks.
- `server/src/routes/training.routes.ts` separates six POST callback routes from human-facing job management and worker monitoring. Public URLs remain /api/training/workers/{claim,heartbeat,progress,complete,failed,checkpoint}.
- `server/src/middleware/workerAuth.middleware.ts` verifies the configured shared credential or delegates to normal JWT authentication when no worker credential is configured. Development bypass retains normal development identity handling.
- Existing worker middleware tests and new `server/src/__tests__/worker-auth-routing.test.ts` exercise the real application mounts and actual handlers, mocking service methods only.

## Acceptance Criteria

- [x] A configured worker token reaches both training and twin claim handlers with normal authentication enabled.
- [x] All six training callbacks resolve at their documented URLs.
- [x] Missing/invalid worker credentials are rejected; an unconfigured worker token falls back to regular JWT authentication.
- [x] Worker secrets cannot authorize human-facing management APIs; normal user worker monitoring remains accessible.
- [x] Typecheck and server tests pass.
- [ ] PR review and CI pass before merging.

## Test Strategy and Evidence

Actual-app request regressions cover routing and authentication together, including rejection and fallback paths. Server typecheck passed; full suite passed 5736 tests across 220 files with one existing skip. Robot baseline: 2335 tests passed. All DB validation used isolated /tmp/neodem-server-audit.db, leaving the developer database intact.
