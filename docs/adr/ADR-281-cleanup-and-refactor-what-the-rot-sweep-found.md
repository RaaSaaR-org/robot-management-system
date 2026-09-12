# ADR-281 — Cleanup and refactor: what the rot sweep found

- **Status:** Accepted — implemented and merged 2026-09-12
- **Epic:** TASK-281 (closed; children TASK-282 … TASK-302)
- **Supersedes:** the spec body of TASK-281, distilled here so the task file can close

## Context

A seven-lens sweep of `app/`, `server/` and `robot-agent/` looked for one failure shape: code
that is wired in and looks alive, but cannot work, because two sides of a boundary drifted apart
while the tests mocked the very seam that broke. Seven finder agents produced 28 candidates; seven
adversarial refuters killed 8 and confirmed 19 distinct defects, each carrying `file:line` evidence
a second agent re-opened and checked. Severity throughout is the refuter's, not the finder's.

**The unifying cause, which explains all 19: this codebase declares its contracts twice and
enforces them in neither place.** Statuses, permissions, open-sets, identity, action types and the
tenant allowlist each existed as two independent declarations in two packages, with nothing — no
shared module, no test, no typecheck — asserting they agree. CI was green throughout, because the
tests mocked the seam.

## What was found

**A. Authorization declared twice, enforced nowhere (critical).** A `viewer` — the lowest role the
product sells — could unregister a robot and issue physical motion commands. `memberOrAbove` and
`viewerOrAbove` existed and were applied by zero route files; the client's `VIEWER_PERMISSIONS`
matrix gated nothing because no component passed `requiredPermission`. CI missed it because the
guards had passing unit tests in isolation and route tests authenticated as a privileged user.

**B. The oversight record was self-asserted, lost its subjects, and forked under load (high).**
Approval routes took `decidedBy` from the request body, so any authenticated caller could attribute
a decision to a colleague. `escalated` counted as open on the client and was excluded from every
server query meaning "still open", so a request dropped out of the overdue set the moment it
breached SLA. The compliance hash chain read its predecessor outside any transaction, so concurrent
writes persisted the same `previousHash` and verification reported permanent tampering.

**C. Robot agent and server disagreed about the wire (high).** Four live agent clients sent no
credential and swallowed the resulting 401 as "nothing to report". The task queue returned
`{success: true}` for every action type it did not implement — and every process built in the UI
was made entirely of those types. `protective_stop` was an app-only status no producer could emit,
so a latched robot showed as Online, in green.

**D. The fleet console misreported safety state (high).** The dashboard's fleet Stop button read
only a fetch-on-mount snapshot, so a remote E-Stop never reached it. The dangerous direction was the
inverse: after a remote reset it still offered "Resume fleet" on an already-armed fleet.

**E. Multi-tenancy isolation had holes the tests could not catch (high).** The whole
digital-twin / perception / sim-scene surface was unscoped, and the write side recorded no owner at
all — so the ownership needed to retrofit a filter was not accruing. Number generators did a
tenant-filtered max-scan against a globally unique column, and padded counters ordered
lexicographically, so `INC-2026-999` sorted above `INC-2026-1000` forever. `Zone`'s unique was not
tenant-qualified. The root cause was testability: both tenancy tests pasted their own stale copy of
the allowlist, so a tenant-owned model could never fail a test by drifting out.

**F. The error contract was inverted in both directions (high/medium).** `instanceof Error` was
always false on the api-client path, so 165 sites fell through to a generic fallback; meanwhile 33
of 64 route files echoed raw caught error text — including full Prisma dumps with query, schema
shape and absolute server paths — back to the client.

**G. Deployment cancel and rollback were both recorded as "Failed" (medium).** A deliberate
withdrawal and an uncontrolled crash were the same red row, in what serves as the post-market
monitoring trail.

**H. Demo mode's catch-all poisoned any page without a bespoke handler (high).** A terminal
`http.get('/api/*')` returned an envelope no store reads, silently re-arming the trap for every
feature added without a hand-written handler.

**I. Four subsystems were wired in but could not do their job.** OTA updates were a closed loop
whose signature checks verified a fabricated constant; GDPR admin fulfilment had no UI, so the
Art. 12(3) clock ran out silently; the Art. 10/11 training-documentation module was unreachable;
and deleting a digital twin orphaned its scans and blobs.

