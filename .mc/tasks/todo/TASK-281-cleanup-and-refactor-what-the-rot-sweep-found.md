---
id: "TASK-281"
aliases: []
title: "Cleanup and refactor — what the rot sweep found"
slug: "cleanup-and-refactor-what-the-rot-sweep-found"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app, compliance]
sprint: ""
parent: ""
depends_on: []
spe:
effort: "high"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Cleanup and refactor — what the rot sweep found

## Description

A seven-lens sweep of `app/`, `server/` and `robot-agent/` looked for the failure shape the
`FederatedClient` exemplar named: code that is wired in and looks alive, but cannot work, because two
sides of a boundary drifted apart while the tests mocked the very seam that broke. It produced 28
candidates; an adversarial refutation pass killed 8 and confirmed 19 distinct defects. This is the
epic for those 19. **It is a parent — split it with `/plan` before implementing.** The proposed child
slices are below, each sized to stay under the `spe: 8` ceiling.

## Details

### Current state (found 2026-09-12)

Found by 14 agents (7 finders + 7 refuters, ~2M tokens). Every claim below carries `file:line`
evidence that a second agent re-opened and checked; the corrections that pass made are already folded
in. Severity is the refuter's, not the finder's — several were talked down.

The unifying cause is worth stating once, because it explains all 19: **this codebase declares its
contracts twice and enforces them in neither place.** Statuses, permissions, open-sets, identity,
action types and the tenant allowlist each exist as two independent declarations in two packages,
with nothing — no shared module, no test, no typecheck — asserting they agree. CI is green
throughout, because the tests mock the seam.

---

### A. Authorization is declared twice and enforced nowhere — **critical**

A `viewer`, the lowest role the product sells, can unregister a robot from the fleet and issue
physical motion commands to it.

- `server/src/routes/robot.routes.ts:127` (`DELETE /:id`) and `:145` (`POST /:id/command`) carry no
  role check. The file has no router-level `.use(` guard and, apart from a camera ticket at `:284`,
  no `req.user` reference at all.
