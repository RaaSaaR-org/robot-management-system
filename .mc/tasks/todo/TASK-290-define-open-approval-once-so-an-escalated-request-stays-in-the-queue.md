---
id: "TASK-290"
aliases: []
title: "Define \"open approval\" once, so an escalated request stays in the queue"
slug: "define-open-approval-once-so-an-escalated-request-stays-in-the-queue"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [server, app, compliance]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Define "open approval" once, so an escalated request stays in the queue

## Description

"Open approval" is spelled out five times across the client and the repository and the copies disagree: the client counts `escalated` as open, every server query that means "still open" excludes it. Escalation is the SLA-breach path, so breaching an SLA makes a request vanish from the overdue set, from "pending for me" / "pending for role", and from the Overdue tile, while the queue on the same screen still lists it. This task makes one constant per side, replaces all copies with it, and pins the two sides together with a test.

## Details

### Current state

**Client.** `app/src/features/approvals/components/approvalFormat.ts:11` — `OPEN_STATUSES = ['pending','in_progress','escalated']`, read by `ApprovalQueue.tsx:73` (row actions) and `:127` (SLA sort), by `approvalFormat.ts:71` (`slaInfo`), and by `ApprovalsPage.tsx:35` (the "Pending" filter, sent as `GET /approvals?status=…`).

**Server.** `server/src/repositories/ApprovalRepository.ts` hardcodes `status: { in: ['pending','in_progress'] }` six times — `:298` `findPendingForUser`, `:318` `findPendingByRole`, `:340` `findOverdue`, `:357` `findNearingDeadline`, `:404` `findAll({overdue:true})`, `:611` `countOverdue`. All six confirmed at those lines.

**There are seven client copies, not three.** Beyond `approvalFormat.ts:11`, four more spell the set out independently:

- `app/src/features/approvals/hooks/useApprovals.ts:100` (`pendingCount`) — omits `escalated`
- `app/src/features/approvals/hooks/usePendingApprovals.ts:113` (fetch fallback) — omits `escalated`
- `app/src/features/approvals/store/approvalsStore.ts:361` (what stays in `pendingApprovals` after a decision) — omits `escalated`
- `app/src/features/approvals/components/ApprovalDetailModal.tsx:49` — spells it out inline and *does* include `escalated`

**Symptom.** `escalate()` (`ApprovalRepository.ts:549-574`) sets status `escalated` and **never moves `slaDeadline`**, so the row is permanently past its deadline yet matches no "open" query. It leaves `findOverdue` — walked by `ApprovalWorkflowService.ts:654` (`escalateOverdueApprovals`) and `:627` (`checkSLACompliance`) — so it is never re-escalated and stops emitting `sla_breach`; it drops out of `/approvals/pending/me` and `/approvals/pending/role/:role`; and `countOverdue` no longer counts it, so `metrics.overdueRequests` under-reports.

On `/compliance?tab=approvals` the screen contradicts itself: the queue lists the row (the client asks for `escalated`) while the Pending tile (`ApprovalsPage.tsx:81`) and the Overdue tile both exclude it.

**The dead guard** at `ApprovalWorkflowService.ts:658` (`if (request.status !== 'escalated')`) is evidence the author expected otherwise. Note `:657` is the stale *comment* above it ("Only escalate if not already escalated recently" — there is no recency check).

Statuses are declared in three places: `server/src/types/approval.types.ts:42-52`, `app/src/features/approvals/types/approval.types.ts:37-54`, and `server/prisma/schema.prisma:1392` (a plain `String` column plus a comment — no enum).

### Server

Add the constant next to the status list in `server/src/types/approval.types.ts` (after `ApprovalStatuses`, which ends at `:52`):

```ts
/** Statuses a human can still act on — the one definition of "open". */
export const OPEN_APPROVAL_STATUSES: ApprovalStatus[] = ['pending', 'in_progress', 'escalated'];
```

