-- TASK-240: a dataset fork is a selection over a parent, not a copy of its bytes.
--
-- An agent testing twenty data variations was writing twenty dataset
-- directories, because `curate.py` is non-destructive by rebuilding the whole
-- tree — every per-episode video copied and renumbered, trimmed ones
-- re-encoded. Correct, and far too expensive per experiment arm.
--
-- A view is a Dataset ROW rather than its own model: `kind = 'view'`, a
-- `parentDatasetId`, a resolved episode selection, empty `storagePath`. Every
-- foreign key that already points at a dataset — TrainingJob.datasetId,
-- TrainingJobDataset, Dataset.skillId, the export manifest — keeps working
-- with no second code path. The price is one rule the code has to hold up:
-- resolution lives in exactly one place (DatasetViewService.resolve).

-- ── Dataset: what this row is, and what it was forked from ─────────────────
--
-- 'materialized' as the default is what makes this migration safe on a
-- populated database: every existing row IS materialized — it has bytes under
-- storagePath — so backfilling is a default, not an UPDATE.
ALTER TABLE "Dataset" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'materialized';
ALTER TABLE "Dataset" ADD COLUMN "parentDatasetId" TEXT;

-- The selection, stored RESOLVED (JSON DatasetSelection). Never a live query:
-- a view built from "reward >= 0.7" must not change meaning when a later
-- reward job rewrites the scores, or the arm a finished run was trained on is
-- no longer the arm the report describes.
ALTER TABLE "Dataset" ADD COLUMN "selectionJson" TEXT;

-- Set the first time a training job cites the view; a frozen view refuses
-- edits. Copy-on-write at the metadata level rather than at the byte level.
ALTER TABLE "Dataset" ADD COLUMN "frozenAt" TIMESTAMP(3);

-- Set only by the escape hatch (`materialize`), when a consumer genuinely
-- cannot take an episode filter. Null is the normal state and the whole point.
ALTER TABLE "Dataset" ADD COLUMN "materializedPath" TEXT;

CREATE INDEX "Dataset_parentDatasetId_idx" ON "Dataset"("parentDatasetId");

-- RESTRICT, not SET NULL — the opposite of the TASK-239 lineage edges, and
-- deliberately so. A run whose init-from model was deleted is still a run that
-- happened; a view whose parent was deleted is not a dataset at all, because
-- its every episode is an index INTO that parent. SET NULL would leave a row
-- claiming `kind = 'view'` that nothing can resolve and no reader can tell
-- from a live one, so the delete path is made to deal with derived rows while
-- they still exist.
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_parentDatasetId_fkey" FOREIGN KEY ("parentDatasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
