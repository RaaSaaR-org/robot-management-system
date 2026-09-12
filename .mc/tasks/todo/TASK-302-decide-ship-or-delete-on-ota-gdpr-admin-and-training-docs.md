---
id: "TASK-302"
aliases: []
title: "Decide ship-or-delete on OTA, GDPR admin and training docs"
slug: "decide-ship-or-delete-on-ota-gdpr-admin-and-training-docs"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [compliance, server, app, robot-agent]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 3
effort: "high"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Decide ship-or-delete on OTA, GDPR admin and training docs

## Description

Three subsystems are mounted, tested and green in CI while being unable to do the job their code and its regulatory annotations claim: OTA delivery, GDPR admin fulfilment, and the Art. 10/11 training-data documentation module. This is a spike, not an implementation. It produces one recorded verdict per subsystem — ship / delete / not now, each with a one-paragraph cost — and for every "not now" an in-code `@status unshipped` marker so the module stops reading as working coverage. No behaviour changes.

## Details

### Current state (confirmed by reading, 2026-09-12)

**1. OTA updates are a closed loop.** `UpdateService.deployToRobot` (`server/src/services/UpdateService.ts:209-243`) writes an `UpdateDeployment` row, flips the package to `deployed`, emits an event; there is no fetch/axios/agentUrl anywhere in the file. Its only entry is `POST /:id/deploy/:robotId` (`server/src/routes/update.routes.ts:126-140`), driven by a complete UI. There is nothing to contact anyway — `robot-agent/src/api/rest-routes.ts` defines no OTA endpoint.

Agent side: `robot-agent/src/index.ts:528-529` (comment "CRA Art. 13") starts `startPeriodicChecks`, which discards the result of `checkForUpdates` (`robot-agent/src/updates/SecureUpdateClient.ts:109-112`); `downloadUpdate` (`:134`), `applyUpdate` (`:192`) and `rollback` (`:230`) have no production caller. The package is fabricated at `SecureUpdateClient.ts:151` — ``Buffer.from(`update-package-${info.version}`)`` behind a TODO — so the SHA-256 and Ed25519 checks at `:153-166` verify a constant. The server falls back to the same constant at `update.routes.ts:53` (the ternary opens at `:51`). `server/prisma/schema.prisma:2674` (`UpdatePackage`) has no artifact column. The file header carries `@status live` and `@regulatory CRA Art. 13`.

**2. GDPR admin fulfilment has no component caller.** The server half is complete: `server/src/routes/gdpr.routes.ts:452-673` covers requests list, acknowledge (`:491`), start-processing (`:507`), complete (`:523`), reject (`:557`), execute-erasure (`:580`), metrics (`:622`), sla-report (`:635`), overdue (`:648`) and nearing-deadline (`:661`); `GDPRRequestService.executeErasure` (`server/src/services/GDPRRequestService.ts:832`) does the real work — it is the only path that deletes consents and pseudonymises logs. **Nothing to build server-side; the gap is purely client.**

`gdprApi` implements **eight** admin operations (`app/src/features/gdpr/api/gdprApi.ts:179` getAdminRequests, `:189` acknowledge, `:197` startProcessing, `:205` complete, `:215` reject, `:225` getMetrics, `:233` getSLAReport, `:241` getOverdueRequests), and `app/src/features/gdpr/store/gdprStore.ts` has `fetchAdminRequests` (`:355`), acknowledge (`:381`), complete (`:409`), reject (`:437`), `fetchMetrics` (`:465`) and `fetchSLAReport` (`:486`). So `/admin/sla-report` and `/admin/overdue` **do** have client code — what none of them has is a **component caller**; `GDPRPortalPage.tsx` renders requests/consent/RoPA only. Only `execute-erasure`, `start-processing` and `/admin/nearing-deadline` have no client at all.

**3. The Art. 10/11 training-data documentation module is unreachable.** 12 route registrations in `server/src/routes/training-docs.routes.ts` (at `:30, 79, 102, 127, 169, 192, 217, 279, 306, 351, 374, 399`) mounted at `server/src/app.ts:326`, on a 941-line `TrainingDataDocService.ts`, with three Prisma models (`server/prisma/schema.prisma:1777`, `:1800`, `:1822`) and a working PDF export. A grep for `training-docs` or `biasAssessment` across `app/src` returns nothing; there is no `trainingDocsApi`. The only internal caller is `TeleoperationService` → `recordProvenance`.

**The `@status` convention.** Repo-wide today: 125 `live`, 123 `test`, 13 `live-conditional`, 4 `hardware-pending`, plus ad-hoc values already in use (`orphaned` ×4, `new` ×7, `support` ×2, `UNPROVEN` ×1). It is documented **only** in `robot-agent/AGENTS.md:147-182`, with the value table at `:169-178`. Nothing enforces or surfaces it — `scripts/annotate-status.mjs`, cited at `robot-agent/AGENTS.md:180`, **does not exist** (`scripts/` holds `bearing-probe.py`, `build-hero-model.py`, `record-sim-run.py`, `test-all.sh`), and neither `test-all.sh` nor `.github/` greps for it.