`expired` stays out **deliberately**: nothing in the server ever writes it (the only occurrence is the zero-seed in `countByStatus`, `ApprovalRepository.ts:594`), so adding it would widen the set on a status that cannot exist.

In `ApprovalRepository.ts`, add `OPEN_APPROVAL_STATUSES` to the value import at `:19-22` (which already pulls `SLA_HOURS`, `APPROVAL_TYPE_MAP`) and replace all six literals with `status: { in: [...OPEN_APPROVAL_STATUSES] }` — spread, so Prisma gets a fresh mutable array. All six mean the same thing; read each to confirm:

- `:298` / `:318` — already require a step with `status: 'awaiting'`, which an escalated request still has; the request-level filter is the only thing dropping it.
- `:340`, `:404`, `:611` — the three spellings of "open and past the deadline".
- `:357` `findNearingDeadline` — `slaDeadline: { gt: now }` can **never** match an escalated row (escalation only happens after the deadline and `escalate()` does not move it), so including `escalated` there is a no-op. Include it anyway so the six sites read identically, but do not expect a behaviour change from that one.

Leave two nearby sets alone, they are different notions: the terminal list at `:526` (`approved|rejected|cancelled` → `completedAt`) and the `countByStatus` seed at `:588-596`.

In `server/src/services/ApprovalWorkflowService.ts`, the guard at `:658` becomes live for the first time — keep it, and fix the stale comment at `:657`. Repeat/multi-level escalation is out of scope. No other service change: `getMetrics()` keeps `pendingRequests`/`inProgressRequests` as literal per-status counts (they are named after statuses) and already returns `requestsByStatus` (`:794`), which the client sums.

### Frontend

One definition, in `app/src/features/approvals/types/approval.types.ts` next to `ApprovalStatuses` (`:46-54`):

```ts
/** Statuses a human can still act on — mirrors OPEN_APPROVAL_STATUSES in server/src/types/approval.types.ts. */
export const OPEN_APPROVAL_STATUSES: ApprovalStatus[] = ['pending', 'in_progress', 'escalated'];
```

Then delete `OPEN_STATUSES` from `approvalFormat.ts:11`; `isOpen()` there imports the new constant and stays the single predicate. Update the importers:

- `ApprovalsPage.tsx:11,35` — import `OPEN_APPROVAL_STATUSES` from `'../types'`.
- `useApprovals.ts:100` — `approvals.filter((a) => isOpen(a.status)).length`.
- `usePendingApprovals.ts:113` — `{ status: OPEN_APPROVAL_STATUSES }`.
- `approvalsStore.ts:361` — replace the two `===` comparisons with `isOpen(updatedRequest.status)`.
- `ApprovalDetailModal.tsx:49` — `Boolean(currentStep) && isOpen(approval.status)`.

`ApprovalQueue.tsx:18,73,127` already goes through `isOpen` — no change.

**The Pending tile needs a client-side fix; the repository change does not reach it.** `ApprovalsPage.tsx:81` currently reads `metrics.pendingRequests + metrics.inProgressRequests`, which are per-status tallies from `countByStatus`. Make it sum `metrics.requestsByStatus` over `OPEN_APPROVAL_STATUSES` (the payload already carries `requestsByStatus`; see `ApprovalMetrics` in `app/src/features/approvals/types/approval.types.ts:335-348`). The Overdue tile needs no client change — it reads `metrics.overdueRequests`, which the server fix corrects.

Keep the barrel shape: `app/src/features/approvals/types/index.ts` is `export * from './approval.types'`, so the new constant is reachable as `from '../types'` with no barrel edit. Named exports only; any new file carries the `@file`/`@description`/`@feature approvals` header.

