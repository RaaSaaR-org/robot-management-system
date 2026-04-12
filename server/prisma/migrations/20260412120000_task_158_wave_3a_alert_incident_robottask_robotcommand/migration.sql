-- TASK-158 Wave 3a: row-level multi-tenancy for operations-visibility models
--
-- Adds a nullable tenantId FK on four models (Alert, Incident, RobotTask,
-- RobotCommand) following the same pattern as Wave 1 (TASK-155).
-- The column is nullable so single-tenant deployments keep working.
-- When MULTI_TENANCY_ENABLED=true, the seeder backfills existing rows.

-- AlterTable: Alert
ALTER TABLE "Alert" ADD COLUMN "tenantId" TEXT;

-- AlterTable: Incident
ALTER TABLE "Incident" ADD COLUMN "tenantId" TEXT;

-- AlterTable: RobotTask
ALTER TABLE "RobotTask" ADD COLUMN "tenantId" TEXT;

-- AlterTable: RobotCommand
ALTER TABLE "RobotCommand" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: Alert composite
CREATE INDEX "Alert_tenantId_createdAt_idx" ON "Alert"("tenantId", "createdAt");

-- CreateIndex: Incident composite
CREATE INDEX "Incident_tenantId_createdAt_idx" ON "Incident"("tenantId", "createdAt");

-- CreateIndex: RobotTask composite
CREATE INDEX "RobotTask_tenantId_createdAt_idx" ON "RobotTask"("tenantId", "createdAt");

-- CreateIndex: RobotCommand composite
CREATE INDEX "RobotCommand_tenantId_createdAt_idx" ON "RobotCommand"("tenantId", "createdAt");

-- AddForeignKey: Alert -> Tenant
ALTER TABLE "Alert"
    ADD CONSTRAINT "Alert_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Incident -> Tenant
ALTER TABLE "Incident"
    ADD CONSTRAINT "Incident_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: RobotTask -> Tenant
ALTER TABLE "RobotTask"
    ADD CONSTRAINT "RobotTask_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: RobotCommand -> Tenant
ALTER TABLE "RobotCommand"
    ADD CONSTRAINT "RobotCommand_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
