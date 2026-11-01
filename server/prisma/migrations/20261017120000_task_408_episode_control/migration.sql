-- TASK-408: takes are persisted when they stop, attributed, and kept when discarded.
ALTER TABLE "TeleoperationEpisode" ADD COLUMN     "datasetEpisodeIndex" INTEGER,
ADD COLUMN     "discarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quickCheck" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "startedBy" TEXT,
ADD COLUMN     "stopReason" TEXT,
ADD COLUMN     "stoppedBy" TEXT;