- `server/src/app.ts:209` mounts it behind `authMiddleware` alone — authentication, not authorization.
- `server/src/middleware/auth.middleware.ts:411` (`memberOrAbove`, documented "for write/operate
  endpoints that read-only viewers should not reach") and `:417` (`viewerOrAbove`) are applied by
  **zero** route files. Role gates exist in 4 of 66 route files, all `ownerOnly`/`superAdminOnly`.
- `app/src/features/auth/types/auth.types.ts:283` declares `VIEWER_PERMISSIONS` (four read-only
  permissions) and `AuthProvider.tsx:114` exposes `can()` — but no component anywhere passes
  `requiredPermission`, so the client matrix gates nothing either.
- `server/src/services/TeamService.ts:29` — `viewer` is in `ASSIGNABLE_ROLES`, so the token is a real
  production artifact.

Verified independently before filing. **Why CI misses it:** the guards have passing unit tests in
isolation; nothing asserts which routes are wrapped in them, and route tests authenticate as a
privileged user.

### B. The oversight record is self-asserted, loses its subjects, and forks under load — **high**

Three separate defects in the EU AI Act evidence chain.

1. **The approvals audit trail records whoever the client says decided.**
   `server/src/routes/approval.routes.ts:211` destructures `decidedBy` from `req.body` and validates
   only that it is non-empty (`:220`); cancel (`:248`) and escalate (`:274`) do the same. The file has
   zero `req.user` references despite the `authMiddleware` mount at `app.ts:275`. The value flows
   straight into the record (`ApprovalWorkflowService.ts:205/:229`, stamped as the event userId at
   `:247`) and into the immutable status-history row (`ApprovalRepository.ts:567`). The client sends
   `user?.email ?? user?.id ?? 'unknown-reviewer'` (`ApprovalDetailModal.tsx:32`,
   `ApprovalQueue.tsx:37`) — so a client with no loaded user writes the literal string
   `unknown-reviewer` into the approval history, and any authenticated caller can attribute a decision
   to a colleague.

2. **`escalated` counts as open on the client, and is excluded from every server query that means
   "still open".** `app/src/features/approvals/components/approvalFormat.ts:11` includes it;
   `server/src/repositories/ApprovalRepository.ts` hardcodes `status: { in: ['pending','in_progress'] }`
   six times — `:298`, `:318`, `:340`, `:357`, `:404`, `:611`. Escalation is the SLA-breach path
   (`ApprovalWorkflowService.ts:651` walks `findOverdue`), so the moment a request breaches, it leaves
   the overdue set, is never re-escalated, and drops out of both "pending for me" and "pending for
   role". The dead guard at `:657` (`if (request.status !== 'escalated')`) is evidence the author
   expected otherwise. One screen contradicts itself: the queue lists the row, the Pending and Overdue
   tiles exclude it.

3. **The compliance hash chain reads its predecessor outside any transaction.**
   `server/src/repositories/ComplianceLogRepository.ts:126-131` does a bare `findFirst` for
   `previousHash`, then a separate `create` at `:148`; there is no `$transaction` in the file. Two
   overlapping writes persist the same `previousHash`, and `verifyHashChain` (`:300`,`:310`,`:337`)
   then reports a permanent broken link. Concurrency is routine — `auth.middleware.ts:109` writes
   fire-and-forget, and every robot flushes its own queue. `timestamp` is a plain `DateTime` with a
   non-unique index (`schema.prisma:929`,`:947`), so same-millisecond rows also order
   non-deterministically. Surfaces as a false tamper report in `AuditLogSection.tsx:120-128`.

### C. The robot agent and the server disagree about the wire — **high**

1. **Four live agent clients send no credential.** `platformAuthHeaders()`
   (`robot-agent/src/utils/platform-auth.ts:10`) exists and six clients use it — the pattern is
   `ComplianceLogClient.ts:175`. Four do not: `SecureUpdateClient.ts:88` and `:135` (no init object at
   all), `tools/navigation.ts:78`, `agent-mode/peers.ts:235`, `robot/TaskQueue.ts:193`. All four
   targets sit behind `authMiddleware` (`app.ts:209`,`:230`,`:236`,`:368`), which 401s at
   `auth.middleware.ts:250-254`. Each client then swallows the 401 as if it meant "nothing to report":
   OTA updates never arrive, server-defined named zones stop resolving so "move to Warehouse A" fails
   (`home` still works via `FALLBACK_LOCATIONS`, `navigation.ts:148-157`), peer avoidance degrades to a
   stale set, and task status is never reported so pushed tasks sit as `executing` forever.
   Reachable in the auth-on config `docs/demo-day.md:38` and `robot-agent/.env.example:32` describe —
   not the shipped Helm default (`helm/neodem/values.yaml:150` ships `authDisabled: "true"`).

2. **The agent reports `completed` for every action type it does not implement.**
   `robot-agent/src/robot/TaskQueue.ts:295` is `case 'inspect': case 'custom': default:` — it logs
   "Simulating", sleeps 2000 ms, and returns `{ success: true }` (`:301`). That fake success is
   reported as real (`:239` → `process.routes.ts:415` → `TaskDistributor.ts:425` →
   `RobotTaskRepository.ts:226` writes `completed` + `completedAt`). **And every process created in the
   NeoDEM UI is built entirely from these steps**: `app/src/features/processes/api/tasksApi.ts:119`
   and `:126` both hardcode `actionType: 'custom'`, because `CreateProcessModal.tsx:88` collects step
   *names* only. So a user-created process is steps the robot sleeps through and records as done.
   The `default: return success` fallthrough means every action type added to the server union from
   now on inherits this silently.

3. **`protective_stop` is an app-only status.** `robot-agent/src/safety/SafetyMonitor.ts:1225` sets
   `s.status = 'online'; // Stopped but not in error` for both emergency and protective stops, and that
   `online` reaches the fleet console through `rest-routes.ts:348` → `RobotManager.ts:905-921`. The app
   declares a 7th value with a label (`robots.types.ts:485`), a red badge (`:496`), a list filter
   (`RobotList.tsx:29`) and a fleet counter (`useFleetStatus.ts:46`) that no producer can ever emit —
   all three producers stop at 6 values. A latched robot that refuses to move shows as Online, in
   green; the "Protective stop" filter returns nothing; the counter is permanently 0. The operator's
   only signal is a warning sentence on the robot *detail* page (`RobotErrorBanner.tsx:126`).

### D. The fleet console misreports safety state — **high**

A remote E-Stop never reaches the dashboard's fleet Stop button. The server broadcasts
`safety:estop` (`server/src/websocket/index.ts:251-258`); the client routes it to `addEvent` only
(`useRobotWebSocket.ts:146`), which unshifts into `state.events` and touches nothing else
(`safetyStore.ts:310-317`). But the button renders entirely off `fleetStatus.anyTriggered` /
`triggeredCount` (`FleetEmergencyStopButton.tsx:69-85`), fetched exactly once on mount
(`useSafety.ts:46-48`) with no polling and no WS path. The only 5s refresher lives in
`useSafetyOverview`, whose sole consumer `SafetyStatusDashboard` is exported (`safety/index.ts:43`)
and rendered nowhere.

Two corrections from verification that change the fix: the server emits an E-stop event **only** for
fleet and zone triggers (`SafetyService.ts:254`,`:408`) — a single-robot stop broadcasts nothing —
and `resetFleetEStop` (`:273-316`) emits nothing at all. So reducing the incoming event is not
sufficient; this needs a refetch, or a new broadcast on reset. The dangerous direction is the inverse:
after a remote reset the tag still reads "Fleet stopped" and offers "Resume fleet" on an already-armed
fleet.

`DashboardPage.tsx:82` carries the comment "Safety-critical: visible in every state, right-most,
never a primary" over a component structurally incapable of reacting to a stop it did not initiate.

### E. Multi-tenancy isolation has holes, and the allowlist cannot be tested — **high**

Latent: `MULTI_TENANCY_ENABLED` defaults to false (`server/src/config/features.ts:25`). It gets more
expensive to fix every day it runs, because ownership is not being recorded now.

1. **The whole digital-twin / perception / sim-scene surface is unscoped.** `DigitalTwin`,
   `ScanSession` and `SimScene` carry a `tenantId` column (`schema.prisma:186`,`:219`,`:1955`) that is
   absent from `TENANT_SCOPED_MODELS` (`client.ts:33-71`), so the extension passes their queries
   through untouched (`:99`) — `DigitalTwinRepository.list()` is a bare `findMany`. `SensorScan`,
   `MotionClip` and `VlaSession` have no `tenantId` at all. Worse on the write side:
   `twin.routes.ts:228-232` never supplies one, so `DigitalTwinRepository.ts:61` stores `null` — the
   ownership needed to retrofit a filter is not being recorded even now. This is merged point clouds
   of customers' buildings, raw LiDAR sweeps, and the prompts operators gave their robots.
2. **Incident and approval numbers are generated by a tenant-filtered max-scan against a globally
   unique column.** `IncidentRepository.ts:121-140` + `schema.prisma:1175`; same shape at
   `ApprovalRepository.ts:223-239` + `schema.prisma:1386`. Tenant B computes `INC-2026-001`, hits
   P2002, and gets a 500 that never resolves — the number it computes never advances.
   **Flag-independent second failure:** the counter is padded to 3 digits but ordered
   lexicographically, so after `INC-2026-1000` exists, `INC-2026-999` still sorts highest and every
   incident after the 1000th in a year collides forever. (Approvals pad to 5, so the rollover is
   Incident-only.)
3. **`Zone`'s `@@unique([name, floor])` is not tenant-qualified** (`schema.prisma:501`). The duplicate
   pre-check is a `findUnique` the extension post-filters to `null` (`client.ts:128-142`), so
   validation passes and the insert then throws a 500 (`zone.routes.ts:167-175`). "Warehouse A",
   "Dock 1", "Charging" collide across tenants by default.

**The root cause is testability:** both tenancy tests paste their own copy of the allowlist
(`client.test.ts:52-71` = 19 entries, already stale; `multi-tenancy.integration.test.ts:43-47` = 4).
Nothing imports `TENANT_SCOPED_MODELS`, so a tenant-owned model can never fail a test by drifting out.
**Fix that first:** derive the set of `tenantId`-bearing models from `schema.prisma` and assert it
equals the real export.

### F. The error contract is inverted in two directions — **high / medium**

1. **`instanceof Error` is always false on the api-client path** — it rejects with a plain
   `{code, message, statusCode}` (`app/src/api/client.ts:176-210`). 165 non-test sites across 55 files
   use `error instanceof Error ? error.message : '…'`, so the fallback always wins. The sharpest
   instance: an operator hits the per-robot E-stop for an unreachable robot; the server answers 503
   "Robot … is not connected" (`SafetyService.ts:105-147`), `safetyStore.ts:171` discards it, and the
   button renders "The stop did not reach the robot. Use the hardware stop." — the operator is never
   told whether the robot was unknown, disconnected, or still latched. Two correct helpers already
   exist and 112 files use them (`shared/utils/error.ts:44`, `shared/components/ui/errorMessage.ts:38`).
   **The store test rejects with `new Error('estop fail')` (`safetyStore.test.ts:226`) — it mocks the
   broken seam and feeds it the one shape production never produces.**
2. **33 of 64 route files echo raw caught error text to the client.** `prismaErrorToAppError`
   (`server/src/utils/errors.ts:288-326`) exists for exactly this and its own comment says so — "that
   belongs in a log, never in a response" — and has two call sites (`team.routes.ts:42`,
   `service-accounts.routes.ts:40`). A `PrismaClientKnownRequestError` *is* an `Error`, and no
   `errorFormat` is configured (`client.ts:78-80`), so its full dump — query, schema shape, absolute
   server source path — reaches the browser. The global handler gets this right
   (`app.ts:432-448`, dev-only); the per-route catches bypass it. Disclosure is to authenticated users,
   which is why this is medium rather than high.

