-- TASK-215 episode recording: TeleoperationEpisode, plus two columns on
-- TeleoperationSession that record WHICH recorder produced the session's data
-- and where it landed.
--
-- Why an episode table at all. Episode summaries used to be derived on the fly
-- by grouping TeleoperationFrame rows. That works only while the frames are in
-- this database, and the robot agent's EpisodeRecorder writes its frames
-- straight to a LeRobot v3.0 tree on the robot — there are no rows to group.
-- Worse, the two numbers that matter most about an episode were never
-- derivable from the frames at all: how many ticks the recorder LOST, and the
-- rate it really achieved. A missing frame leaves no row to count.
--
-- TeleoperationSession.recorderKind is 'agent' | 'sim' | 'sidecar', nullable
-- for every session recorded before the distinction existed. endSession() reads
-- it to decide who to ask to stop, so it has to survive a server restart —
-- which is why it is a column and not a Map in the service.
--
-- agentDatasetPath is a path ON THE ROBOT. It is deliberately separate from
-- sidecarDatasetPath: that one gates episode control (`nextEpisode` refuses
-- when it is set, because lerobot-record owns episode boundaries), and an
-- agent-recorded session must keep its episode control.

-- AlterTable
ALTER TABLE "TeleoperationSession" ADD COLUMN "recorderKind" TEXT;
ALTER TABLE "TeleoperationSession" ADD COLUMN "agentDatasetPath" TEXT;

-- CreateTable
CREATE TABLE "TeleoperationEpisode" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "episodeIndex" INTEGER NOT NULL,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "droppedFrames" INTEGER NOT NULL DEFAULT 0,
    "durationS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fpsActual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeleoperationEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeleoperationEpisode_sessionId_episodeIndex_key" ON "TeleoperationEpisode"("sessionId", "episodeIndex");

-- CreateIndex
CREATE INDEX "TeleoperationEpisode_sessionId_idx" ON "TeleoperationEpisode"("sessionId");

-- AddForeignKey
ALTER TABLE "TeleoperationEpisode" ADD CONSTRAINT "TeleoperationEpisode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TeleoperationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
