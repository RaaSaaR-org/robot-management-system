-- TASK-291: the compliance hash chain gets an explicit, uniquely-indexed
-- position so concurrent appends cannot fork it.
--
-- `ComplianceLogRepository.create` read the chain head with a bare `findFirst`
-- and inserted afterwards, with `await` points in between. Two overlapping
-- creates therefore read the same head and both persisted the same
-- `previousHash`, and `verifyHashChain` reported that link broken from then on.
-- The damage is a FALSE TAMPER REPORT in the EU AI Act Art. 12 evidence chain —
-- the audit log accusing itself of tampering that never happened. The
-- concurrency that triggers it is routine, not exotic: auth.middleware fires a
-- log per impersonated request without awaiting it, and every robot flushes its
-- own queue one POST at a time.
--
-- The fix is this column plus the unique index below. `seq` is assigned by the
-- application inside the same transaction that reads the head, and the UNIQUE
-- index is what actually serializes the append: the loser of a race violates it
-- (P2002) and retries against a freshly read head.
--
-- Wrapping the read and the write in a transaction is NOT sufficient on its own,
-- and this is the part that looks fixed and is not. Measured on PostgreSQL at
-- READ COMMITTED (the default), two concurrent transactions read the same chain
-- head and both commit — they never touch the same row, so nothing conflicts and
-- no serialization failure is raised. The unique constraint is the only guard
-- that is provider-independent.
--
-- `seq` is deliberately not `GENERATED ... AS IDENTITY`. Prisma rejects
-- `autoincrement()` on a non-id field (P1012) on both sqlite and postgresql, and
-- a database-side sequence would be worse than useless here: it would hand out a
-- number unrelated to the head the transaction actually chained onto, so the
-- number would no longer witness the chain position it is supposed to order.
--
-- `seq` does not enter the hash input, which stays
-- `previousHash|timestamp|payloadHash|eventType`. Adding it therefore rewrites no
-- existing hash: the UPDATE below writes only this new column. Pre-existing
-- breaks stay visible exactly as they are — repairing them by recomputing
-- `currentHash` would destroy the tamper evidence the chain exists for.

-- Nullable to begin with: the column has to land on the rows that already exist
-- before it can be populated.
ALTER TABLE "ComplianceLog" ADD COLUMN "seq" INTEGER;

-- Backfill historical rows in the most defensible order available for them,
-- (timestamp, id). This asserts nothing about whether those rows chain
-- correctly — it only gives them a stable total order to be read back in, which
-- `timestamp` alone never provided: it is non-unique and was measured with 543
-- duplicate values on the development database.
UPDATE "ComplianceLog" AS c
SET "seq" = numbered.rn
FROM (
    SELECT "id", row_number() OVER (ORDER BY "timestamp", "id") AS rn
    FROM "ComplianceLog"
) AS numbered
WHERE c."id" = numbered."id";

-- The actual serializer, created after the backfill so it is built over a fully
-- numbered table. The name matches what Prisma generates for `seq Int? @unique`,
-- so a later `prisma migrate diff` sees no drift.
CREATE UNIQUE INDEX "ComplianceLog_seq_key" ON "ComplianceLog"("seq");
