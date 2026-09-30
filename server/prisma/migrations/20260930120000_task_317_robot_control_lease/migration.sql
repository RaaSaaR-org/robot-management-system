-- TASK-317: one control-lease row per robot. Mutated only by conditional
-- UPDATEs and a primary-key create, so replicas agree on a single holder.
-- Stores the SHA-256 of the lease secret, never the secret itself.
CREATE TABLE "RobotControlLease" (
    "robotId" TEXT NOT NULL,
    "tenantId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "leaseIdHash" TEXT,
    "sessionId" TEXT,
    "userId" TEXT,
    "displayName" TEXT,
    "state" TEXT NOT NULL DEFAULT 'released',
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RobotControlLease_pkey" PRIMARY KEY ("robotId")
);
CREATE INDEX "RobotControlLease_tenantId_idx" ON "RobotControlLease"("tenantId");
