---
id: "TASK-299"
aliases: []
title: "Record deployment rollback and cancel as themselves, not as failures"
slug: "record-deployment-rollback-and-cancel-as-themselves-not-as-failures"
status: "in-progress"
priority: 3
owner: "huhn511"
projects: []
customers: []
tags: [core, server, app]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Record deployment rollback and cancel as themselves, not as failures

## Description

A successful rollback and a deliberate cancel both end as `status: 'failed'`, so the deployment history cannot tell a controlled withdrawal from an uncontrolled one — in the trail that serves as post-market monitoring evidence. Add `rolled_back` and `cancelled` to the server's status union and write them from the two paths that earn them, drop the unreachable `completed` from the app union, and replace the tests that mock the repository seam with a stateful fake that reads the stored row back.

## Details

### Current state

`server/src/services/DeploymentService.ts:375` ends a *completed* rollback with `status: 'failed'`; `cancelDeployment()` does the same at `:410`. Those are the only two writers of `'failed'` in the repo — the other status writes are `:218` `'deploying'`, `:348` `'rolling_back'`, and `:307`/`:510` `'production'`/`'canary'`.

**Stronger than it first looks: no code writes `'failed'` for a genuine failure either.** The declared event `'deployment:failed'` (`server/src/types/deployment.types.ts:32`) is never emitted anywhere, and a rollout whose robots all refuse the switch stays `'canary'`. So today a red "Failed" row means exactly "someone withdrew it" or "auto-rollback fired" — never "the rollout broke".

`server/src/types/vla.types.ts:61-69` declares six statuses; `app/src/features/deployment/types/deployment.types.ts:11-21` declares nine, so `'completed'`, `'rolled_back'` and `'cancelled'` can never arrive. The app already styles them: `app/src/shared/components/ui/statusTone.ts:71` maps `rolled_back` → warning and `:94` `cancelled` → neutral, and `StatusTag` derives the label via `humanizeStatus` (`StatusTag.tsx:56-57`). The moment the server sends the values, the UI renders "Rolled back" and "Cancelled" correctly.

`DeploymentService.ts:364-371` already collects `rollbackResults` and never reads it — the per-robot rollback outcome is available today and thrown away. That is exactly what makes the `rolled_back`-vs-`failed` distinction free.

No other service writes `Deployment.status` — `DeploymentMetricsService.ts:371` only reads it. `VLARepository.ts:1439` passes the string through untouched and `:398` casts `db.status as DeploymentStatus`. `status` is `String @default("pending")` at `server/prisma/schema.prisma:2553`, so **no migration is needed**.

User-visible symptom: in Deployments → History (`app/src/features/deployment/components/DeploymentsSection.tsx:90`, rows via `inScope`/`deployToneFor`) a deliberate cancel, a deliberate rollback and a crashed rollout are the same red "Failed" row.

### Server

Add the two terminal values to `DeploymentStatuses` in `server/src/types/vla.types.ts:61-68` → `['pending','deploying','canary','production','rolling_back','failed','rolled_back','cancelled']`.

**Do NOT add `'completed'`**: the server ends a successful rollout as `'production'` (`DeploymentService.ts:307`, `:510`) and nothing else means "completed".

In `server/src/services/DeploymentService.ts`:

1. `rollback()` (`:333-390`). Use the `rollbackResults` collected at `:364-371`. After the robot loop, write `status: rollbackResults.every(r => r.success) ? 'rolled_back' : 'failed'` together with `completedAt: new Date()` at `:374-377`. The zero-attempt case (no previous version recorded, e.g. after a server restart) counts as `'rolled_back'`. Leave `deployedRobotIds`/`failedRobotIds` alone — `failedRobotIds` means "failed to receive the deployment" and must not be overloaded. Log the ids whose rollback failed next to the existing `console.log` at `:388`.
2. `cancelDeployment()` (`:395-422`): write `status: 'cancelled'` at `:410`.
3. Leave the guards at `:339` and `:401` as they are — a deployment in a terminal status must still be un-rollbackable and un-cancellable, and `'rolled_back'`/`'cancelled'` are not in either list.
4. Leave `findActive()` (`server/src/repositories/VLARepository.ts:1403-1412`, `['deploying','canary','production']`) untouched: both new values are terminal and belong in history, not in `GET /api/deployments/active` (`deployments.routes.ts:93`). `buildWhereClause` (`:1465-1483`) passes any status filter straight to Prisma, so `?status=rolled_back` works with no change.