### G. Deployment cancel and rollback are both recorded as "Failed" — **medium**

Found independently by two lenses, which is why it is here despite being medium.
`DeploymentService.rollback()` ends a **successful** rollback with `status: 'failed'` (`:375`) and
`cancelDeployment()` does the same (`:410`). The only status writes in the file are `deploying`,
`production`, `rolling_back`, `failed`; no server code writes `rolled_back`, `cancelled` or
`completed` anywhere. The app declares all nine (`deployment.types.ts:11-20`) and styles all nine
(`:54`,`:66`), so three terminal states are permanently unreachable and the helper branches for them
are dead (`deploymentHelpers.ts:43`). A deliberate withdrawal and an uncontrolled crash are the same
red row — in what serves as the post-market monitoring trail. The column is a free-form String, so no
data migration is needed.

### H. Demo mode's catch-all poisons any page without a bespoke handler — **high**

`app/src/mocks/handlers.ts:620` ends with `http.get('/api/*')` returning `{data:[], total:0, items:[]}`
— an envelope no store reads. `/api/incidents` and `/api/deployments` have no handler, so
`incidentsStore.ts:108` and `deploymentStore.ts:97` assign `undefined` over an initial `[]`, and the
next render throws. `/deployments` white-screens on arrival (`DeploymentsPage.tsx:86` fetches on
mount, `:135` calls `.filter`); `/alerts` breaks when the Incidents tab is clicked
(`AlertsPage.tsx:141` lists it unconditionally). The only `ErrorBoundary` in `app/src` is the 3D
viewer's, so the tree blanks. This is the public GitHub Pages demo, and the catch-all silently re-arms
the trap for every feature added without a hand-written handler.

