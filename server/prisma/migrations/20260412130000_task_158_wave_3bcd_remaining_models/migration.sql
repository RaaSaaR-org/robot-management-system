-- TASK-158 Waves 3b/3c/3d: row-level multi-tenancy for remaining models
--
-- Adds a nullable tenantId FK on 10 models following the same pattern as
-- Wave 1 (TASK-155) and Wave 3a. The column is nullable so single-tenant
-- deployments keep working. When MULTI_TENANCY_ENABLED=true, the seeder
-- backfills existing rows.

-- ============================================================================
-- Wave 3b — Automations & workflows
-- ============================================================================

-- AlterTable: ProcessDefinition
ALTER TABLE "ProcessDefinition" ADD COLUMN "tenantId" TEXT;

-- AlterTable: ProcessInstance
ALTER TABLE "ProcessInstance" ADD COLUMN "tenantId" TEXT;

-- AlterTable: ApprovalRequest
ALTER TABLE "ApprovalRequest" ADD COLUMN "tenantId" TEXT;

-- AlterTable: Event
ALTER TABLE "Event" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: Wave 3b composites
CREATE INDEX "ProcessDefinition_tenantId_createdAt_idx" ON "ProcessDefinition"("tenantId", "createdAt");
CREATE INDEX "ProcessInstance_tenantId_createdAt_idx" ON "ProcessInstance"("tenantId", "createdAt");
CREATE INDEX "ApprovalRequest_tenantId_createdAt_idx" ON "ApprovalRequest"("tenantId", "createdAt");
CREATE INDEX "Event_tenantId_timestamp_idx" ON "Event"("tenantId", "timestamp");

-- AddForeignKey: Wave 3b
ALTER TABLE "ProcessDefinition"
    ADD CONSTRAINT "ProcessDefinition_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProcessInstance"
    ADD CONSTRAINT "ProcessInstance_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApprovalRequest"
    ADD CONSTRAINT "ApprovalRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Event"
    ADD CONSTRAINT "Event_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Wave 3c — VLA lifecycle
-- ============================================================================

-- AlterTable: ModelVersion
ALTER TABLE "ModelVersion" ADD COLUMN "tenantId" TEXT;

-- AlterTable: Deployment
ALTER TABLE "Deployment" ADD COLUMN "tenantId" TEXT;

-- AlterTable: SimulationJob
ALTER TABLE "SimulationJob" ADD COLUMN "tenantId" TEXT;

-- AlterTable: SyntheticJob
ALTER TABLE "SyntheticJob" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: Wave 3c composites
CREATE INDEX "ModelVersion_tenantId_createdAt_idx" ON "ModelVersion"("tenantId", "createdAt");
CREATE INDEX "Deployment_tenantId_createdAt_idx" ON "Deployment"("tenantId", "createdAt");
CREATE INDEX "SimulationJob_tenantId_createdAt_idx" ON "SimulationJob"("tenantId", "createdAt");
CREATE INDEX "SyntheticJob_tenantId_createdAt_idx" ON "SyntheticJob"("tenantId", "createdAt");

-- AddForeignKey: Wave 3c
ALTER TABLE "ModelVersion"
    ADD CONSTRAINT "ModelVersion_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deployment"
    ADD CONSTRAINT "Deployment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SimulationJob"
    ADD CONSTRAINT "SimulationJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SyntheticJob"
    ADD CONSTRAINT "SyntheticJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Wave 3d — Conversations / misc
-- ============================================================================

-- AlterTable: Zone
ALTER TABLE "Zone" ADD COLUMN "tenantId" TEXT;

-- AlterTable: Conversation
ALTER TABLE "Conversation" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: Wave 3d composites
CREATE INDEX "Zone_tenantId_createdAt_idx" ON "Zone"("tenantId", "createdAt");
CREATE INDEX "Conversation_tenantId_createdAt_idx" ON "Conversation"("tenantId", "createdAt");

-- AddForeignKey: Wave 3d
ALTER TABLE "Zone"
    ADD CONSTRAINT "Zone_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
