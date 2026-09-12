---
id: "TASK-291"
aliases: []
title: "Serialize the compliance hash chain so concurrent writes cannot fork it"
slug: "serialize-the-compliance-hash-chain-so-concurrent-writes-cannot-fork-it"
status: "review"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: [compliance, server]
sprint: ""
parent: "[[TASK-281]]"
depends_on: []
spe: 5
effort: "medium"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Serialize the compliance hash chain so concurrent writes cannot fork it

## Description

`ComplianceLogRepository.create` reads the chain head outside any transaction, so two overlapping writes persist the same `previousHash` and `verifyHashChain` reports a permanent broken link — a false tamper report on the audit page. This task moves the head read and the insert into one transaction, adds an application-assigned, uniquely-indexed `seq` column that makes the fork impossible on both SQLite and Postgres, orders chain reads by `seq`, and proves it with a real concurrent-write test against a real database.

## Details

### Read this before designing the fix — two measured facts that decide the implementation

Both were verified against this repo. Without them the obvious fix (wrap it in `$transaction`) ships and **does not fix the defect on the production provider**.

**1. `seq` cannot be `@default(autoincrement())`.** Prisma 6.19.1 rejects `autoincrement()` on a non-id field for **both** providers. Verified: `npx prisma validate` on a patched copy of `server/prisma/schema.prisma` returns P1012 — "The `autoincrement()` default value is used on a non-id field even though the datasource does not support this" — with `provider = "sqlite"`, and again with `provider = "postgresql"`. So `seq` must be **assigned by the application inside the transaction**, with a unique index doing the serializing.

**2. `$transaction` alone is not the guard, and on SQLite it is not even the operative part.** Measured: with the read moved inside `prisma.$transaction(fn)`, two `Promise.all` writers serialized on SQLite at default isolation *and* at Serializable — because SQLite takes one writer and Prisma's SQLite pool is 1. On **Postgres READ COMMITTED both transactions read the same head and both commit; nothing conflicts.** The provider-independent guard is the **UNIQUE constraint on `seq`** that the second writer violates (P2002), plus a retry.

### Current state

`ComplianceLogRepository.create` reads the head with a bare `findFirst` (`server/src/repositories/ComplianceLogRepository.ts:126-131`) and inserts at `:148`. There is no `$transaction` anywhere in the file, so every `await` between those two lets another in-flight create interleave and both persist the same `previousHash`.

**Reproduced on a real SQLite DB** with exactly the current statement pair: `Promise.all` of 10 creates yielded only **2 distinct `previousHash` values** — 8 rows forked in one shot.

Concurrency is routine, not exotic: `server/src/middleware/auth.middleware.ts:109` fires a log per impersonated request without awaiting; `ServiceAccountService.ts:520`, `TeamService.ts:385`, `PatrolService.ts:1298`, `TourService.ts:691` and `RetentionCleanupJob.ts:122` all write; every robot flushes its own queue one POST at a time (`robot-agent/src/compliance/ComplianceLogClient.ts:415-445` → `server/src/routes/compliance-log.routes.ts:163`).

`verifyHashChain` (`:287-349`) walks rows ordered by `timestamp` (`:298-301`) and compares `log.previousHash` to the running hash (`:310`), so a fork is reported forever. The user sees it at `app/src/features/compliance/components/AuditLogSection.tsx:118-128` → `IntegrityStatus.tsx`: "Hash chain broken — N broken links".

Ordering is independently non-deterministic: `timestamp DateTime @default(now())` (`server/prisma/schema.prisma:929`) with a **non-unique** `@@index([timestamp])` (`:947`).

Measured on the checked-in dev DB (`server/prisma/dev.db`, 4776 rows): **640 `previousHash` values shared by more than one row**, 543 timestamps shared by more than one row, and **1533 rows whose `previousHash` does not match the predecessor** under (timestamp, rowid) ordering.

The hash input is `previousHash|timestamp|payloadHash|eventType` (`server/src/security/encryption.ts:173-180`). A `seq` column does not enter it, so **adding one rewrites no existing hash**.

### Server

1. **Schema** (`server/prisma/schema.prisma`, `ComplianceLog` at `:897-950`): add `seq Int? @unique`. Nullable so the column can land on the 4776 existing rows. Do **not** write `@default(autoincrement())` — see the two facts above.