### I. Four subsystems are wired in but cannot do their job — decide ship or delete

- **OTA updates are a closed loop — high.** `UpdateService.deployToRobot` writes a row, flips the
  package to `deployed`, emits an event, and stops; a grep for fetch/axios/agentUrl across the file
  returns nothing. There is nothing to contact anyway — the agent's REST surface defines no OTA
  endpoint. The agent's periodic check (`index.ts:529`) only calls `checkForUpdates()`, whose result
  the caller discards; `downloadUpdate`, `applyUpdate` and `rollback` have no production callers. And
  `SecureUpdateClient.ts:151` builds the "package" as ``Buffer.from(`update-package-${info.version}`)``
  behind a TODO — so the SHA-256 and Ed25519 checks verify a fabricated constant. `update.routes.ts:50`
  makes the *server* fall back to the same constant, and `schema.prisma:2674` has no artifact column at
  all. Labelled CRA Art. 13 at `index.ts:528`. **The test at `SecureUpdateClient.test.ts:115` builds
  the identical constant as its fixture — implementing a real download would break it.**
- **GDPR admin fulfilment has no UI — high.** Subjects can file requests; nothing can action them.
  `gdprStore.ts:355/381/409/437` define the full admin set and `gdprApi` implements all four against
  real routes, but no `.tsx` calls any of them. `POST /admin/requests/:id/execute-erasure`
  (`gdpr.routes.ts:580`) — the only path that actually deletes consents and pseudonymises logs
  (`GDPRRequestService.ts:832`) — appears nowhere in `app/src`, not even in the API client. The one
  closure path the client implements (`complete`) only flips a status. `/admin/overdue`,
  `/admin/sla-report` and `/admin/nearing-deadline` have no caller, so the Art. 12(3) clock runs out
  silently.
