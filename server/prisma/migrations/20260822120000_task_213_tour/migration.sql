-- TASK-213 host mode: TourRoute (source of record for an authored visitor
-- tour) and TourRun (persisted history of what the robot said and what it was
-- asked). JSON payloads are TEXT columns (de)serialised in TourRepository so
-- the same schema runs on SQLite (dev, applied via `prisma db push`) and
-- PostgreSQL (this migration).
--
-- TourRun.id is the runId minted by the robot, not a generated uuid: the run
-- exists on the robot before it reaches the server, and the ingest is
-- idempotent on that id.
--
-- TourRun.routeId is deliberately NOT a foreign key, for the same reason
-- PatrolRun.routeId is not: visit history must survive deleting a route, and
-- the robot may report runs for a route the server no longer knows (it walks
-- from its own disk cache when the server is down) — those still need their
-- audit trail.

-- CreateTable
CREATE TABLE "TourRoute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "robotId" TEXT,
    "twinId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "greetingPlaceId" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "offer" TEXT NOT NULL,
    "farewell" TEXT NOT NULL,
    "siteCard" TEXT NOT NULL DEFAULT '[]',
    "stops" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoGreet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "TourRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourRun" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "routeName" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "legs" TEXT NOT NULL DEFAULT '[]',
    "turns" TEXT NOT NULL DEFAULT '[]',
    "language" TEXT NOT NULL DEFAULT 'en',
    "disclosureSpoken" BOOLEAN NOT NULL DEFAULT false,
    "planId" TEXT,
    "alertId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "TourRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourRoute_robotId_idx" ON "TourRoute"("robotId");
CREATE INDEX "TourRoute_enabled_idx" ON "TourRoute"("enabled");
CREATE INDEX "TourRoute_createdAt_idx" ON "TourRoute"("createdAt");

CREATE INDEX "TourRun_routeId_idx" ON "TourRun"("routeId");
CREATE INDEX "TourRun_robotId_idx" ON "TourRun"("robotId");
CREATE INDEX "TourRun_status_idx" ON "TourRun"("status");
CREATE INDEX "TourRun_startedAt_idx" ON "TourRun"("startedAt");
CREATE INDEX "TourRun_createdAt_idx" ON "TourRun"("createdAt");

-- AddForeignKey
ALTER TABLE "TourRoute" ADD CONSTRAINT "TourRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TourRun" ADD CONSTRAINT "TourRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
