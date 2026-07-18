-- TASK-193 video-to-motion: retargeted motion clips from the offline GVHMR→GMR
-- pipeline, stored frames-inline (a clip is ~66 KB, unlike the megabyte point
-- clouds that justify SensorScan's object storage).
-- Applied to the local SQLite dev DB via `prisma db push`; this migration
-- captures the same change in PostgreSQL dialect so `prisma migrate deploy`
-- creates the table in production.

-- CreateTable
CREATE TABLE "MotionClip" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'gmr',
    "robotType" TEXT NOT NULL DEFAULT 'unitree_g1_29dof',
    -- REAL/DOUBLE, not INTEGER: clips come from video and NTSC rates (29.97) are
    -- non-integer; truncating to 29 drifts a 20-minute clip by ~40 s.
    "fps" DOUBLE PRECISION NOT NULL,
    "frameCount" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "jointNames" TEXT NOT NULL DEFAULT '[]',
    "rootRotOrder" TEXT NOT NULL DEFAULT 'xyzw',
    "upAxis" TEXT NOT NULL DEFAULT 'z',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "metadata" TEXT,
    "frames" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotionClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MotionClip_createdAt_idx" ON "MotionClip"("createdAt");