- **The Art. 10/11 training-data documentation module is unreachable — medium.** 12 routes mounted at
  `app.ts:326` covering provenance, summaries, bias assessments and a working PDF export; a grep for
  `training-docs`/`biasAssessment` across `app/src` returns nothing, and there is no `trainingDocsApi`.
  Only `recordProvenance` has an internal caller. Its route test mounts the router itself and drives it
  with a mocked service, so the whole surface is green with no client.
- **Deleting a digital twin orphans its storage — medium.** `twin.routes.ts:253-262` calls a bare
  `prisma.digitalTwin.delete()`. `modelStorage.deleteTwinArtifact` (`model-storage.ts:593`) has one
  caller repo-wide and it is a test; `SimSceneRepository.deleteByTwinId` has none. `SensorScan.sessionId`
  is a plain FK with no relation (`schema.prisma:96`), so those rows survive with a dangling id while
  their PCD blobs stay in the bucket. Frames are pruned only on a *successful* build
  (`DigitalTwinService.ts:286-296`); `failJob` never prunes — so deleting a failed build, the natural
  user reaction, strands the full raw sweep. Once the row is gone there is no index left to enumerate
  those objects by, which defeats the erasure guarantee the GDPR portal promises.

---

### Children

Split 2026-09-12 by `/plan`: 13 agents each read the code for one proposed slice, then a critic
checked the set for coverage, overlap, honest sizing and real blockers. Four proposals were over the
ceiling or mis-scoped and became 21 children. Every leaf is at or under `spe: 8`.

