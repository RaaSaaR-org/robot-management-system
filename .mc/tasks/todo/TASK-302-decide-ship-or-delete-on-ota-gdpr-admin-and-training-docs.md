---
id: "TASK-302"
aliases: []
title: "Decide ship-or-delete on OTA, GDPR admin and training docs"
slug: "decide-ship-or-delete-on-ota-gdpr-admin-and-training-docs"
status: "review"
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

---

## Verdicts

All three verdicts are **not now**: marked `@status unshipped`, kept in the tree,
nothing deleted. Deleting any of them is the repository owner's call, not this
PR's — the costed delete option is recorded under each so that call can be made
from evidence. Sizes use [`.claude/references/spe.md`](../../../.claude/references/spe.md)
(8 = ceiling, ~150k context; nothing higher ships as a leaf).

### 1. OTA delivery — **not now** (2026-09-12)

**Rejected: ship.** Not delete either — the delete option is costed below and
recommended against.

Confirmed by reading the current files, after TASK-292 landed: the credential
half is genuinely fixed (both fetches send `platformAuthHeaders()`, time out at
10 s, and fail loudly on 401/403 naming `NEODEM_SERVICE_TOKEN`), but the delivery
half is untouched and is the real defect. `SecureUpdateClient.downloadUpdate`
fetches the package *metadata* and then builds the payload as
``Buffer.from(`update-package-${info.version}`)`` behind a TODO, so the SHA-256
comparison and the Ed25519 `verifySignature` immediately below it check a
constant the client invented; `POST /api/updates` fabricates the identical
constant when no `fileData` is posted, and the Updates UI posts none; and
`UpdatePackage` (`server/prisma/schema.prisma:2723-2741`) has no artifact column
to hold bytes in the first place. `UpdateService.deployToRobot` contains no
`fetch`/`axios`/`agentUrl` at all — it writes an `UpdateDeployment` row, flips
the package to `deployed` and emits an event — and `robot-agent`'s
`rest-routes.ts` exposes no OTA endpoint for a push model to call. On the agent,
`index.ts:53`/`:529`/`:581` use only `startPeriodicChecks`/`stopPeriodicChecks`;
`downloadUpdate`, `applyUpdate` and `rollback` have **no production caller**, and
`applyUpdate`'s install step is a `console.log`. So: an operator can create,
sign, approve and "deploy" a package, and the fleet is never touched.

*Ship cost.* Four slices, ~spe 13 of buildable work plus one that is not
buildable here. (a) Artifact storage — an artifact column on `UpdatePackage`, a
migration, and upload/presign/stream endpoints modelled on
`server/src/storage/model-storage.ts`, which already has exactly this shape:
**spe 5**. (b) A real client download — `response.arrayBuffer()`, checksum and
signature over the received bytes, plus rewriting the two tests that currently
encode the defect: **spe 3**. (c) A delivery channel — a new OTA route on the
agent, a server-side push or an agent-side pull of assigned deployments, and a
status callback so `UpdateDeployment.status` reflects the robot rather than the
operator: **spe 5**. (d) The install itself — replacing binaries atomically with
a working rollback on a real robot. This is **hardware-pending, not buildable
now**: it cannot be proven on the simulator, and shipping a fake-verified
installer is strictly worse than shipping none. Size it only once (a)–(c) exist.

*Delete cost.* **spe 5** and irreversible: `update.routes.ts` (160 lines),
`UpdateService.ts` (435), two Prisma models plus a migration, the agent client
(371 lines) and its 12 tests, and the entire `app/src/features/updates` module
(19 files) — a page that looks fully shipped, including the sidebar row, which
belongs to the parallel navigation session (TASK-273..280) and is not this
task's to remove. **Recommended against:** the signing, approval workflow and
anti-rollback comparisons are correct and are the parts that are expensive to
rebuild; only the transport is missing.

*Test that mocks the broken seam.*
`robot-agent/src/updates/__tests__/SecureUpdateClient.test.ts:119-152`
("verifies signature during download") builds its fixture at **:123** as
``Buffer.from(`update-package-${version}`)`` — byte-identical to what production
fabricates — and the invalid-signature case at **:153-185** does the same at
**:157**. Both assert only `result.buffer` is *defined*. **Implementing a real
download breaks both.** They must be replaced by a `mockFetch` whose
`arrayBuffer()` returns real package bytes, with the expected checksum computed
in the test from those bytes independently of the client, plus a new case
asserting that a byte-level tamper is rejected. Server side,
`server/src/__tests__/update-routes.test.ts:12-30` mocks `updateService`
wholesale (`deployToRobot: vi.fn()` at **:18**), and
`server/src/services/__tests__/UpdateService.test.ts:10-25` mocks prisma and
asserts row writes only (`approveUpdate` :137-179, `triggerRollback` :180-219);
the replacement is an `UpdateService` test asserting an outbound HTTP call to the
agent and a deployment status driven by its callback — a test that cannot pass
against today's code.