Comment-only edits, no behaviour: `server/prisma/schema.prisma:2553` — extend the enumerating comment to the eight values (the column stays `String`; **no migration, no new file under `server/prisma/migrations/`**). `server/src/routes/deployments.routes.ts:281` — the comment "Stop monitoring (deployment failed)" should read "(rollout withdrawn)".

### Frontend

In `app/src/features/deployment/types/deployment.types.ts`: remove `'completed'` from `DeploymentStatuses` (`:18`) and from `DEPLOYMENT_STATUS_LABELS` (`:61`) and `DEPLOYMENT_STATUS_COLORS` (`:73`), leaving the eight the server can write. `tsc` then flags the dead branch at `app/src/features/deployment/components/deploymentHelpers.ts:94` (`d.status === 'production' || d.status === 'completed'`) — drop the `'completed'` half. Both maps are re-exported from `app/src/features/deployment/index.ts:86-87`; no consumer outside the feature imports them (`DEPLOYMENT_STATUS_LABELS` in `app/src/features/updates/types/updates.types.ts:22` is a different, unrelated type).

Leave `ACTIVE_DEPLOYMENT_STATUSES` (`deploymentHelpers.ts:12-18`) as it is: `inScope()` (`:26-29`) defines history as "not active", so a `rolled_back` or `cancelled` row already lands in the History tab and out of the Active count on `DeploymentsPage.tsx:135`. Leave `deployToneFor` (`:35-49`) alone too — `'rolled_back'` is handled at `:43` and `'cancelled'` falls through to `undefined`, which makes `StatusTag` derive neutral from `statusTone.ts:94`.

**Two stale duplicates of the same split would silently drop the new values** — both filter `d.status === 'production' || d.status === 'failed'`:

- `app/src/features/deployment/store/deploymentStore.ts:680-681` `selectCompletedDeployments`
- `app/src/features/deployment/hooks/useDeployments.ts:80-85` `completedDeployments`

Change each to `state.deployments.filter((d) => !isActiveDeployment(d))` (import `isActiveDeployment` from `'../components/deploymentHelpers'`), so there is one definition of the split. Do not delete the exports.

No change needed in `DeploymentsSection.tsx`, `DeploymentDetailPage.tsx` or `deploymentStore.ts`'s `handleDeploymentEvent` (`:624-634` already replaces the row on `'deployment:rollback:completed'` and `'deployment:cancelled'`).

**Key files:**
- `server/src/types/vla.types.ts` — add `'rolled_back'` and `'cancelled'` to `DeploymentStatuses` (`:61-68`)
- `server/src/services/DeploymentService.ts` — write `rolled_back`/`failed` at `:374-377`, `cancelled` at `:410`
- `server/src/services/__tests__/DeploymentService.test.ts` — stateful fake repository; rewrite the three tests asserting `'failed'`
- `server/src/repositories/__tests__/VLARepository.test.ts` — add an `update({status:'rolled_back'})` case next to `:1161`
- `server/prisma/schema.prisma` — extend the status comment at `:2553`; no migration
- `server/src/routes/deployments.routes.ts` — stale comment at `:281`
- `app/src/features/deployment/types/deployment.types.ts` — drop `'completed'` from the union, labels and colors
- `app/src/features/deployment/components/deploymentHelpers.ts` — drop the dead `'completed'` branch at `:94`
- `app/src/features/deployment/store/deploymentStore.ts` — `selectCompletedDeployments` (`:680`) derives from `isActiveDeployment`
- `app/src/features/deployment/hooks/useDeployments.ts` — `completedDeployments` (`:80-85`) derives from `isActiveDeployment`
- `app/src/features/deployment/store/__tests__/deploymentStore.test.ts` — the rollback fixture at `:266-275` asserts `'failed'`
- `app/src/features/deployment/components/__tests__/DeploymentsSection.test.tsx` — new: History renders three distinct terminal rows

## Acceptance Criteria

- [ ] `DeploymentStatuses` in `server/src/types/vla.types.ts` lists exactly `pending`, `deploying`, `canary`, `production`, `rolling_back`, `failed`, `rolled_back`, `cancelled`, and `app/src/features/deployment/types/deployment.types.ts` lists the same eight (no `'completed'`).
- [ ] A rollback whose robot switches all succeed persists `status: 'rolled_back'` with `completedAt` set, and the deployment carried on the emitted `'deployment:rollback:completed'` event has that status.
- [ ] A rollback in which at least one `rollbackRobot` result has `success === false` persists `status: 'failed'`.
- [ ] `cancelDeployment()` persists `status: 'cancelled'`, and the deployment on the emitted `'deployment:cancelled'` event has it.
- [ ] The DeploymentService rollback and cancel tests read the status back out of a stateful fake repository row rather than asserting on a `vi.fn` call argument.
- [ ] `grep -rn "'completed'" app/src/features/deployment` returns no deployment-status usage, and `reachedStages()` in `deploymentHelpers.ts` has no `'completed'` branch.
- [ ] `selectCompletedDeployments` and `useDeployments().completedDeployments` both return a deployment whose status is `'rolled_back'` and one whose status is `'cancelled'`.
- [ ] `cd server && npm run typecheck && npx vitest run` and `cd app && npx tsc && npx vitest run` pass, and `git status` shows no new file under `server/prisma/migrations/`.

