-- TASK-286: record tenant ownership for sensor scans, motion clips and VLA sessions.
--
-- These three models hold some of the most sensitive rows the platform stores —
-- raw LiDAR sweeps of customer buildings, captured motion clips, and the
-- natural-language prompts operators gave their robots — and none of them had a
-- `tenantId` column at all. An allowlist entry could not close them: the column
-- has to exist first, which is why this is a migration rather than a one-line
-- edit to TENANT_SCOPED_MODELS.
--
-- The column is nullable, following every wave since TASK-155, so single-tenant
-- deployments keep working untouched and the boot-time seeder can backfill
-- existing rows when MULTI_TENANCY_ENABLED=true. `SensorScan` is backfilled in
-- pages rather than one statement — it holds one row per LiDAR frame, and an
-- unbounded UPDATE there would take a write lock across the whole table during
-- startup (see server/src/database/seedTenant.ts).
--
-- ON DELETE SET NULL matches the other waves: deleting a Tenant must not delete
-- the evidence of what its robots captured.

-- ============================================================================
-- SensorScan — one row per captured point cloud
-- ============================================================================

-- AlterTable: SensorScan
ALTER TABLE "SensorScan" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: mirrors the existing capturedAt sort so list queries stay covered
CREATE INDEX "SensorScan_tenantId_capturedAt_idx" ON "SensorScan"("tenantId", "capturedAt");

-- AddForeignKey
ALTER TABLE "SensorScan"
    ADD CONSTRAINT "SensorScan_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- MotionClip — retargeted motion from the GVHMR→GMR pipeline
-- ============================================================================

-- AlterTable: MotionClip
ALTER TABLE "MotionClip" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "MotionClip_tenantId_createdAt_idx" ON "MotionClip"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "MotionClip"
    ADD CONSTRAINT "MotionClip_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- VlaSession — operator prompts and the VLA runs they started
-- ============================================================================

-- AlterTable: VlaSession
ALTER TABLE "VlaSession" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "VlaSession_tenantId_startedAt_idx" ON "VlaSession"("tenantId", "startedAt");

-- AddForeignKey
ALTER TABLE "VlaSession"
    ADD CONSTRAINT "VlaSession_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
