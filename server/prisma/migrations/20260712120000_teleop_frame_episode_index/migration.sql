-- VR/sim teleoperation data collection: episodes within a session.
-- Adds TeleoperationFrame.episodeIndex so the server-side SimFrameRecorder can
-- group frames into LeRobot episodes at export time.
-- Applied to the local SQLite dev DB via `prisma db push`; this migration
-- captures the same change in PostgreSQL dialect so `prisma migrate deploy`
-- creates it in production.

-- AlterTable
ALTER TABLE "TeleoperationFrame" ADD COLUMN "episodeIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "TeleoperationFrame_sessionId_episodeIndex_idx" ON "TeleoperationFrame"("sessionId", "episodeIndex");