**Key files:**
- `server/src/types/approval.types.ts` — add `OPEN_APPROVAL_STATUSES` after `ApprovalStatuses` (`:52`)
- `server/src/repositories/ApprovalRepository.ts` — replace the six literals at `:298`, `:318`, `:340`, `:357`, `:404`, `:611`
- `server/src/services/ApprovalWorkflowService.ts` — keep the now-live guard at `:658`, fix the stale comment at `:657`
- `app/src/features/approvals/types/approval.types.ts` — add the mirrored `OPEN_APPROVAL_STATUSES`
- `app/src/features/approvals/components/approvalFormat.ts` — drop `OPEN_STATUSES`, `isOpen` reads the constant
- `app/src/features/approvals/pages/ApprovalsPage.tsx` — import path at `:11`/`:35`, Pending tile math at `:81`
- `app/src/features/approvals/hooks/useApprovals.ts` — `pendingCount` at `:100` uses `isOpen`
- `app/src/features/approvals/hooks/usePendingApprovals.ts` — fetch filter at `:113`
- `app/src/features/approvals/store/approvalsStore.ts` — pending retention at `:361`
- `app/src/features/approvals/components/ApprovalDetailModal.tsx` — actionable check at `:49`
- `server/src/repositories/__tests__/ApprovalRepository.open-statuses.test.ts` — NEW real-SQLite test
- `server/src/__tests__/approval-open-statuses.test.ts` — NEW client/server agreement test
- `server/src/repositories/__tests__/ApprovalRepository.test.ts` — where-clause assertions at `:347`, `:362`, `:382`, `:477`, `:701`
- `server/src/services/__tests__/ApprovalWorkflowService.test.ts` — `escalateOverdueApprovals` block at `:821-894`
- `app/src/features/approvals/components/__tests__/approvalFormat.test.ts` — NEW, the first test for this file
- `app/src/features/approvals/store/__tests__/approvalsStore.test.ts` — `processApproval` cases at `:284-316`

## Acceptance Criteria

- [ ] `grep -n "'pending', 'in_progress'" server/src/repositories/ApprovalRepository.ts` returns nothing; all six queries read `OPEN_APPROVAL_STATUSES`.
- [ ] A new test against a real temp SQLite DB seeds an escalated request with a past `slaDeadline` and an `awaiting` step, and asserts it is returned by `findOverdue()`, `findPendingForUser()`, `findPendingByRole()` and `findAll({ overdue: true })`, and counted by `countOverdue()`.
- [ ] A test reads `app/src/features/approvals/types/approval.types.ts` from `server/src/__tests__/` and fails if its open-status list differs from the server's `OPEN_APPROVAL_STATUSES`.
- [ ] `escalateOverdueApprovals()` given one escalated and one pending overdue request escalates only the pending one — proving the guard at `ApprovalWorkflowService.ts:658` now runs on rows it can actually see.
- [ ] No component, hook or store in `app/src/features/approvals/` spells out the open set: `grep -rn "'in_progress'" app/src/features/approvals --include='*.ts*'` hits only `approval.types.ts`.
- [ ] With one escalated request in the database, the Pending tile on `/compliance?tab=approvals` counts it and the Overdue tile counts it, matching the row the queue already shows.
- [ ] `cd server && npm run typecheck && npx vitest run src/repositories src/services/__tests__/ApprovalWorkflowService.test.ts src/__tests__/approval-routes.test.ts` and `cd app && npx vitest run src/features/approvals` both pass.

## Test Strategy

The seam is mocked twice, on both sides of the bug.

**1. The repository test asserts the defect as the contract.** `server/src/repositories/__tests__/ApprovalRepository.test.ts` mocks the Prisma client (header `:23-26`) and asserts the *literal* where clause: `:347` and `:362` expect `status: { in: ['pending','in_progress'] }` inside a full `toHaveBeenCalledWith`, and `:382` (`findOverdue`), `:477` (`findAll` overdue filter) and `:701` (`countOverdue`) assert the same array. The suite is green while the query is wrong.

