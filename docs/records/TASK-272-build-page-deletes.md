# TASK-272 — What "delete" means on each Build page

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-272-close-the-server-gaps-the-build-pages-ran-into.md`

Immutable once committed. Later changes of mind get their own record.

## What prompted it

TASK-266 rebuilt the Build pages and hid every delete, because the server had
none. The task asks for "delete (or archive, where history must be kept for the
audit trail)" on update packages, fleet-learning rounds, deployments and model
versions, plus unpublish for marketplace listings, and for every delete to be
recorded in the compliance log "the same way creates are recorded". Which
entity gets which was left to the implementer.

## Facts established before deciding

| Fact | Why it mattered |
| ---- | --------------- |
| `UpdateService.triggerRollback` created its row with `packageId: lastDeployment?.packageId ?? 'rollback'`, and the route dropped its own `:id` | A robot with no successful deployment on record always hit the foreign key — the bug the UI saw |
| `UpdateDeployment.packageId` references `UpdatePackage` with no cascade | A package robots were deployed from cannot be removed without losing what ran where |
| `ModelVersion` is referenced by `Deployment`, `EvaluationEpisode`, `ModelCheckpoint`, `ResearchModelPublication`, `TrainingJob` (init) and its own lineage, and already has `deploymentStatus: 'archived'` | A hard delete would break or null six kinds of history; archive already exists as a state |
| `FederatedParticipant` cascades from its round; nothing else references a round | A finished round can go without orphaning anything |
| A cancelled deployment was already stored as `cancelled` (TASK-299, #320) | AC 3 was met before this task; only the delete was missing |
| No Build create wrote to the compliance log | "The same way creates are recorded" had nothing to copy |
| A `ListingPurchase` references its listing and licence | A bought listing is the buyer's receipt |

## Decisions

1. **One response shape for every destructive act:** `200 { id, outcome: 'deleted' | 'archived' }`,
   `404` for an unknown id, `409` with the reason and the way out when the state forbids it.
   The UI toasts `outcome` and, on failure, the server's sentence, so the page never
   has to know the server's rules to explain a refusal.
2. **Update packages:** a package no robot was deployed from is deleted; one with
   deployments is archived (`status: 'archived'`, left out of `GET /updates` unless
   `includeArchived=true`); one still installing somewhere is refused. The page
   offers one "Delete" and says which happened.
3. **Model versions are archived, never deleted.** `DELETE /models/versions/:id` sets
   `deploymentStatus: 'archived'`, idempotently. It is refused while a deployment of
   the model is unfinished (anything but failed / rolled back / cancelled) or while a
   skill's `linkedModelVersionId` still points at it — silently archiving the model a
   skill executes would be worse than a 409 that names the skill.
4. **Deployments** are deleted outright once they are not moving (pending, failed,
   rolled back, cancelled). A live one must be rolled back or cancelled first.
5. **Rounds:** cancel is allowed on anything not finished, including a round created
   but never started; in-flight participants become `excluded` with
   `failureReason: 'round cancelled'`, and uploaded ones keep their status because
   their privacy budget is already spent. Delete is allowed only on a finished round.
6. **Marketplace listings:** unpublish returns a listing to `draft`, and a matching
   publish puts it back — an unpublish with no way back would be a trap. Delete is
   refused once anyone holds a licence (unpublish instead). Only the seller or a
   `super-admin` may act; a tenant `owner` may not, because the marketplace spans
   tenants. A listing in a moderation state (`pending_review`, `suspended`) is the
   platform's call: the seller's publish or unpublish answers 409, since publish
   would skip the review and unpublish would turn a suspension into a draft the
   seller could republish. Only a `super-admin` moves it out.
7. **Audit:** one helper, `server/src/services/buildAudit.ts`, writes an
   `access_audit` compliance entry (robot key `platform-build`) for every create
   **and** every delete / archive / cancel / unpublish / publish / rollback on these
   five entities, with a snapshot of the removed row for a delete. Creates are
   recorded too, so "the same way creates are recorded" is now true rather than
   vacuous. A failed audit write is logged, never allowed to undo the act.
8. **`fetchModelVersions`** records `modelVersionsError` instead of swallowing it;
   `/models` shows it as the table's error state with Retry. It still resolves, so the
   other callers (training init, deploy form) are unaffected.

## Consequences

- An archived update package or model version still exists in the database and the
  audit log; only the lists hide it (packages) or badge it (models).
- A refused cancel no longer puts the rounds table into its load-error state: the
  store's `cancelRound` stopped writing `error`, which the table reads as a failed load.
