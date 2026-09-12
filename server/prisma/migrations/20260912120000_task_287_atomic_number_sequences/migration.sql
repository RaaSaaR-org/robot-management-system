-- TASK-287: incident and approval numbers come from an atomic counter, and the
-- constraints that guard them become per-tenant.
--
-- The old generators read the current maximum with a *string* `orderBy` and
-- added one. That fails two ways. Lexicographically, 'INC-2026-999' sorts above
-- 'INC-2026-1000', so once the thousandth incident of a year exists every later
-- one recomputes a number that is already taken — a live defect on every
-- single-tenant deployment. And under multi-tenancy the read is tenant-scoped
-- while the column is globally unique, so tenant B computes 'INC-2026-001',
-- collides with tenant A's row, and never advances past it.
--
-- NumberSequence replaces the scan with a row per (scope, tenant, year) that is
-- incremented inside a transaction. There is no backfill: the allocator seeds
-- itself on first use from the numeric maximum already in the table, so a
-- populated database resumes where it left off instead of restarting at 001.

-- ── The allocator ──────────────────────────────────────────────────────────
--
-- The compound primary key is the whole identity of the row; a uuid column
-- would only add a second way to name the same thing. `tenantKey` is the
-- tenantId, or the literal 'default' outside any tenant scope — a plain TEXT
-- column rather than a foreign key, because the counter must keep working when
-- multi-tenancy is off and no Tenant row exists at all.
CREATE TABLE "NumberSequence" (
    "scope" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("scope","tenantKey","year")
);

-- ── Tenant-qualified uniques ───────────────────────────────────────────────
--
-- Note the trade this makes: `tenantId` is nullable and SQL treats NULLs as
-- distinct inside a unique index, so with MULTI_TENANCY_ENABLED=false these
-- indexes stop enforcing anything and the allocator becomes the only guard
-- against a duplicate. That is acceptable only because the allocator is atomic
-- where the max-scan it replaces was not. Making `tenantId` NOT NULL is the
-- alternative, and it is rejected: it would demand a Tenant row for every
-- insert on deployments that have no tenants.
DROP INDEX "Incident_incidentNumber_key";
CREATE UNIQUE INDEX "Incident_tenantId_incidentNumber_key" ON "Incident"("tenantId", "incidentNumber");

DROP INDEX "ApprovalRequest_requestNumber_key";
CREATE UNIQUE INDEX "ApprovalRequest_tenantId_requestNumber_key" ON "ApprovalRequest"("tenantId", "requestNumber");

-- Robot has the same defect class with no call site depending on the old shape:
-- two operators may legitimately run hardware carrying the same serial, and
-- nothing looks a robot up by serial number alone. Free to fix while the
-- migration is open.
DROP INDEX "Robot_serialNumber_key";
CREATE UNIQUE INDEX "Robot_tenantId_serialNumber_key" ON "Robot"("tenantId", "serialNumber");