### Server

Read and cost, then record:

- **OTA:** `UpdateService.ts:209-243`, `update.routes.ts:53` and `:126-140`, `schema.prisma:2674`. Ship cost: an artifact column plus an object-storage upload/download endpoint on the package, a push or pull channel to the agent, and a deployment-status callback — the same shape as the twin artifact path in `server/src/storage/model-storage.ts`, which already has upload/presign/stream/delete. Delete cost: routes + service + 2 Prisma models + a migration + the app feature.
- **GDPR:** nothing to build server-side. Record that explicitly, so the verdict is not mistaken for a server task.
- **Training docs:** 12 routes (424 lines) on a 941-line service with three Prisma models. Delete cost is high and irreversible (a migration dropping three models); "not now" is the cheap option — mark and keep.

### Frontend

Read and cost, then record:

- **GDPR admin:** ship cost is one admin view in the existing Data Privacy section — a queue table plus a detail drawer with acknowledge / start / complete / reject / execute-erasure and an overdue tile. The pattern to copy is `app/src/features/approvals` (`ApprovalQueue` + `ApprovalDetailModal`) and the page shell of `GDPRPortalPage.tsx`, which already has the `SegmentedControl` view switch. Missing client methods: `executeErasure`, `getRequestsNearingSLA`. Delete cost: strip the admin half of the store and API client only — the subject-side portal stays.
- **OTA app surface is fully built** — `UpdatesPage.tsx`, `DeployUpdateModal`, `RollbackModal`, `ApproveUpdateModal`, `updatesApi.ts:72-103`, `updatesStore.ts:93-114`, plus `App.tsx:57`/`:630` and `routes/lazyPages.ts:234`. A "delete" verdict therefore removes a page that looks shipped; cost it explicitly, including the nav entry (owned elsewhere — see Notes).
- **Training docs have no client whatsoever**: shipping means a new feature module (types, api, store, page) from zero — spe 8 or a split. Costing that is the main reason a "not now" verdict is likely.

### Robot Agent

Read and record: the `SecureUpdateClient.ts` header (`:1-7`, currently `@status live` and `@regulatory CRA Art. 13, MR Art. 10, Annex I`), `checkForUpdates` `:86-100`, `startPeriodicChecks` `:105-114` (discards the result), `downloadUpdate` `:134-168` with the fabricated buffer at `:151`, `applyUpdate` `:192-228` ("Step 2: Install (simulate…)"), `rollback` `:230-244`, the singleton export at `:332`, and the wiring at `index.ts:53` and `:528-529`. Confirm `rest-routes.ts` exposes no OTA endpoint, so a push model would need a new agent route.

Ship cost for the agent half: a real binary download (`response.arrayBuffer()`), a package format, and an install step that is not a simulation. The install is the expensive, hardware-gated part — size it honestly as a separate slice and say whether it is `hardware-pending` rather than buildable now.

**Marker work lives here, because this package owns the convention.** Add one row to the value table at `robot-agent/AGENTS.md:169-178`: `unshipped`, defined as "reachable from a live entry point and green in CI, but cannot deliver the function its header or regulatory tag claims; do not read as coverage", written as `@status unshipped — <one line: what it cannot do> (TASK-NNN)`. Reuse the existing tag; do not invent a second marker. Note in the same edit that `scripts/annotate-status.mjs` no longer exists.

If the OTA verdict is "not now", `SecureUpdateClient.ts:6` must stop saying `live`, and the `@regulatory CRA Art. 13` claims at that header and at `robot-agent/src/index.ts:528` must be reconciled with the verdict — either the claim stays and the file says `unshipped` next to it, or the claim comes out.

**Key files:**
- `.mc/tasks/todo/TASK-302-decide-ship-or-delete-on-ota-gdpr-admin-and-training-docs.md` — the three verdicts, dated, each with a one-paragraph cost
- `robot-agent/AGENTS.md` — add the `unshipped` row to the `@status` table (`:169-178`); note `annotate-status.mjs` is gone
- `robot-agent/src/updates/SecureUpdateClient.ts` — header `:6` flips off `live` if not shipped
- `server/src/services/UpdateService.ts` — header marker; `deployToRobot` `:209-243` is the evidence
- `server/src/routes/update.routes.ts` — header marker; fabricated fallback at `:53`
- `server/src/routes/training-docs.routes.ts` — header marker for the unreachable 12-route surface
- `server/src/services/TrainingDataDocService.ts` — header marker; 941 lines, 3 Prisma models
- `app/src/features/gdpr/store/gdprStore.ts` — marker above the ADMIN block (`:352-500`)
- `app/src/features/gdpr/api/gdprApi.ts` — marker above the admin methods (`:179-241`)
- `README.md` — claims to reconcile: `:61` OTA packages, `:444` erasure reaching the fleet
- `docs/regulatory-compliance.md` — claims to reconcile: `:252-254` CRA Art. 13(8)/Annex I, MR Art. 10
- `docs/api.md` — `:252` lists `/api/updates` as OTA update management

