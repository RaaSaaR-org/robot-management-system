-- TASK-498: a direct model checkpoint upload session, and the facts a model
-- without a TrainingJob row can state about itself.
ALTER TABLE "ModelVersion" ADD COLUMN "baseModel" TEXT;
ALTER TABLE "ModelVersion" ADD COLUMN "datasetId" TEXT;
ALTER TABLE "ModelVersion" ADD COLUMN "notes" TEXT;
ALTER TABLE "ModelVersion" ADD COLUMN "artifactSizeBytes" BIGINT;
ALTER TABLE "ModelVersion" ADD COLUMN "artifactFileCount" INTEGER;

CREATE TABLE "ModelUpload" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'uploading',
    "sink" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "filesJson" TEXT NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "error" TEXT,
    "modelVersionId" TEXT,
    "filesRemovedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "ModelUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelUpload_modelVersionId_key" ON "ModelUpload"("modelVersionId");
CREATE INDEX "ModelUpload_state_lastActivityAt_idx" ON "ModelUpload"("state", "lastActivityAt");
CREATE INDEX "ModelUpload_tenantId_createdAt_idx" ON "ModelUpload"("tenantId", "createdAt");

ALTER TABLE "ModelUpload" ADD CONSTRAINT "ModelUpload_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
