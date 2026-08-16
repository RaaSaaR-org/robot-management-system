-- TASK-212 patrol: PatrolRoute (source of record for a scheduled route),
-- PatrolRun (persisted history of what the robot reported) and PatrolFinding
-- (what was not normal, one alert each). JSON payloads are TEXT columns
-- (de)serialised in PatrolRepository so the same schema runs on SQLite (dev,
-- applied via `prisma db push`) and PostgreSQL (this migration).
-- PatrolRun.routeId is deliberately NOT a foreign key: run/finding history
-- must survive deleting a route, and the robot may report runs for a route
-- the server no longer knows (disk cache) — those still need their skipped
-- alert and audit trail.

-- CreateTable
CREATE TABLE "PatrolRoute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "robotId" TEXT,
    "twinId" TEXT,
    "checkpoints" TEXT NOT NULL DEFAULT '[]',
    "cronExpression" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeWindows" TEXT NOT NULL DEFAULT '[]',
    "homePlaceId" TEXT,
    "lastFiredAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "PatrolRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolRun" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "routeName" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "window" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "legs" TEXT NOT NULL DEFAULT '[]',
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "planId" TEXT,
    "alertId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "PatrolRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "checkpointId" TEXT,
    "legIndex" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "place" TEXT,
    "pose" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '{}',
    "model" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "alertId" TEXT,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "PatrolFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatrolRoute_robotId_idx" ON "PatrolRoute"("robotId");
CREATE INDEX "PatrolRoute_enabled_idx" ON "PatrolRoute"("enabled");
CREATE INDEX "PatrolRoute_createdAt_idx" ON "PatrolRoute"("createdAt");

CREATE INDEX "PatrolRun_routeId_idx" ON "PatrolRun"("routeId");
CREATE INDEX "PatrolRun_robotId_idx" ON "PatrolRun"("robotId");
CREATE INDEX "PatrolRun_status_idx" ON "PatrolRun"("status");
CREATE INDEX "PatrolRun_startedAt_idx" ON "PatrolRun"("startedAt");
CREATE INDEX "PatrolRun_createdAt_idx" ON "PatrolRun"("createdAt");

CREATE INDEX "PatrolFinding_runId_idx" ON "PatrolFinding"("runId");
CREATE INDEX "PatrolFinding_routeId_idx" ON "PatrolFinding"("routeId");
CREATE INDEX "PatrolFinding_robotId_idx" ON "PatrolFinding"("robotId");
CREATE INDEX "PatrolFinding_status_idx" ON "PatrolFinding"("status");
CREATE INDEX "PatrolFinding_type_idx" ON "PatrolFinding"("type");
CREATE INDEX "PatrolFinding_createdAt_idx" ON "PatrolFinding"("createdAt");

-- AddForeignKey
ALTER TABLE "PatrolRoute" ADD CONSTRAINT "PatrolRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatrolRun" ADD CONSTRAINT "PatrolRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatrolFinding" ADD CONSTRAINT "PatrolFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PatrolRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatrolFinding" ADD CONSTRAINT "PatrolFinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
