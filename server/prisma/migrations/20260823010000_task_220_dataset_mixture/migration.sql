-- TASK-220: import a Hub dataset, mix it with another, export the run.
--
-- Three columns of provenance on Dataset, and one join table that lets a
-- training job name more than one dataset.

-- ── Dataset provenance ──────────────────────────────────────────────────────
--
-- The HF revision was kept only inside the description STRING — "Imported from
-- HuggingFace: nvidia/GR00T-N1.7-AppleToPlate (main)". "main" is not a
-- revision; it is a pointer that moves. A training run citing its data as
-- "main" cites nothing, which makes a result unreproducible and an EU AI Act
-- technical file untrue. Resolved to a commit SHA at import time and pinned.
ALTER TABLE "Dataset" ADD COLUMN "sourceRevision" TEXT;

-- 'full' | 'metadata'. Validation has to be able to tell the difference
-- between a dataset that is missing its videos because the operator asked for
-- metadata only, and one that is missing them because it is broken. Without
-- this column those are the same state, and the first one is reported as 402
-- MISSING_VIDEO_FILE errors on a dataset that imported exactly as requested.
ALTER TABLE "Dataset" ADD COLUMN "importMode" TEXT;

-- JSON { phase, error, repoId, failedAt } — why an import failed, kept.
--
-- The reason previously existed only as a single WebSocket broadcast. A failure
-- that takes 300 ms fires it before the browser has finished opening its
-- socket, so the card read "Failed" with no reason, and no reload could ever
-- recover one. Measured: nvidia/GR00T-N1.7-AppleToPlate failed 305 ms after
-- the POST, and the row carried nothing but the word.
ALTER TABLE "Dataset" ADD COLUMN "importErrorJson" TEXT;

-- ── The mixture ─────────────────────────────────────────────────────────────
--
-- `TrainingJob.datasetId` is a single nullable FK and STAYS one. Every existing
-- row, every existing query and the wizard's single-select keep working. A
-- multi-dataset job writes both: `datasetId` = the member at position 0,
-- `TrainingJobDataset` = all of them.
--
-- A mixture rather than a merge, because merging is frequently the wrong
-- operation for this data. nvidia/GR00T-N1.7-AppleToPlate is 43-wide
-- `unitree_g1` in the v2.1 layout; unitreerobotics/G1_Dex3_* is 28-wide
-- `Unitree_G1_Dex3` in v3.0. Same robot family, different action space — one
-- drives the whole body, the other two arms. Concatenated, the `action` column
-- would have no single meaning. Both LeRobot's MultiLeRobotDataset and GR00T's
-- per-embodiment projectors consume a LIST of datasets, so the list is also
-- what the trainer wants, and the only form exportable without moving a
-- gigabyte of parquet.
CREATE TABLE "TrainingJobDataset" (
    "id" TEXT NOT NULL,
    "trainingJobId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    -- Not normalised here. The export manifest normalises, so an operator can
    -- type 3 and 1 instead of 0.75 and 0.25.
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingJobDataset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingJobDataset_trainingJobId_datasetId_key" ON "TrainingJobDataset"("trainingJobId", "datasetId");
CREATE INDEX "TrainingJobDataset_trainingJobId_idx" ON "TrainingJobDataset"("trainingJobId");
CREATE INDEX "TrainingJobDataset_datasetId_idx" ON "TrainingJobDataset"("datasetId");

-- Cascade on the job: a deleted job's membership rows are meaningless. NOT on
-- the dataset — a dataset that is part of a training run's lineage must not be
-- deletable out from under it silently.
ALTER TABLE "TrainingJobDataset" ADD CONSTRAINT "TrainingJobDataset_trainingJobId_fkey" FOREIGN KEY ("trainingJobId") REFERENCES "TrainingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingJobDataset" ADD CONSTRAINT "TrainingJobDataset_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
