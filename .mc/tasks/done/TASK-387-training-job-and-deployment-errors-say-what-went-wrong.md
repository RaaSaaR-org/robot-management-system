---
id: "TASK-387"
aliases: []
title: "Training-job and deployment errors say what went wrong"
slug: "training-job-and-deployment-errors-say-what-went-wrong"
status: "review"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-10-13"
updated: 2026-10-13
---

# Training-job and deployment errors say what went wrong

## Description

Submitting a training job or driving a deployment with a bad id or in the wrong
state answers a generic 400 ("Failed to submit training job", "Failed to start
deployment") and the real reason lands only in the server log. The services
throw plain `Error`, which `sendFailure` masks by design. They should throw
typed `AppError` subclasses so the curated reason and the right status reach
the client.

## Details

**Current state:**
- `server/src/services/TrainingJobService.ts` and
  `server/src/services/DeploymentService.ts` throw `new Error(...)` at ~30
  sites ("Dataset not found", "Dataset not ready", "Sim scene not found",
  "Model version not found", "Deployment not found", "Cannot start deployment
  in status", "Active deployment already exists", ...).
- `server/src/utils/routeErrors.ts` `sendFailure` passes an `AppError` through
  with its status and message, and answers anything else with the fallback.
- `DELETE /api/deployments/:id` already answers 404 via `NotFoundError`, while
  `/start`, `/promote`, `/cancel`, `/progress` answer 400 for the same unknown id.
- `server/src/routes/datasets.routes.ts` (annotate) string-matches
  `'not found'` on the error message to pick 404.

### Server
- Unknown ids (dataset, sim scene, model version, checkpoint, deployment,
  target zone) → `NotFoundError` (404).
- Wrong-state errors (dataset not ready, cannot start/rollback/cancel/promote
  in status X, active deployment already exists, cannot cancel/retry job in
  status X, init-from base-model mismatch) → `ConflictError` (409).
- Input-shape errors (sceneId required, id must be a string, both init-from
  fields set, bad mixture weight, no dataset named, invalid stage index) →
  `BadRequestError` (400).
- "not initialized" / internal invariant throws stay plain `Error` (500 path).
- Annotate route drops its message string match; `sendFailure` handles it.

### Frontend
- App stores read `error` from the response body (`getErrorMessage`), so the
  curated messages show without change; verify.

**Key files:** `server/src/services/TrainingJobService.ts`,
`server/src/services/DeploymentService.ts`, `server/src/routes/datasets.routes.ts`,
tests under `server/src/services/__tests__/` and `server/src/__tests__/`.

## Acceptance Criteria
- [x] `POST /api/training/jobs` with an unknown `datasetId` answers 404 naming the dataset; with a dataset not ready answers 409 naming its status; `sim_rl` with an unknown `sceneId` answers 404.
- [x] `POST /api/deployments` with an unknown `modelVersionId` answers 404; with an active deployment for that version answers 409.
- [x] `/api/deployments/<unknown>/start|promote|cancel|progress|rollback` answer 404, the same as `DELETE`.
- [x] Starting/cancelling/rolling back a deployment in the wrong status answers 409 with the status in the message.
- [x] Plain internal errors still answer the generic fallback without echoing the text.
- [x] Server typecheck and vitest pass.

## Test Strategy
Vitest: service tests assert `statusCode` and message per error class; a route
test drives the training and deployment routes through supertest and asserts
status + body for unknown ids and wrong-state errors.