2. **`create`** (`ComplianceLogRepository.ts:119-172`): put the head read and the insert in one `prisma.$transaction(async (tx) => …)`. Head: `tx.complianceLog.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, currentHash: true } })`; write `seq: (head?.seq ?? 0) + 1`. **The unique index is the actual serializer** — a loser's insert fails P2002 and must retry the whole transaction, re-reading the head. Bound at ~5 attempts. Copy the retry shape from `server/src/services/MarketplaceService.ts:90-131` (`isUniqueConstraintError` P2002 at `:90`, `isTransactionConflictError` P2034 at `:95`, `withSerializableRetry` at `:97-117`) and pass `isolationLevel: Prisma.TransactionIsolationLevel.Serializable` — the sqlite-generated client exposes only that level, so it typechecks under both providers. `prisma` is the tenant-extended singleton; `RobotRepository.ts:242` already runs an interactive transaction on it. Hash inputs stay exactly as they are.

3. **Chain reads order by `seq`, not `timestamp`**: `verifyHashChain` (`:298-301`), `getLatestLog` (`:493-495`), `LogExportService.ts:47`. Run the backfill so no row is null; if any nullable ordering remains, pass `{ sort: 'asc', nulls: 'first' }` explicitly — SQLite sorts NULLs first, Postgres last. Leave `findBySessionId`/`findByDecisionId` on `timestamp` (display order).

4. **Migration + backfill.** New `server/prisma/migrations/<ts>_task_291_compliance_chain_seq/migration.sql` in Postgres SQL (existing files use `TIMESTAMP(3)`/`ADD CONSTRAINT`): `ADD COLUMN`, `UPDATE` via `row_number() OVER (ORDER BY "timestamp","id")`, `CREATE UNIQUE INDEX`. Note `server/prisma/migrations/migration_lock.toml` says `provider = "postgresql"` while `server/prisma/schema.prisma:12` says `sqlite`; checked-in migration SQL is Postgres-flavoured and **local dev goes through `npm run db:push`, which never executes it**. Hence a separate `server/src/scripts/backfill-compliance-seq.ts` (header style: `scripts/seed-evaluation.ts`) filling `seq` in (timestamp, id) order where null, plus a `package.json` script entry.

5. **Types**: add `seq: number | null` to `ComplianceLog` (`:162-179`) and `ComplianceLogEncrypted` in `server/src/types/compliance.types.ts`, and map it in `dbToDomain`/`dbToEncrypted` (`:42-92`).

**Key files:**
- `server/prisma/schema.prisma` — add `seq Int? @unique` to `ComplianceLog`
- `server/prisma/migrations/<ts>_task_291_compliance_chain_seq/migration.sql` — new: column, `row_number` backfill, unique index
- `server/src/repositories/ComplianceLogRepository.ts` — transactional create with `seq` + P2002 retry; chain reads by `seq`
- `server/src/types/compliance.types.ts` — add `seq` to `ComplianceLog`/`ComplianceLogEncrypted`
- `server/src/services/LogExportService.ts` — export ordering by `seq` (line 47)
- `server/src/scripts/backfill-compliance-seq.ts` — new: fills `seq` for existing SQLite rows
- `server/package.json` — add the backfill script entry
- `server/src/repositories/__tests__/ComplianceLogRepository.test.ts` — mock `$transaction`, `seq`, new ordering
- `server/src/repositories/__tests__/ComplianceLogRepository.concurrency.integration.test.ts` — new: real-DB `Promise.all` test
- `server/src/services/__tests__/LogExportService.test.ts` — update `orderBy` assertions at `:70` and `:120`
- `server/src/services/MarketplaceService.ts` — read-only: retry/isolation pattern to copy (`:90-131`)
- `server/src/__tests__/multi-tenancy.integration.test.ts` — read-only: temp-DB bootstrap to copy (`:254-266`)

## Acceptance Criteria

- [ ] A `Promise.all` of 25 concurrent `complianceLogRepository.create(...)` calls against a real temporary SQLite database leaves `verifyHashChain()` returning `isValid: true`, `totalLogs: 25` and an empty `brokenLinks` array.
- [ ] That same new test fails against the pre-fix repository (measured baseline: 10 concurrent creates on a real DB produced only 2 distinct `previousHash` values).
- [ ] `ComplianceLogRepository.create` reads the head and inserts inside one `prisma.$transaction(async (tx) => …)`, and no `findFirst` for `previousHash` remains outside a transaction anywhere in the file.
- [ ] Every row written after the change carries a non-null `seq`, and the values are strictly increasing with no duplicates, enforced by a unique index declared in `server/prisma/schema.prisma`.
- [ ] A create whose insert loses the race (Prisma P2002 on `seq`) retries with a freshly read head and succeeds — proved by a unit test that makes the mocked create reject once with a `PrismaClientKnownRequestError` code P2002.
- [ ] `verifyHashChain`, `getLatestLog` and `LogExportService` order by `seq`; no `orderBy: { timestamp: … }` remains on a chain-walking or chain-head query.
- [ ] `npx prisma validate` passes, and after `npm run db:push` plus the backfill script every existing row in `server/prisma/dev.db` has a unique non-null `seq`.
- [ ] No existing row's `currentHash` or `previousHash` is rewritten by the migration, the backfill or the new code.