## Test Strategy

The seam is mocked three times over, which is why the bug survived.

1. **`server/src/services/__tests__/DeploymentService.test.ts:37-50`** replaces `../../repositories/index.js` with `vi.fn()`s, and `:154-157` makes `deploymentRepository.update` echo the patch back through `makeDeployment`. Three tests then assert the bug as the contract: `:467-488` ("marks deployment failed and emits rollback events") asserts `update` was last called with `{ status: 'failed' }` and `result.status === 'failed'`; `:512-528` asserts the same for cancel; `:636-639` asserts it for the auto-rollback path.
   **Replacement:** swap the echo mock for a stateful fake — a `const rows = new Map<string, Deployment>()` seeded in each test, `findById` reading from it, `update` merging the patch into the stored row and returning it. Pattern to copy: the `checkpointRows` Map at `server/src/services/__tests__/TrainingOrchestrator.test.ts:88-94`, which exists for exactly this reason. Then assert on `rows.get('dep-1')!.status` and on the status of the deployment attached to the emitted event, not on a call argument: `'rolled_back'` when every `rollbackRobot` succeeds (`httpPost` resolving `{ status: 'switched' }` with a previous version recorded via a first deploy), `'cancelled'` after cancel, and `'failed'` when `httpPost` resolves `{ status: 'error' }` for one robot.
2. **`server/src/repositories/__tests__/VLARepository.test.ts:1161-1178`** proves `update({ status: 'production' })` reaches prisma. Add the sibling case for `'rolled_back'` — it proves the free-form String column takes the new value with no migration. (`:1153` already passes `'rolled_back' as never` to `findByStatus`; the `as never` cast can go once the union includes it.)
3. **`server/src/__tests__/deployments-routes.test.ts:14-24`** mocks the whole `DeploymentService` (`rollback`, `cancelDeployment` as `vi.fn()`), so the route test can never observe a status. Leave it; it is the wrong layer, and adding an assertion there would mock the same boundary again.
4. **`app/src/features/deployment/store/__tests__/deploymentStore.test.ts:266-275`** mocks `deploymentApi.rollbackDeployment` to resolve a deployment with `status: 'failed'` — the fixture encodes the bug. Change it to `'rolled_back'` and add an assertion that the row is no longer `isActiveDeployment`.
5. Add `app/src/features/deployment/components/__tests__/DeploymentsSection.test.tsx`: render the section with three finished deployments (failed, rolled_back, cancelled), switch the `SegmentedControl` to History, and assert three distinct visible labels — "Failed", "Rolled back", "Cancelled". Use `renderWithProviders` from `app/src/test/utils.tsx` (the component calls `useNavigate`, so it needs the router wrapper); copy the shape from `app/src/features/tour/components/__tests__/RunDetail.test.tsx`.

## Notes

`app/src/features/deployment/components/RollbackFormModal.tsx:35` tells the operator the rollback reason "goes into the audit log", but **nothing persists it**: `DeploymentService.ts:357` `console.log`s it and the WebSocket event carries it. The `Deployment` model has no `reason` column. Out of scope here — it needs a schema change — but it is the second half of the same compliance gap, and worth a follow-up task.

The `'deployment:failed'` event type is declared but never emitted; giving it a real emitter (a rollout that genuinely breaks) is a separate slice — do not add one here, or the `rolled_back`-vs-`failed` rule above stops being testable in isolation.

`selectCompletedDeployments` (`deploymentStore.ts:680`) and the whole `useDeployments` hook are dead exports — barrel-exported, used only by their own tests. Keep the change to the one filter line in each rather than deleting them, so a sibling cleanup slice that removes them has a trivial conflict.

The helpers file is `app/src/features/deployment/components/deploymentHelpers.ts` — there is **no** `utils/` directory in that feature.

No navigation files are touched — nothing under `app/src/components/layout/` or `app/src/components/docs/DocsSidebar.tsx`, which the parallel session owns (TASK-273..280).
