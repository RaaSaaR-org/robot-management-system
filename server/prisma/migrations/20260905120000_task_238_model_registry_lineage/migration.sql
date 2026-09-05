-- TASK-238: make the model registry writable and give it a lineage.
--
-- Three things the registry could not express: a model this server did not
-- train, the model a model came from, and the checkpoints a training run
-- produced. Plus a real foreign key from an evaluation to the model it
-- evaluated, next to the free string that is all the existing rows have.

-- ── ModelVersion: name, provenance, lineage ─────────────────────────────────
--
-- `version` is `v${Date.now()}` for everything this server trains, so the only
-- name a model has is its dataset's skill — and that is null for all of them.
-- A registry whose entries cannot be named is a list of timestamps.
ALTER TABLE "ModelVersion" ADD COLUMN "name" TEXT;

-- 'training' | 'imported' | 'derived'. An externally trained checkpoint
-- (a GR00T fine-tune registered by hand) must be distinguishable from one this
-- server produced, because only the latter has a TrainingJob to explain it.
ALTER TABLE "ModelVersion" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'training';

-- The model this one was fine-tuned from. Without it a derived model cannot
-- say what it is derived from, and the chain back to the base checkpoint lives
-- only in whoever ran the job.
ALTER TABLE "ModelVersion" ADD COLUMN "parentModelVersionId" TEXT;

-- An imported model has no training job on this server. The column was NOT
-- NULL, which made registering one impossible — the FK is the whole reason the
-- registry was read-only.
ALTER TABLE "ModelVersion" ALTER COLUMN "trainingJobId" DROP NOT NULL;

-- Re-issued because a nullable relation clears the child rather than blocking
-- the delete: RESTRICT on a now-optional column would keep refusing deletes it
-- no longer needs to refuse.
ALTER TABLE "ModelVersion" DROP CONSTRAINT "ModelVersion_trainingJobId_fkey";
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_trainingJobId_fkey" FOREIGN KEY ("trainingJobId") REFERENCES "TrainingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ModelVersion_parentModelVersionId_idx" ON "ModelVersion"("parentModelVersionId");

-- SET NULL, not CASCADE: a derived model outlives the model it came from.
-- Losing the lineage edge is recoverable; deleting a deployed fine-tune
-- because someone archived its ancestor is not.
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_parentModelVersionId_fkey" FOREIGN KEY ("parentModelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── ModelCheckpoint ─────────────────────────────────────────────────────────
--
-- Checkpoints were an in-memory Map on TrainingOrchestrator. A worker reported
-- every epoch, the server held them until it restarted, and then the run's
-- intermediate artifacts existed only as URIs nobody had written down.
--
-- `modelVersionId` is nullable because checkpoints arrive while the job is
-- still running — the ModelVersion that job will produce does not exist yet.
CREATE TABLE "ModelCheckpoint" (
    "id" TEXT NOT NULL,
    "modelVersionId" TEXT,
    "trainingJobId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "uri" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCheckpoint_pkey" PRIMARY KEY ("id")
);

-- Unique on the pair so a worker that re-reports an epoch (a retry, a resumed
-- run) upserts instead of appending a duplicate.
CREATE UNIQUE INDEX "ModelCheckpoint_trainingJobId_epoch_key" ON "ModelCheckpoint"("trainingJobId", "epoch");
CREATE INDEX "ModelCheckpoint_modelVersionId_idx" ON "ModelCheckpoint"("modelVersionId");

ALTER TABLE "ModelCheckpoint" ADD CONSTRAINT "ModelCheckpoint_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Cascade on the job: a deleted job's per-epoch rows describe nothing.
ALTER TABLE "ModelCheckpoint" ADD CONSTRAINT "ModelCheckpoint_trainingJobId_fkey" FOREIGN KEY ("trainingJobId") REFERENCES "TrainingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EvaluationEpisode: anchor an evaluation to a model row ──────────────────
--
-- `modelVersion` is a free string with an index but no key, so a typo silently
-- creates a second model in the charts and "every evaluation of this model" is
-- not answerable. The string STAYS: existing rows only have it, and a
-- migration that guesses an id produces wrong answers rather than missing ones.
ALTER TABLE "EvaluationEpisode" ADD COLUMN "modelVersionId" TEXT;

-- Backfill on exact match only, and only where the version string identifies
-- exactly one model. `ModelVersion.version` is unique per (skillId, version),
-- not globally, so an ambiguous string is left null rather than attached to an
-- arbitrary one of its candidates.
UPDATE "EvaluationEpisode" e
SET "modelVersionId" = m."id"
FROM (
    SELECT "version", MIN("id") AS "id"
    FROM "ModelVersion"
    GROUP BY "version"
    HAVING COUNT(*) = 1
) m
WHERE m."version" = e."modelVersion";

CREATE INDEX "EvaluationEpisode_modelVersionId_idx" ON "EvaluationEpisode"("modelVersionId");

ALTER TABLE "EvaluationEpisode" ADD CONSTRAINT "EvaluationEpisode_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
