-- TASK-239: let a training run start from an existing model.
--
-- Every run started from one of six foundation models, so "continue this
-- fine-tune" was not a sentence the schema could say. Two nullable columns say
-- it: the run's weights come from a registered ModelVersion, or from one
-- ModelCheckpoint of a run that is still going.

-- ── TrainingJob: where the weights come from ────────────────────────────────
--
-- At most one of the two is set. Deliberately NOT a CHECK constraint: the
-- service has to load the referenced row anyway — to resolve its artifact URI
-- and to compare its base model with this run's — so the guard lives where it
-- can say "a run starts from one thing" instead of surfacing a constraint name.
--
-- `baseModel` is untouched and stays required: a run initialised from a
-- groot_n1_7 fine-tune is still a groot_n1_7 run, and the worker picks its
-- trainer from that column, not from the weights it is handed.
ALTER TABLE "TrainingJob" ADD COLUMN "initFromModelVersionId" TEXT;
ALTER TABLE "TrainingJob" ADD COLUMN "initFromCheckpointId" TEXT;

CREATE INDEX "TrainingJob_initFromModelVersionId_idx" ON "TrainingJob"("initFromModelVersionId");
CREATE INDEX "TrainingJob_initFromCheckpointId_idx" ON "TrainingJob"("initFromCheckpointId");

-- SET NULL on both, matching the ModelVersion lineage edge added in TASK-238:
-- deleting the model or checkpoint a run started from must not delete the run.
-- A dangling id would be worse than a null — the export manifest would cite an
-- artifact nobody can resolve, and no reader could tell that from a live one.
ALTER TABLE "TrainingJob" ADD CONSTRAINT "TrainingJob_initFromModelVersionId_fkey" FOREIGN KEY ("initFromModelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingJob" ADD CONSTRAINT "TrainingJob_initFromCheckpointId_fkey" FOREIGN KEY ("initFromCheckpointId") REFERENCES "ModelCheckpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