## Test Strategy

The seam is mocked at every layer today, so **no test in the repo has ever run two creates concurrently against a database**:

- `server/src/repositories/__tests__/ComplianceLogRepository.test.ts:47` does `vi.mock('../../database/index.js', () => ({ prisma: mockPrisma }))`. The create tests (`:148-226`) stub `findFirst` to a fixed value and then read `create.mock.calls[0][0]` — one call, sequentially, so interleaving is impossible by construction. The `verifyHashChain` tests (`:414-490`) feed a hand-built, already-consistent array and assert `orderBy: { timestamp: 'asc' }` at `:426-429` and `:481-484`.
- `server/src/services/__tests__/ComplianceLogService.test.ts:20-33` mocks the whole repository; `server/src/__tests__/compliance-log-routes.test.ts:37-39` mocks the service. Both are blind to the chain.

**Replacement:** a new `server/src/repositories/__tests__/ComplianceLogRepository.concurrency.integration.test.ts` that exercises the real repository against a real database. Bootstrap copied from `server/src/__tests__/multi-tenancy.integration.test.ts:254-266` — `mkdtempSync`, `execSync('npx prisma db push --schema=… --skip-generate --accept-data-loss')` with `DATABASE_URL=file:<tmp>`, then `new PrismaClient({ datasources: { db: { url } } })` built inside `vi.hoisted` and handed back by `vi.mock('../../database/index.js')` so the repository singleton uses it. Then `await Promise.all(range(25).map(i => complianceLogRepository.create(input(i))))` and assert `verifyHashChain()` is valid, `seq` values are 1..25 with no duplicates, and every `previousHash` appears at most once. Real `encrypt()` works here: Vitest sets `NODE_ENV=test`, which takes the dev-key branch at `server/src/security/encryption.ts:52-60`.

Keep the existing unit file but re-point it at the new seam: mock `$transaction` with `mockImplementation(async (cb) => cb(tx))` exactly as `server/src/repositories/__tests__/RobotRepository.test.ts:512-515` does, assert the head read happens on `tx` (not on `prisma`), and add the P2002-retry case. Update the two `orderBy: { timestamp: 'asc' }` assertions in `server/src/services/__tests__/LogExportService.test.ts` (`:70`, `:120`).

Run: `cd server && npx vitest run src/repositories src/services/__tests__/LogExportService.test.ts` and `npm run typecheck`.

## Notes

**Historical damage cannot be repaired, and the implementer must record which behaviour ships.** The 1533 existing broken links in `dev.db` stay broken after this fix. Do **not** "fix" them by recomputing `currentHash` — that would destroy the tamper evidence the chain exists for. Pick one and write it down in the PR body:

- *verification reports history honestly* — the audit page keeps showing the pre-fix breaks, with a note that they predate the serialization fix; or
- *verify from a start date* — the UI or route verifies the chain only from a recorded cutover point forward.

The unique index cannot be created over rows that were never backfilled — run the backfill in the same migration on Postgres, and via the script before pushing locally.

**There is no batch-upload path to fix.** `robot-agent/src/compliance/ComplianceLogClient.ts:415-445` posts one log per request in a for-loop (its own comment at `:411` says "server doesn't support batch endpoint yet"), and `server/src/routes/compliance-log.routes.ts:163` accepts a single log. The robot-agent side needs no change; the concurrency it causes is N robots each posting serially.

Throughput: the chain is now globally serialized; bulk writers (`RetentionCleanupJob.ts:122`, robot flush storms) will queue behind the retry loop. Keep the attempt bound small and let the existing transaction timeout apply.

Sibling task TASK-281 also produced an error-handling task that touches repositories — expect a trivial merge in `ComplianceLogRepository.ts`. This task touches no file under `app/`, so it does not meet the parallel navigation session (TASK-273 through TASK-280).