Replacement: update those five assertions to compare against the **imported** `OPEN_APPROVAL_STATUSES` (never a retyped literal), and add `server/src/repositories/__tests__/ApprovalRepository.open-statuses.test.ts` that runs the real queries against a real DB — copy the temp-SQLite setup from `server/src/database/__tests__/client.test.ts:185-205` (`mkdtempSync` + `execSync('npx prisma db push --schema=… --skip-generate --accept-data-loss')`, `rmSync` in `afterAll`) and the raw-seed helper shape at `:740-758`. Seed three rows — pending/overdue, escalated/overdue (with an `awaiting` step assigned to a user and a second unassigned one with `approverRole`), approved — and assert what `findOverdue`, `countOverdue`, `findPendingForUser`, `findPendingByRole` and `findAll({overdue:true})` actually return. This is the test the fix needs: it goes through Prisma instead of asserting the string the fix changes.

**2. The service test feeds the guard input production cannot produce.** `server/src/services/__tests__/ApprovalWorkflowService.test.ts` mocks the repository wholesale (`vi.mock` at `:22-35`), so `escalateOverdueApprovals` is tested against a hand-fed `findOverdue`. The case at `:855` ("skips already-escalated requests") feeds it an escalated row the real query can never return. Keep it — it becomes truthful — and add a case with both an escalated and a pending overdue row, asserting `escalate` is called once, for the pending id.

**3. Client: there is no test at all.** `app/src/features/approvals/components/` has **no `__tests__` directory** — `OPEN_STATUSES`, `isOpen` and `slaInfo` have never been tested, so nothing there mocks anything. Add `approvalFormat.test.ts` (pure functions; pattern: `app/src/shared/utils/__tests__/format.test.ts`) covering `isOpen('escalated') === true` and `slaInfo` returning an overdue label, not `'Closed'`, for an escalated request. In `app/src/features/approvals/store/__tests__/approvalsStore.test.ts`, extend the `processApproval` block (`:284-316`, which today only covers `in_progress`) with an escalated result that must stay in `pendingApprovals`.

**4. Agreement test.** `server/src/__tests__/approval-open-statuses.test.ts` reads the app types file with `readFileSync` and fails if the two lists differ. Pattern to copy: `server/src/__tests__/TourService.test.ts:545-556` (`path.resolve(__dirname, '../..')` + `readFileSync`; `__dirname` works in server vitest despite `"type": "module"`, as that test proves). The path goes one level further up: `path.resolve(__dirname, '../../../app/src/features/approvals/types/approval.types.ts')`. It **must** live server-side: the app's tsconfig carries no Node types, which is why `app/src/__tests__/design-drift.test.ts:14-17` reads files through `import.meta.glob` instead, and that glob cannot leave the Vite root.

## Notes

**Why duplicate the constant instead of sharing it.** The app cannot import from `server/` — separate tsconfigs, no path alias, and a jsdom test environment without Node types. Extracting a shared types package was **explicitly rejected** by the epic (TASK-281, "Explicitly rejected — do not re-raise"). So the shape here is: one constant per side plus the cross-package agreement test in strategy item 4, which is the enforcement. That is the pattern a later "declared twice" task can reuse.

**Merge ordering: sequence this after TASK-289; do not run the two concurrently.** They collide in four files at distinct lines — `useApprovals.ts` (289 owns `actorId` at `:85`, this task owns `pendingCount` at `:100`), `approvalsStore.ts` (289 owns the cancel/escalate signatures at `:98-103`/`:373`, this task owns the pending-retention filter at `:361`), both packages' `approval.types.ts`, and `approvalsStore.test.ts`. This is ordering only — it is **not** a `depends_on` edge, and `depends_on` is deliberately empty.

Expected behaviour change beyond the fix: `checkSLACompliance` (`ApprovalWorkflowService.ts:627`) will now emit `sla_breach` on every tick for escalated rows too. That repetition already exists for pending overdue rows, so it is the same class of noise, not a new one — do not add deduplication here.

A parallel session owns the navigation refactor (TASK-273 through TASK-280). Nothing here touches `app/src/components/layout/{Sidebar,NavList,MobileNav,navigation}.*` or `app/src/components/docs/DocsSidebar.tsx`.