| Task | Title | Covers | spe | Blocked by |
|------|-------|--------|-----|------------|
| TASK-282 | Enforce member-or-above authorization on fleet and physical write routes | A (server, part 1) | 5 | — |
| TASK-283 | Extend the write-route guard to every mount and fail closed | A (server, part 2) | 5 | TASK-282 |
| TASK-284 | Gate destructive robot actions in the client permission matrix | A (client) | 3 | — |
| TASK-285 | Derive the tenant allowlist from the schema and close the twin/scan gaps | E1 (allowlist) | 5 | — |
| TASK-286 | Record tenant ownership for sensor scans, motion clips and VLA sessions | E1 (columns) | 5 | — |
| TASK-287 | Replace the incident and approval number generators with an atomic counter | E2 | 5 | — |
| TASK-288 | Tenant-qualify the zone name and floor constraint | E3 | 2 | — |
| TASK-289 | Take the approval decision actor from the session, not the request body | B1 | 5 | — |
| TASK-290 | Define "open approval" once, so an escalated request stays in the queue | B2 | 3 | — |
| TASK-291 | Serialize the compliance hash chain so concurrent writes cannot fork it | B3 | 5 | — |
| TASK-292 | Send platform credentials from every agent client and fail loudly on 401 | C1 | 5 | — |
| TASK-293 | Fail unimplemented action types instead of reporting them completed | C2 | 5 | — |
| TASK-294 | Report a latched stop as protective_stop end to end | C3 | 3 | — |
| TASK-295 | Broadcast every E-stop transition and reduce it in the fleet console | D | 5 | — |
| TASK-296 | Reject api errors as Error instances | F1 (root) | 3 | — |
| TASK-297 | Sweep app catches onto the shared error helpers | F1 (sweep) | 5 | — |
| TASK-298 | Stop route handlers echoing raw caught error text | F2 | 5 | — |
| TASK-299 | Record deployment rollback and cancel as themselves, not as failures | G | 5 | — |
| TASK-300 | Make demo mode fail loudly instead of serving a shape no store reads | H | 5 | — |
| TASK-301 | Delete a digital twin without orphaning its scans and blobs | I (twin) | 3 | — |
| TASK-302 | Decide ship-or-delete on OTA, GDPR admin and training docs | I (other three) | 3 | — |

Start with **TASK-282** — it is the only `critical`. Then TASK-294 and TASK-296, both small and both
removing an operator-visible lie. TASK-283 is the one real blocker in the set: its fail-closed
enumeration test cannot pass until TASK-282 has applied the guard.

**What the split changed, and why** — recorded so it is not re-litigated:

- **Slice 1 became three.** Not 66 route files but **349 write verbs across 64**; the middleware is
  one file, but classifying all 349 (self-service GDPR writes, auth login/register, worker claim,
  contribution submission) is what exceeds the ceiling. TASK-282 guards the physical and fleet mounts
  with the enumeration test in report-only mode; TASK-283 extends it and flips it fail-closed.
- **The client half of A had fallen through both the epic and the slice.** `grep -rn requiredPermission
  app/src` hits only `ProtectedRoute.tsx` itself. After TASK-282 a viewer is refused by the server but
  still sees Delete robot and Send command. TASK-284 closes that.
- **E1 was only half-covered.** The allowlist gap (TASK-285) and the missing-column gap (TASK-286) are
  different jobs: the second needs a migration and a backfill over `SensorScan`, one row per LiDAR
  frame. Splitting them is what keeps both under the ceiling.
- **Zone came out of slice 3.** A two-line schema change plus one `findFirst` does not belong in the
  same child as a new allocator model, Postgres DDL and a two-tenant integration test.
- **Twin deletion came out of the spike.** It is a live defect reachable from a shipped button
  (`SitesGalleryPage.tsx:92`), and the spike's own terms forbid it changing code. TASK-302 now decides
  three subsystems, not four.
- **The eslint child was dropped.** There is no eslint config, no lint script and no lint step anywhere
  in this repo — standing it up is a separate concern from this epic. The ratchet in TASK-297 is a grep
  in `scripts/test-all.sh` instead. Adopting eslint properly is worth its own task.