## Acceptance Criteria

- [ ] This task file carries a `## Verdicts` section with exactly three dated entries — OTA delivery, GDPR admin fulfilment, training-data documentation — each stating `ship` / `delete` / `not now`, the option it rejected, and a one-paragraph cost for both options expressed in slices and spe.
- [ ] `@status unshipped` is defined as a new row in the value table at `robot-agent/AGENTS.md:169-178`, and the same edit records that `scripts/annotate-status.mjs` no longer exists.
- [ ] Every module whose verdict is `not now` carries `@status unshipped — <what it cannot do> (TASK-NNN)` in its file header, and `grep -rn '@status unshipped' app/src server/src robot-agent/src` lists exactly those files and no others.
- [ ] `robot-agent/src/updates/SecureUpdateClient.ts:6` no longer reads `@status live`, and the `@regulatory CRA Art. 13` claims at that header and at `robot-agent/src/index.ts:528` are either reconciled with the verdict or removed.
- [ ] Each of the three verdicts names, with path and line, the existing test that mocks the broken seam and states what must replace it when the module ships.
- [ ] Every product claim the verdicts contradict is listed with file:line (at minimum `README.md:61`, `README.md:444`, `docs/regulatory-compliance.md:252-254`, `docs/api.md:252`) and is either corrected in this PR or carried into a named follow-up.
- [ ] The PR changes no behaviour: `git diff --stat` shows only `.md` files, task files and file-header JSDoc blocks, and `./scripts/test-all.sh --skip-pw` passes with no test edited.

## Test Strategy

**This spike adds no test.** Its job is to name the tests that must change when each verdict is acted on.

**OTA — both sides mocked, and one of them against the defect itself.** `robot-agent/src/updates/__tests__/SecureUpdateClient.test.ts:115` and `:149` build ``Buffer.from(`update-package-${version}`)`` as the fixture — byte-identical to what production fabricates at `SecureUpdateClient.ts:151` — so "verifies signature during download" (`:112-142`) checksums the test's own constant. **Implementing a real download would break both tests.** Replacement when shipping: `mockFetch` returns `arrayBuffer()` of real package bytes whose checksum is computed independently of the client. Server side, `server/src/__tests__/update-routes.test.ts:18` mocks `deployToRobot` outright and `server/src/services/__tests__/UpdateService.test.ts:10-25` mocks prisma and asserts only row writes (`:137-219`); the replacement is an `UpdateService` test asserting an outbound HTTP call to the agent, which cannot pass today.

**GDPR admin — both halves green, nothing joins them.** `app/src/features/gdpr/store/__tests__/gdprStore.test.ts:20-40` mocks the whole `gdprApi`, then asserts the admin actions at `:255-309`; `server/src/__tests__/gdpr-routes.test.ts:12-36` mocks `gdprRequestService` including `executeErasure` and drives the routes at `:893-995`. Replacement: a component test that renders the admin queue and drives the real store with only the api module mocked — the pattern is `app/src/features/updates/__tests__/UpdatesPage.test.tsx:10-21`, which mocks one level below the store.

**Training docs.** `server/src/__tests__/training-docs-routes.test.ts:11-49` mounts the router itself and injects a fully mocked `trainingDataDocService`; 41 tests pass with no client in existence. Replacement when shipping: an app-side feature test against `trainingDocsApi`, which does not exist yet.

## Notes

**Verdicts of "delete" are the owner's call.** Present the costed options and a recommendation; **delete nothing in this PR.**

Twin deletion was originally the fourth subsystem here. It is now **TASK-301** — it is a live data-orphaning defect reachable from a shipped button, and this spike's no-code-change terms would have left it covered on paper only.

Keep the marker work minimal: add the `unshipped` row to `robot-agent/AGENTS.md` only. **Do not** expand the `@status` table into `app/AGENTS.md:191` and `server/AGENTS.md:412` as part of this spike — `app/src` carries the tag on 0 files and `server/src` on 3 (all test files), so declaring it in those packages is its own small follow-up, worth about spe 2.

TASK-270 (open, spe 2) fixes the GDPR `'current-user'` placeholder. A GDPR admin UI depends on it, so a **ship** verdict for GDPR admin should carry `depends_on: ["[[TASK-270]]"]` on the child that gets planned from it.

A **delete** verdict for OTA would remove the Updates page (`app/src/App.tsx:57`/`:630`, `app/src/routes/lazyPages.ts:234`), whose sidebar row belongs to the parallel navigation session (TASK-273..280) — that removal is theirs to make, not this task's. Do not touch `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*` or `app/src/components/docs/DocsSidebar.tsx`.

Nothing enforces `@status` today. Decide as part of the spike whether to add a grep-based inventory (`grep -rn '@status unshipped'`) to the acceptance criteria of the follow-ups, or to leave enforcement manual — and write the decision down either way.
