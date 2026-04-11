-- TASK-155 Wave 1: row-level multi-tenancy foundation
--
-- Adds a Tenant table and a nullable tenantId FK on four pilot models
-- (User, Robot, Dataset, TrainingJob). The column is nullable on purpose
-- so single-tenant deployments (MULTI_TENANCY_ENABLED=false) keep
-- working without any tenant data. When the flag is enabled, the
-- application-level seeder at server/src/database/seedTenant.ts creates
-- a DEFAULT tenant and backfills existing rows.
--
-- User.tenantId already existed (legacy field, unused) — we only add
-- the FK + index here.

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "plan" TEXT,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "Tenant"("slug");

-- AlterTable: Robot
ALTER TABLE "Robot" ADD COLUMN "tenantId" TEXT;

-- AlterTable: Dataset
ALTER TABLE "Dataset" ADD COLUMN "tenantId" TEXT;

-- AlterTable: TrainingJob
ALTER TABLE "TrainingJob" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: User (tenantId)
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex: Robot composite
CREATE INDEX "Robot_tenantId_updatedAt_idx" ON "Robot"("tenantId", "updatedAt");

-- CreateIndex: Dataset composite
CREATE INDEX "Dataset_tenantId_updatedAt_idx" ON "Dataset"("tenantId", "updatedAt");

-- CreateIndex: TrainingJob composite
CREATE INDEX "TrainingJob_tenantId_updatedAt_idx" ON "TrainingJob"("tenantId", "updatedAt");

-- AddForeignKey: User -> Tenant
ALTER TABLE "User"
    ADD CONSTRAINT "User_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Robot -> Tenant
ALTER TABLE "Robot"
    ADD CONSTRAINT "Robot_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Dataset -> Tenant
ALTER TABLE "Dataset"
    ADD CONSTRAINT "Dataset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: TrainingJob -> Tenant
ALTER TABLE "TrainingJob"
    ADD CONSTRAINT "TrainingJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