**Corrections the scopers made to this epic's own evidence** (the fix changes, not just the line number):

- A `seq` column **cannot** be `@default(autoincrement())` — Prisma 6.19.1 rejects autoincrement on a
  non-id field on *both* providers (P1012, verified against a patched schema). It must be assigned by
  the application inside the transaction, with the unique index doing the serializing.
- `$transaction` alone does **not** fix the hash chain. Measured: on Postgres READ COMMITTED both
  transactions read the same head and both commit. The provider-independent guard is the UNIQUE
  constraint on `seq` plus a retry.
- `/deployments` and `/alerts` do **not** white-screen. `DemoFeaturePlaceholder` guards landed in #59
  (`bdea0ec6`) ahead of both hooks. The same defect is live elsewhere — `commandStore.ts:144` and
  `safetyStore.ts:109` — so section H stands, at different addresses.
- "Move to Warehouse A fails" understates C1: `navigation.ts:233` returns a fabricated `{x:25, y:25}`
  and `moveToLocation` reports **success**. The robot drives to a made-up spot and claims it arrived.
- There are **four** producers of `RobotStatus`, not three — the zod gate at `schemas.ts:21-28` is the
  fourth and must widen too, or the server rejects the value it now receives.
- `TENANT_SCOPED_MODELS` is not exported at all, and holds 27 entries, not 26. Exporting it is step one
  of TASK-285, not an assumption it can make.

### Explicitly rejected — do not re-raise

The refutation pass killed these 8. Recorded so they are not re-found:

- **`FederatedClient` writing to three routes that do not exist** — the code fact is true
  (`/rounds/:id/join`, `/gradients`, `/model` match no server route), **but the impact is nil**:
  `robot-agent/src/index.ts:283-287` wires `getLocalEpisodes` as `return []`, so `participate()` always
  takes the "No local episodes available" path and uploads nothing, and the subsystem is gated on
  `FEDERATED_ENABLED` (`:277`), set in no env, chart or workflow. Fix it when federated learning gets a
  real data source, not before. *This was the exemplar that prompted the sweep; it turned out to be the
  least important instance of its own class.*
- **"Active deployment" defined four times** — three of the four copies have no consumer at all
  (`selectActiveDeployments`, `useDeployments`, `fetchActiveDeployments` are referenced only by their
  own tests and barrel re-exports), and the two live paths both read `ACTIVE_DEPLOYMENT_STATUSES`, so
  they cannot disagree. Duplication inside dead code. *This corrects a follow-up wrongly carried over
  from the PR #316 review.*
- **`VlaSession` rows unreadable** — the read routes exist and work, they simply have no UI; the
  Art. 12 record is the hash-chained `ComplianceLog`, which has a full client surface.
- **GDPR refusal reasons discarded by the store** — the store rethrows and `NewRequestModal.tsx:85`
  renders `errorMessage(err, …)`, so the server's sentence does reach the subject.
- **Wrong status class on write handlers** — `isNotFoundError` has four consumers, all in
  `agentmodeStore`, none on the cited routes; nothing reads the status number.
- **`incident_created` broadcast to nobody** — true, but fetch-on-mount is the house pattern
  everywhere (alerts does the same); a live-updating list is a feature request.
- **Telemetry `cpuUsage ?? 0` and missing `robotType` column** — the only consumer
  (`TelemetryHistorySparklines.tsx:169`) reads neither field, and `cpuUsage` is undefined only for the
  first second of an agent's life.
- **"Extract a shared types package"** — process advice, not a defect; its showpiece claim (that the
  duplicated unions are verbatim identical) is false at the lines it cited.

### Boundary — a parallel session owns navigation

