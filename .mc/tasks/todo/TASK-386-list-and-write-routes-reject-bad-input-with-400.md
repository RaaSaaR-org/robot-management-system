---
id: "TASK-386"
aliases: []
title: "List and write routes reject bad input with 400"
slug: "list-and-write-routes-reject-bad-input-with-400"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-13"
updated: "2026-10-13"
---

# List and write routes reject bad input with 400

## Description

Several server routes trust their input: list endpoints hand `parseInt(req.query.page)`
to Prisma (so `?page=abc` is a 500 and `?limit=-1` returns the wrong rows), incidents
store any severity/status string, process definitions accept step templates that make
every later start fail with 500, and twin zones accept points that never reach the Nav2
keep-out mask. Each of these should be a 400 that names the bad field, raised with the
existing error hierarchy in `server/src/utils/errors.ts`.

## Details

### Current state

- **Pagination** — bare `parseInt` on `page`/`limit`/`pageSize`/`offset` in most list
  routes (`incident`, `alert`, `process`, `datasets`, `approval`, `command`,
  `compliance-log`, `explainability`, `oversight`, `training`, `deployments`, and others).
  `page=abc` → `skip: NaN` → 500; `page=0` → negative skip → 500; `limit=-1` → `take: -1`.
  There is no shared helper in `server/src/utils`.
- **Incidents** — `server/src/routes/incident.routes.ts` validates only `type` on POST; PATCH
  copies `severity`, `status`, `riskScore` unchecked. An unknown severity is scored as risk
  100 and gets its own dashboard bucket. `IncidentRepository.update` has a bare `catch {}`
  returning `null`, so a Prisma validation error (e.g. `riskScore: "high"`) answers
  404 "Incident not found".
- **Processes** — `POST /api/processes` checks only `name` and `stepTemplates.length`;
  `[{foo:1}]` is accepted, publishes, schedules, and every start returns 500. A string
  `stepTemplates` is a 500. `POST /api/processes/tasks` accepts any `actionType`.
- **Twin zones** — `POST /api/digital-twins/:id/zones` checks only `Array.isArray(points)`;
  `["a","b"]` and `[{x:"NaN",y:null}]` are stored, and `buildKeepoutMask` silently drops them.

### Server

- `server/src/utils/pagination.ts` (new): `parseIntegerParam`, `parsePagination`,
  `parseOffsetPagination` — absent → default, non-integer or below the minimum → `BadRequestError`
  naming the parameter, above an optional max → clamped. Exported from `utils/index.ts`.
- Replace bare `parseInt` page/limit/pageSize/offset parsing in list routes with it.
- `incident.routes.ts`: allow-lists for severity (`critical|high|medium|low`) and status
  (`detected|investigating|contained|resolved|closed`) on POST and PATCH; `riskScore` must be
  an integer 0..100. `IncidentRepository.update` maps only Prisma P2025 to `null` and rethrows
  everything else.
- `process.routes.ts`: `validateStepTemplates()` — array, each step a non-empty `name`, a known
  `actionType`, an object `actionConfig` (when given); used on create, update and publish; `actionType` on
  `POST /processes/tasks` is checked against the same list.
- `twin.routes.ts`: `points` must be an array of at least 3 `{x, y}` with finite numbers, on POST
  and (when present) PUT.

### Key files

- `server/src/utils/pagination.ts`, `server/src/utils/index.ts`
- `server/src/routes/*.routes.ts` (pagination call sites)
- `server/src/routes/incident.routes.ts`, `server/src/repositories/IncidentRepository.ts`
- `server/src/routes/process.routes.ts`
- `server/src/routes/twin.routes.ts`

## Acceptance Criteria

- [ ] `GET` on the list routes with `?page=abc`, `?page=0` or `?limit=-1` answers 400 naming the parameter, never 500 and never the wrong rows.
- [ ] `POST /api/incidents` with an unknown `severity`, and `PATCH /api/incidents/:id` with an unknown `severity`/`status`, answer 400 listing the allowed values.
- [ ] `PATCH /api/incidents/:id` with `riskScore` that is not an integer in 0..100 answers 400; a wrong-typed field is never answered 404 for an existing incident.
- [ ] `POST`/`PUT /api/processes` with non-array `stepTemplates` or a step lacking `name` or with an unknown `actionType` answers 400 naming the step index; publish refuses such a stored definition; `POST /api/processes/tasks` with an unknown `actionType` answers 400.
- [ ] `POST`/`PUT /api/digital-twins/:id/zones` with fewer than 3 points or non-finite `x`/`y` answers 400.
- [ ] Unit/route tests cover each of the above; server typecheck and vitest pass.

## Test Strategy

Vitest: unit tests for the pagination helper, and supertest route tests (mocked services,
following the existing `server/src/routes/__tests__` pattern) for incidents, processes, twin
zones and a sample of list routes.

## Notes

Found by the 2026-10-13 system review (area server-api).