## Decision

1. **Split into 21 vertical children**, each at or under `spe: 8`, and land them as one PR. Thirteen
   agents each read the code for one proposed slice; a critic then checked the set for coverage,
   overlap, honest sizing and real blockers. Four proposals were over the ceiling or mis-scoped.
2. **Fix testability before the defect it hides.** The tenant allowlist is derived from
   `schema.prisma` via the Prisma DMMF and asserted against the real export, so adding a
   tenant-owned model without scoping it now fails CI.
3. **Prefer a ratchet to a one-off cleanup.** `scripts/test-all.sh` gained an error-contract stage
   that fails the build if `instanceof Error` returns to an app feature store (22 files → 0). The
   epic originally specified eslint; this repo has no eslint config, script or CI step, so the
   ratchet is a grep and adopting eslint properly is left as its own task.
4. **Preserve historical damage rather than repair it.** Roughly 1,533 pre-existing broken links in
   the compliance chain stay visible; nothing recomputes `currentHash`, because that would destroy
   the tamper evidence the chain exists for.
5. **Do not delete a user-reachable feature on a spike's say-so.** The three "not now" subsystems
   got a recorded verdict with costs written down, plus `@status unshipped` markers in-code. Delete
   remains the owner's call, made from evidence.

## Corrections made to the epic's own evidence

Recorded because each changed the fix, not just a line number:

- A `seq` column **cannot** be `@default(autoincrement())` — Prisma rejects autoincrement on a
  non-id field on both providers (P1012). It must be assigned by the application, with a unique
  index doing the serializing.
- `$transaction` alone does **not** fix the hash chain: on Postgres READ COMMITTED both transactions
  read the same head and both commit. The provider-independent guard is UNIQUE on `seq` plus a
  bounded retry that re-reads the head.
- `/deployments` and `/alerts` do **not** white-screen; `DemoFeaturePlaceholder` guards landed
  ahead of both hooks. The same defect is live at other addresses, so the finding stands relocated.
- There are **four** producers of `RobotStatus`, not three — a zod gate is the fourth and had to
  widen too, or the server would reject the value it now receives.

## Explicitly rejected — do not re-raise

The refutation pass killed eight candidates. The notable one: **`FederatedClient` writes to three
routes that do not exist** — true, but the impact is nil, because the local-episode source returns
`[]` and the subsystem is gated on a flag set in no env, chart or workflow. It was the exemplar that
prompted the sweep, and turned out to be the least important instance of its own class. Also
rejected: "active deployment" defined four times (three copies have no consumer); unreadable
`VlaSession` rows (routes work, they simply have no UI); GDPR refusal reasons discarded (they do
reach the subject); wrong status class on write handlers; `incident_created` broadcast to nobody
(fetch-on-mount is the house pattern); telemetry `cpuUsage ?? 0`; and "extract a shared types
package" — process advice whose showpiece claim was false at the lines it cited.

## Consequences

- A `viewer` is now refused on every write route, asserted per verb from the live Express stack
  rather than per middleware. Two exemption classes carry the deliberate exceptions, plus a third
  for safety halts: **a read-only operator may stop a robot or the fleet, and may never resume one.**
- The compliance chain is serialized and its ordering is deterministic; an un-backfilled database no
  longer reports false tampering.
- Three terminal deployment states that were unreachable are now written.
- The error contract holds in both directions, guarded by the ratchet in one and by `sendFailure`
  in the other.
- **Follow-ups this epic deliberately did not take:** adopting eslint; `ModelVersion` needs
  `@@unique([skillId, version])`; the body-supplied-actor defect survives on several routes outside
  TASK-289's scope; the `safety:estop` envelope has no runtime validation on either side; and the
  three "not now" subsystems each need their own slice.
- **The structural recommendation worth keeping:** nothing in this repo asserts that two
  declarations of the same contract agree. A CI check that diffs named unions across `app/`,
  `server/` and `robot-agent/` would have caught three of these classes before they shipped, at a
  fraction of the cost of the shared-types package that was rejected above.