TASK-273 through TASK-280 (`feat/task-273-cut-the-navigation-from-23-rows-to-10`) are an active
navigation refactor. **Do not touch** `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*`
or `app/src/components/docs/DocsSidebar.tsx`. Note that TASK-276 folds digital twin into Fleet as a
Sites tab — coordinate slice 2 and slice 12's twin-deletion verdict with it, since both touch the
digital-twin feature from opposite ends (routing vs. server isolation and storage lifecycle).

**Key files:**
- `server/src/routes/{robot,approval,gdpr,zone,incident,twin}.routes.ts`
- `server/src/middleware/auth.middleware.ts`, `server/src/database/client.ts`, `server/src/utils/errors.ts`
- `server/src/repositories/{Approval,Incident,ComplianceLog,DigitalTwin}Repository.ts`
- `server/src/services/{DeploymentService,UpdateService,SafetyService}.ts`, `server/prisma/schema.prisma`
- `robot-agent/src/{updates/SecureUpdateClient,tools/navigation,agent-mode/peers,robot/TaskQueue,safety/SafetyMonitor}.ts`
- `app/src/features/{safety,approvals,deployment,processes,gdpr,incidents}/`, `app/src/mocks/handlers.ts`

## Acceptance Criteria

- [ ] A `viewer` token is refused on every write route; a test asserts the refusal per verb, not per middleware.
- [ ] The tenant allowlist is derived from `schema.prisma` and asserted against the real `TENANT_SCOPED_MODELS` export — adding a tenant-owned model without scoping it fails CI.
- [ ] `decidedBy`/`cancelledBy`/`escalatedBy` come from `req.user`; a request supplying a different one in the body is refused.
- [ ] "Open approval" is one exported constant, used by both sides; an escalated request still appears in the approver's queue and the overdue count.
- [ ] Concurrent compliance writes leave `verifyHashChain` valid — asserted by a `Promise.all` test.
- [ ] A robot in a protective stop does not read as Online anywhere in the fleet console, and a remote E-Stop or reset changes the dashboard's fleet Stop button without a reload.
- [ ] An unimplemented `actionType` marks the step failed, not completed; a process created in the UI carries a real action type.
- [ ] No `error instanceof Error` remains in a `catch` under `app/src/features/**/store/**`, enforced by lint; one store test rejects with a plain `{code,message,statusCode}`.
- [ ] No route handler puts raw `error.message` in a response body; a test throws a `PrismaClientKnownRequestError` through a handler and asserts no query text in the body.
- [ ] A deliberate rollback and a deliberate cancel are distinguishable from a crash in the deployment history.
- [ ] `/deployments` and `/alerts` → Incidents render an honest empty state in demo mode instead of white-screening.
- [ ] Each of the four subsystems in slice 12 has a recorded verdict; the ones not being shipped say so in-code.

## Test Strategy

- Every slice adds a test at the seam the existing tests mock — that is the defining property of this set. A fix whose only new test mocks the same boundary has not been tested.
- Two tests must exist in a two-tenant database with the real Prisma extension, not a re-implemented allowlist: the number generators and the `Zone` constraint.
- `./scripts/test-all.sh`; `npx tsc`, `npm run typecheck`, `npx vitest run` per component; Playwright for the demo-mode and safety-console slices.
- The auth slice needs a run with `AUTH_DISABLED` unset — the four agent clients in C1 are invisible in the configuration CI currently runs.

## Notes

Sweep run 2026-09-12: 7 finder agents + 7 adversarial refuters, 935 tool calls, ~2M tokens. 28
candidates → 8 refuted → 19 distinct confirmed (20 survivors, of which the deployment-status defect
was found independently by two lenses). Findings carry the refuter's severity, not the finder's.

The one structural recommendation worth keeping after the split: nothing in this repo asserts that two
declarations of the same contract agree. A CI check that diffs named unions across `app/`, `server/`
and `robot-agent/` would have caught C2, C3 and G before they shipped, at a fraction of the cost of
the shared-types package that was rejected above.
