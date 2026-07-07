-- TASK-179 LeRobot 0.6.0 adoption: reward-model episode scores, dataset
-- annotations, incident highlight clips, and DAgger intervention episodes.
-- Applied to the local SQLite dev DB via `prisma db push`; this migration
-- captures the same changes in PostgreSQL dialect so `prisma migrate deploy`
-- creates them in production.

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN "annotationsJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "clipKey" TEXT;

-- CreateTable
CREATE TABLE "EpisodeReward" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "datasetId" TEXT NOT NULL,
    "episodeIndex" INTEGER NOT NULL,
    "rewardType" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "success" BOOLEAN,
    "curve" TEXT NOT NULL DEFAULT '[]',
    "fps" DOUBLE PRECISION,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionEpisode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "robotId" TEXT NOT NULL,
    "skillId" TEXT,
    "taskPrompt" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'dagger',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "stepsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeReward_datasetId_episodeIndex_rewardType_key" ON "EpisodeReward"("datasetId", "episodeIndex", "rewardType");

-- CreateIndex
CREATE INDEX "EpisodeReward_datasetId_idx" ON "EpisodeReward"("datasetId");

-- CreateIndex
CREATE INDEX "InterventionEpisode_robotId_idx" ON "InterventionEpisode"("robotId");