### 2. GDPR admin fulfilment — **not now** (2026-09-12)

**Rejected: ship** (deferred to a planned child, not abandoned). **Delete is
rejected outright**, not merely deferred.

**Nothing to build server-side — this is not a server task.** `gdpr.routes.ts`
covers list, acknowledge, start-processing, complete, reject, execute-erasure
(**:580**), metrics, sla-report, overdue and nearing-deadline, and
`GDPRRequestService.executeErasure` (**:832**) is the only path that deletes
consents, pseudonymises logs and — via `RobotMemoryErasureService` — wipes robot
memory workspaces, correctly suppressed by a legal hold. It works. The gap is
**purely client**: `gdprApi.ts` implements eight admin operations and
`gdprStore.ts` six admin actions, and a grep across all of `app/src` finds
**zero** component references to any of them; `GDPRPortalPage.tsx` renders only
`requests`, `consent` and `ropa`. `executeErasure` and `getRequestsNearingSLA`
have no client code at all. Net effect: the Art. 12(3) one-month deadline is
tracked by code no controller can see, and the one Art. 17 fleet-wide erasure
path in the product is reachable only by hand-written HTTP.

*Ship cost.* **spe 5**, one slice: an admin view in the existing Data Privacy
section — queue table plus detail drawer with acknowledge / start / complete /
reject / execute-erasure and an overdue tile — copying
`app/src/features/approvals` (`ApprovalQueue` + `ApprovalDetailModal`) into the
`SegmentedControl` shell `GDPRPortalPage.tsx` already has, plus the two missing
client methods. The child **must carry `depends_on: ["[[TASK-270]]"]`**: the
`'current-user'` placeholder would otherwise record every fulfilment action
against a fake actor, which is worse than having no screen. Note for whoever
plans it: TASK-283 deliberately left `/api/gdpr/admin/*` out of the self-service
auth exemption, so the view needs member-or-above and must degrade honestly for
a viewer.

*Delete cost.* **spe 2** — strip the admin half of the store and API client
(~150 lines) and the store tests; the subject-side portal is untouched. Cheap,
and **recommended against**: it would discard the client half of a complete,
correct fulfilment API and leave the platform with no path to meet Art. 12(3)
in-product, to be rebuilt from scratch the first time a real controller uses
this. The cost of keeping it is one honest marker, which this PR adds.

*Test that mocks the broken seam.*
`app/src/features/gdpr/store/__tests__/gdprStore.test.ts` mocks the entire
`gdprApi` (`getAdminRequests` at **:34**) and then asserts all six admin actions
in the `// --- admin ---` block at **:254-336** — green, against a store nothing
renders. `server/src/__tests__/gdpr-routes.test.ts:12-36` mocks
`gdprRequestService` including `executeErasure` (**:31**) and drives the admin
routes from **:701**, with execute-erasure at **:896**. Both halves pass and
nothing joins them. Replacement when shipping: a component test that renders the
admin queue and drives the **real** store with only the api module mocked — the
pattern is `app/src/features/updates/__tests__/UpdatesSection.test.tsx:14-27`,
which mocks `updatesApi` one level below the store. (The Test Strategy above
cites `UpdatesPage.test.tsx:10-21`; that file does not exist — `UpdatesSection`
is the component, and the section-level test is the pattern to copy.)

### 3. Training-data documentation (AI Act Art. 10/11) — **not now** (2026-09-12)

**Rejected: delete**, and ship is deferred as too large for this spike to
justify blind.

Twelve route registrations in `training-docs.routes.ts` (`:30, 79, 102, 127,
169, 192, 217, 279, 306, 351, 374, 399`), mounted at `server/src/app.ts:370`
behind the standard protection, on a 941-line `TrainingDataDocService` with
three Prisma models and a working PDF export. A grep for `training-docs`,
`trainingDocs` or `biasAssessment` across `app/src` returns **nothing** — no
api client, no store, no page. The only in-product writer is
`TeleoperationService` → `recordProvenance`; every read path, every bias
assessment and the export are reachable by hand-written HTTP only.

