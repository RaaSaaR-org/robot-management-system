-- TASK-158 Wave 3e: row-level multi-tenancy for ApiToken (TASK-165)
--
-- Adds a nullable tenantId FK on ApiToken. The auth middleware's
-- authenticateServiceToken() runs before tenant context is set, so
-- the extension passes through (getTenantId() returns undefined).
-- Once inside a request, token CRUD is properly scoped.

-- AlterTable: ApiToken
ALTER TABLE "ApiToken" ADD COLUMN "tenantId" TEXT;

-- CreateIndex: ApiToken composite
CREATE INDEX "ApiToken_tenantId_createdAt_idx" ON "ApiToken"("tenantId", "createdAt");

-- AddForeignKey: ApiToken -> Tenant
ALTER TABLE "ApiToken"
    ADD CONSTRAINT "ApiToken_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
