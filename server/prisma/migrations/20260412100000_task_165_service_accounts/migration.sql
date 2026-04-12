-- TASK-165: Service accounts + API tokens
-- Additive migration — no data backfill needed (kind defaults to 'human').

-- Add service-account fields to User
ALTER TABLE "User" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'human';
ALTER TABLE "User" ADD COLUMN "createdById" TEXT;

-- Self-referencing FK for service-account creator
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_kind_idx" ON "User"("kind");

-- API tokens table
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ApiToken_prefix_idx" ON "ApiToken"("prefix");
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
CREATE UNIQUE INDEX "ApiToken_userId_name_key" ON "ApiToken"("userId", "name");

-- Foreign keys
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