*Ship cost.* **spe 8 at minimum — plan it as a split**, because a single leaf at
the ceiling will degrade: a new feature module from zero (types, api client,
store, page) covering three distinct surfaces — dataset provenance, training-data
summaries with their update-due tracking, and bias assessments with their
status workflow — plus a binary PDF download path the app has no existing
pattern for. Realistically two children at **spe 5** (provenance + summaries;
bias assessments + export). Costing this honestly is the main reason the verdict
is "not now" rather than "ship": it is a feature, not a wiring fix, and it needs
its own `/grill` to decide what a compliance officer actually needs on screen.

*Delete cost.* **spe 5, high and irreversible**: a migration dropping three
Prisma models (and the provenance rows teleoperation has already written),
941 lines of service, 424 of routes, 41 tests, and the `recordProvenance` call
site in `TeleoperationService`. Against that, "not now" costs one marker.
**Recommended against deleting** — but with a caveat the owner should weigh:
unreachable compliance code is a *liability*, not an asset, if anyone cites it
as Art. 10/11 coverage. The marker and the `docs/api.md` entry added here are
what keep it honest in the meantime.

*Test that mocks the broken seam.*
`server/src/__tests__/training-docs-routes.test.ts:11-13` replaces
`TrainingDataDocService` with a fully mocked object and `:30-50` mounts the
router directly behind a stub auth middleware; **41 tests pass with no client in
existence.** They are not wrong, they are just testing a surface nobody calls.
Replacement when shipping: an app-side feature test against a `trainingDocsApi`
that does not exist yet, in the shape of
`app/src/features/updates/__tests__/UpdatesSection.test.tsx`.

### Product claims contradicted, and what happened to each

All four named in the acceptance criteria are **corrected in this PR**; no
follow-up is needed to make the docs honest.

| Claim | Was | Now |
|---|---|---|
| `README.md:61` | "Ed25519-signed OTA packages" listed as a shipped Deploy capability | Says packages are signed and approved on the server but **nothing is delivered to a robot yet**, linking to Status & limitations |
| `README.md:444` | Art. 17 erasure "reaches the fleet" | Kept (the server path is real and does reach the fleet) but qualified: triggering it is an API call, because the admin screen does not exist |
| `README.md:443` | "Self-service portal covering 7 request types" | Qualified: the subject's side is shipped, the controller's fulfilment queue is API-only |
| `docs/regulatory-compliance.md:252-256` (§6.3) | A requirements table readable as an implementation claim | Followed by a dated **Implementation status** block stating that none of §6.3 is met, item by item, with the file evidence |
| `docs/api.md:328` | "`/api/updates` — OTA update management" | "OTA update **metadata**… delivery is not implemented" |
| `docs/api.md` (missing) | `/api/training-docs` absent from the route table despite being mounted | Added, marked HTTP-only with no app client |

`README.md`'s Status & limitations section now carries all three subsystems in
one paragraph, so a reader planning around NeoDEM meets them before the source.

### Enforcement of `@status`: manual, by grep — decided

**Decision: leave enforcement manual; add the inventory grep to the acceptance
criteria of each follow-up, not to CI.** A CI gate is the wrong tool here — the
correct number of `unshipped` files is not zero, so a grep-based gate would have
to carry a whitelist that itself goes stale, and it would fail the build every
time someone honestly marks a new module. The value of the tag is that it is
*read*, not that it is counted. Each follow-up that ships one of these
subsystems therefore gets an AC of the form "`grep -rn '@status unshipped'` no
longer lists `<file>`", which makes removing the marker part of the definition of
done for that specific slice. Declaring the tag in `app/AGENTS.md` and
`server/AGENTS.md` remains a separate **spe 2** follow-up, deliberately not done
here (`app/src` carries `@status` on 0 files, `server/src` on 3, all tests).

### The `index.ts` CRA Art. 13 claim — reconciled here

`robot-agent/src/index.ts:528-530` no longer reads `// Start secure OTA update
checks (CRA Art. 13)` above a call whose result is discarded. It now reads:

```ts
// OTA update checks — @status unshipped: this polls and discards; no update
// can be delivered (TASK-302). See SecureUpdateClient.ts for the CRA Art. 13
// claim and the caveat attached to it.
```

The bare Art. 13 claim is gone from the call site: the article is still named,
but only as a pointer to the `SecureUpdateClient.ts` header, which carries it
beside `@status unshipped` — the rule this package's AGENTS.md sets for a file
that is both unshipped and `@regulatory`. Together with that header edit this
satisfies acceptance criterion 4; nothing about the `index.ts` comment is left
for a follow-up.
