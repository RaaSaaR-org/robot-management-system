-- Internal research snapshots. Application corrections append, never update.
-- All identifiers and publication keys are isolated by tenant.
CREATE TABLE "ResearchRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "ideaId" TEXT,
    "parentId" TEXT,
    "sourceRunId" TEXT,
    "title" TEXT NOT NULL,
    "bodyJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "datasetId" TEXT,
    "datasetVersion" TEXT,
    "supersedesId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRecord_pkey" PRIMARY KEY ("tenantId", "id"),
    CONSTRAINT "ResearchRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResearchRecord_tenantId_authorId_idempotencyKey_key" ON "ResearchRecord"("tenantId", "authorId", "idempotencyKey");
CREATE INDEX "ResearchRecord_tenantId_createdAt_idx" ON "ResearchRecord"("tenantId", "createdAt");
CREATE INDEX "ResearchRecord_tenantId_campaignId_kind_idx" ON "ResearchRecord"("tenantId", "campaignId", "kind");
CREATE INDEX "ResearchRecord_tenantId_ideaId_idx" ON "ResearchRecord"("tenantId", "ideaId");
CREATE INDEX "ResearchRecord_tenantId_datasetId_datasetVersion_idx" ON "ResearchRecord"("tenantId", "datasetId", "datasetVersion");
CREATE INDEX "ResearchRecord_tenantId_sourceRunId_idx" ON "ResearchRecord"("tenantId", "sourceRunId");
CREATE INDEX "ResearchRecord_tenantId_supersedesId_idx" ON "ResearchRecord"("tenantId", "supersedesId");

CREATE TABLE "ResearchModelPublication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "ideaId" TEXT,
    "sourceRunId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchModelPublication_pkey" PRIMARY KEY ("tenantId", "id"),
    CONSTRAINT "ResearchModelPublication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResearchModelPublication_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResearchModelPublication_tenantId_authorId_idempotencyKey_key" ON "ResearchModelPublication"("tenantId", "authorId", "idempotencyKey");
CREATE INDEX "ResearchModelPublication_tenantId_createdAt_idx" ON "ResearchModelPublication"("tenantId", "createdAt");
CREATE INDEX "ResearchModelPublication_tenantId_campaignId_idx" ON "ResearchModelPublication"("tenantId", "campaignId");
CREATE INDEX "ResearchModelPublication_tenantId_sourceRunId_idx" ON "ResearchModelPublication"("tenantId", "sourceRunId");
CREATE INDEX "ResearchModelPublication_modelVersionId_idx" ON "ResearchModelPublication"("modelVersionId");
