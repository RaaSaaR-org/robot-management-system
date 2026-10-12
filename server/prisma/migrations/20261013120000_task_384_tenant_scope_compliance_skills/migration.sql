-- TASK-384: record tenant ownership for compliance logs, skills and skill chains.
--
-- None of the three carried a `tenantId`, so with MULTI_TENANCY_ENABLED=true any
-- tenant could read every other tenant's audit trail and read, overwrite or
-- delete its skills. Nullable like every wave since TASK-155; the boot-time
-- seeder backfills existing rows (server/src/database/seedTenant.ts).
--
-- ComplianceLog: the column is NOT part of the hash input
-- (previousHash|timestamp|payloadHash|eventType), so rows written before this
-- migration still verify. The model stays out of TENANT_SCOPED_MODELS — the
-- hash chain is global and its head read must not be tenant-scoped — and the
-- reads filter by tenant explicitly. A NULL tenantId marks a platform event.
--
-- ON DELETE SET NULL matches the other waves: deleting a Tenant must not delete
-- its audit evidence.

-- ============================================================================
-- ComplianceLog
-- ============================================================================

ALTER TABLE "ComplianceLog" ADD COLUMN "tenantId" TEXT;

CREATE INDEX "ComplianceLog_tenantId_timestamp_idx" ON "ComplianceLog"("tenantId", "timestamp");

ALTER TABLE "ComplianceLog"
    ADD CONSTRAINT "ComplianceLog_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- SkillDefinition — (name, version) becomes unique per tenant, as Zone did in
-- TASK-288. NULLs are distinct inside a unique index, so with multi-tenancy off
-- the SkillLibraryService pre-check is the only guard.
-- ============================================================================

ALTER TABLE "SkillDefinition" ADD COLUMN "tenantId" TEXT;

DROP INDEX "SkillDefinition_name_version_key";
CREATE UNIQUE INDEX "SkillDefinition_tenantId_name_version_key" ON "SkillDefinition"("tenantId", "name", "version");

ALTER TABLE "SkillDefinition"
    ADD CONSTRAINT "SkillDefinition_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- SkillChain — its steps are reached only through the chain
-- ============================================================================

ALTER TABLE "SkillChain" ADD COLUMN "tenantId" TEXT;

CREATE INDEX "SkillChain_tenantId_idx" ON "SkillChain"("tenantId");

ALTER TABLE "SkillChain"
    ADD CONSTRAINT "SkillChain_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
