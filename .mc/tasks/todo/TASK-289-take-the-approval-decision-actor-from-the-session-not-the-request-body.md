---
id: "TASK-289"
aliases: []
title: "Take the approval decision actor from the session, not the request body"
slug: "take-the-approval-decision-actor-from-the-session-not-the-request-body"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [core, compliance, server, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Take the approval decision actor from the session, not the request body

## Description

The approvals audit trail records whoever the client claims decided: `decidedBy`, `cancelledBy` and `escalatedBy` are read straight out of `req.body`, so any authenticated caller can attribute an EU AI Act Art. 14 decision to a colleague, and a client with no loaded user writes the literal string `unknown-reviewer` into the oversight record. This task takes the actor from the authenticated session on the three decision routes, refuses a body-supplied actor with 400, and stops the frontend from sending one.

## Details

### Current state

`server/src/routes/approval.routes.ts` has **zero** `req.user` references, although it is mounted behind `authMiddleware` (`server/src/app.ts:275`).

- decide: `const { decision, decidedBy, ... } = req.body;` (`:211`), validated only as non-empty (`:220-222`), passed through at `:228`.
- cancel: `const { cancelledBy, reason } = req.body;` (`:248`), non-empty check `:250`, passed at `:254`.
- escalate: `const { escalatedBy, reason } = req.body;` (`:274`), check `:276`, passed at `:280`.

The value is persisted verbatim. `ApprovalWorkflowService.ts:205/:217/:229` pass it to `approvalRequestRepository.updateStatus(...)`, which writes the immutable status-history row at **`ApprovalRepository.ts:534`** (`changedBy`) for the decide and cancel paths; escalate writes its own row at **`:567`**; the step's own actor column is written at **`:651`** (`decidedBy: input.decidedBy`); and the emitted event stamps it as `userId` at `ApprovalWorkflowService.ts:247`.

Three client sites compute the actor as `user?.email ?? user?.id ?? 'unknown-reviewer'`:

- `app/src/features/approvals/components/ApprovalDetailModal.tsx:32` — sent at `:69` (approve) and `:86` (reject)
- `app/src/features/approvals/components/ApprovalQueue.tsx:37` — sent at `:47` (escalate) and `:64` (cancel)
- `app/src/features/approvals/hooks/useApprovals.ts:85` — sent at `:130` (cancel) and `:137` (escalate). **This third site is easy to miss and must change too, or the actor keeps flowing.**

`req.user` is `AuthUser` (`server/src/middleware/auth.middleware.ts:28-43`): `id`, `email`, `name`, `role`, `tenantId`, optional `authType`/`tokenId`, filled from the JWT payload at `:291-298`. Under `AUTH_DISABLED=true` (the dev default, `server/.env.example:22`) `authMiddleware` injects `MOCK_USER` (`auth.middleware.ts:56-62`): `id: 'dev-user-id'`, `email: 'dev@neodem.local'` — so a session-derived actor never hard-fails dev.

Stored values today are emails (the client prefers `user?.email`; the app dev user is `dev@neodem.local`, `app/src/mocks/mockData.ts:20-30`). **Nothing queries `decidedBy` or `changedBy`** — no filter, no lookup, no seed data anywhere in `server/src/database/`. They are display-only: `ApprovalDetailModal.tsx:146` renders `step.decidedByUser?.name ?? step.decidedBy` and `:183` renders `h.changedBy` raw.

**`decidedByUser` is never populated.** `ApprovalRepository.dbApprovalStepToDomain` (`:117-136`) does not map it and no relation exists in `server/prisma/schema.prisma` (`ApprovalStep.decidedBy` is a plain `String`). So `ApprovalDetailModal.tsx:146` always renders the stored string raw — there is no name lookup to fall back on.

### Server

In `server/src/routes/approval.routes.ts`:

1. Import `type AuthenticatedRequest` from `../middleware/auth.middleware.js` and type the three handlers `(req: AuthenticatedRequest, res: Response)`.
2. Add one module-local helper next to the existing section banner, copying the shape of `server/src/routes/team.routes.ts:32-33`:

   ```ts
   function resolveActor(req: AuthenticatedRequest): string | null {
     return req.user?.id ?? null;
   }
   ```

   **Persist the user id, not the email.** `server/prisma/schema.prisma:1088` documents `changedBy` as "User ID who made the change", `team.routes.ts:32` uses `req.user?.id`, and the impersonation compliance log uses `actorId: user.id` (`auth.middleware.ts:116`). Emails are re-assignable; ids are the audit key. Nothing queries the column, so this is not a functional break.
3. decide (`:207-239`): before anything else, if `'decidedBy' in (req.body ?? {})` return 400 `{ error: "decidedBy is not accepted — the decision actor is taken from the authenticated session" }`. Then `const actor = resolveActor(req); if (!actor) return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });` — an Art. 14 record must never be written without an actor. Keep the existing `validDecisions` check. Pass `decidedBy: actor` into `approvalWorkflowService.processApproval`. Delete the `!decidedBy` 400 at `:220-222` and the `decidedBy` destructure at `:211`.
4. cancel (`:245-265`): the same two guards for `cancelledBy`; `reason` stays required (keep a 400 saying `reason is required`); call `cancelApprovalRequest(id, actor, reason)`.
5. escalate (`:271-291`): the same two guards for `escalatedBy`; `reason` stays optional; call `escalateRequest(id, actor, reason)`.
6. Update the three JSDoc body comments (`:205`, `:243`, `:269`) to drop the actor field.

Do **not** change `ApprovalWorkflowService`, `ApprovalRepository`, or `ProcessApprovalInput` (`server/src/types/approval.types.ts:334-342`) — the actor is still a `string`, it just now originates at the trust boundary. No Prisma migration.

### Frontend

Remove every actor the approvals feature sends. All paths under `app/src/features/approvals/`:

1. `components/ApprovalDetailModal.tsx`: delete the `decidedBy` const (`:32`) and the `decidedBy,` properties in the approve (`:69`) and reject (`:86`) payloads; drop the now-unused `useAuthStore` import (`:10`).
2. `components/ApprovalQueue.tsx`: delete `const actor = ...` (`:37`) and the `useAuthStore` import (`:15`); call `escalate(r.id, 'Escalated manually from the approval queue')` (`:47`) and `cancel(r.id, 'Cancelled from the approval queue')` (`:64`).
3. `hooks/useApprovals.ts`: delete `actorId` (`:85`) and the `useAuthStore` import/selector (`:8`, `:84`); `cancelApproval(id, reason)` → `storeCancelApproval(id, reason)` (`:128-133`) and `escalateApproval(id, reason?)` → `storeEscalateApproval(id, reason)` (`:135-140`), dropping `actorId` from both dependency arrays.
4. `store/approvalsStore.ts`: narrow the action types (`:98-107`) and implementations (`:373-408`) to `cancelApprovalRequest(id: string, reason: string)` and `escalateApprovalRequest(id: string, reason?: string)`.
5. `api/approvalsApi.ts`: `cancelApprovalRequest(id, reason)` posts `{ reason }` (`:177-187`); `escalateApprovalRequest(id, reason?)` posts `{ reason }` (`:192-202`).
6. `types/approval.types.ts`: remove `decidedBy: string;` from `ProcessApprovalInput` (`:254-260`). Leave the read-only display fields alone — `ApprovalStep.decidedBy` (`:147`), `decidedByUser` (`:159`) and `ApprovalStatusHistory.changedBy` (`:167`) are what the server returns.

Display is unchanged: `ApprovalDetailModal.tsx:146` and `:183` keep rendering whatever string the server stored.

Nothing else in the app calls these actions — `pages/ApprovalsPage.tsx` renders `ApprovalQueue`/`ApprovalDetailModal` and uses only store selectors; `useApprovals` is exported from `hooks/index.ts` but has no consumer today.

**Key files:**
- `server/src/routes/approval.routes.ts` — `resolveActor` helper, 400 on a body actor, 401 on no session, three handlers typed `AuthenticatedRequest`
- `server/src/__tests__/approval-routes.test.ts` — drop the auth-middleware mock, mount the real middleware, add token/`AUTH_DISABLED`/401 cases
- `server/src/routes/team.routes.ts` — read-only: the `resolveActorId` pattern to copy (`:28-33`)
- `server/src/middleware/auth.middleware.ts` — read-only: `AuthUser` shape (`:28-43`), `MOCK_USER` (`:56-62`)
- `server/src/__tests__/auth-middleware.test.ts` — read-only: the `resetModules` + `AUTH_DISABLED` env pattern (`:24-60`)
- `app/src/features/approvals/components/ApprovalDetailModal.tsx` — stop sending `decidedBy`
- `app/src/features/approvals/components/ApprovalQueue.tsx` — stop sending the actor to cancel/escalate
- `app/src/features/approvals/hooks/useApprovals.ts` — drop `actorId` and its dependency arrays
- `app/src/features/approvals/store/approvalsStore.ts` — narrow the cancel/escalate signatures
- `app/src/features/approvals/api/approvalsApi.ts` — post only `{ reason }`
- `app/src/features/approvals/types/approval.types.ts` — drop `decidedBy` from `ProcessApprovalInput`
- `app/src/features/approvals/store/__tests__/approvalsStore.test.ts` — update the cancel/escalate call assertions
- `app/src/features/approvals/api/__tests__/approvalsApi.test.ts` — new: request bodies carry no actor

## Acceptance Criteria

- [ ] `POST /api/approvals/:id/steps/:stepId/decide` with `decidedBy` anywhere in the body returns 400 and `approvalWorkflowService.processApproval` is never called.
- [ ] With a JWT for a user whose id differs from every string in the body, the same route makes `processApproval` receive `decidedBy` equal to that token user id.
- [ ] `POST /api/approvals/:id/cancel` and `/:id/escalate` return 400 when the body carries `cancelledBy` / `escalatedBy`, and otherwise pass the token user id as the actor to `cancelApprovalRequest` / `escalateRequest`.
- [ ] With `AUTH_DISABLED=true` and no `Authorization` header, decide, cancel and escalate all succeed and record the actor `dev-user-id`.
- [ ] With `AUTH_DISABLED=false` and no `Authorization` header, all three routes return 401 and no service method is called.
- [ ] `grep -rn "unknown-reviewer" app/src` returns nothing, and no file under `app/src/features/approvals` sends an actor field in a request body.
- [ ] `./scripts/test-all.sh --skip-pw` passes typecheck and vitest for server and app.

## Test Strategy

**The test that mocks the broken seam** is `server/src/__tests__/approval-routes.test.ts:43-49`: it replaces the real auth middleware with a stub that sets `req.user = { id: 'user-123', email: 'test@example.com', ... }`, and then every decision case sends the **same string** in the body (`decidedBy: 'user-123'` at `:344`, `:360`, `:380`; `cancelledBy` at `:397`, `:410`, `:421`, `:431`; `escalatedBy` at `:449`, `:471`, `:482`) and asserts the service received `'user-123'` (`:347-354`, `:400-404`, `:452-456`). Body value and session identity are one string, so the test cannot tell which one the route used — and `:366-373` actively asserts the broken contract ("returns 400 when decidedBy missing").

Replace it: in that file, delete the `vi.mock('../middleware/auth.middleware.js', ...)` block and mount the **real** `authMiddleware`, following `server/src/__tests__/auth-middleware.test.ts:24-60` (`vi.resetModules()`, set `process.env.AUTH_DISABLED`, then dynamic `await import('../middleware/auth.middleware.js')`; restore env in `afterEach`). `server/vitest.config.ts:14-17` already supplies `JWT_SECRET: 'test-secret-key-for-tests'` and `AUTH_DISABLED: 'true'`. Keep the `ApprovalWorkflowService` mock — the service is not the seam under test.

New cases for decide, cancel and escalate:

1. `AUTH_DISABLED=false` + `Authorization: Bearer <jwt.sign({ userId: 'token-user', email: 'a@b.c', name: 'A', role: 'member' }, process.env.JWT_SECRET)>` and a body naming a different person (`decidedBy: 'victim@corp'`) → 400, service not called.
2. Same token, clean body → the service receives the actor `'token-user'` — a string that appears nowhere in the request body.
3. `AUTH_DISABLED=true`, no header → the actor is `'dev-user-id'` (`auth.middleware.ts:56-62`).
4. `AUTH_DISABLED=false`, no header → 401, service not called.

Rewrite `:366-373` to assert the 400 **refusal** instead of the 400 requirement.

App side: `app/src/features/approvals/store/__tests__/approvalsStore.test.ts` mocks `../../api` (`:10-31`) and asserts `cancelApprovalRequest('cr', 'me', 'reason')` (`:330`) and `escalateApprovalRequest('er', 'me', 'why')` (`:346`) — fixture actors; update both to the two-argument calls. There is **no component test for `ApprovalDetailModal` or `ApprovalQueue`** — `app/src/features/approvals/components/` has no `__tests__` directory at all — so add `app/src/features/approvals/api/__tests__/approvalsApi.test.ts` mocking `@/api/client` in the style of `app/src/features/robots/api/__tests__/cameraApi.test.ts:9-14`, asserting the POST bodies for cancel/escalate are exactly `{ reason }` and that the decide payload carries no `decidedBy`.

## Notes

Storing the id means the detail modal shows `dev-user-id` or a uuid instead of an email until `decidedByUser` is populated — the UI slot for the human label already exists (`ApprovalDetailModal.tsx:146`); filling it is a follow-up, not this task.

**Same defect shape, deliberately NOT scoped here** — worth its own follow-up task, too many to fold in:

- `server/src/routes/approval.routes.ts`: `/pending/me` (`:138`, userId from the query, with a "TODO: Get from auth"), `acknowledgedBy` (`:350`), `respondedBy` (`:381`), `processedBy` (`:521`), `requestedBy` (`:97`)
- `server/src/routes/oversight.routes.ts`: `:30`, `:56`, `:170`, `:319`, `:341` (`req.body.operatorId || 'system'`, each with a TODO)
- `server/src/routes/gdpr.routes.ts`: 8 sites (`req.body.userId || 'current-user'`)
- `server/src/routes/legal-hold.routes.ts:59` (`createdBy`)
- `server/src/routes/process.routes.ts`: `:86`, `:207` (hardcoded `'system'`)

**Merge ordering:** TASK-290 ("Define \"open approval\" once") edits four of the same app files at distinct lines — `useApprovals.ts`, `approvalsStore.ts`, both `approval.types.ts` files and `approvalsStore.test.ts`. Land this task first; do not run the two concurrently.

A parallel session owns the navigation refactor (TASK-273 through TASK-280). This task touches no navigation file — not `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*` and not `app/src/components/docs/DocsSidebar.tsx`.
