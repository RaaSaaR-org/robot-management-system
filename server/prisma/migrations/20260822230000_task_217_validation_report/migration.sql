-- TASK-217: keep what validation FOUND, rather than reconstructing an
-- approximation of it from the row's own numbers.
--
-- `DatasetResponse.qualityBreakdown` was rebuilt on every read out of
-- `demonstrationCount` and `totalDuration`, with a literal 70% of the diversity
-- points and "assume compliant if ready" for format compliance. It therefore
-- agreed with itself no matter what the files on disk said, and there was
-- nowhere for the one finding that matters most — "this dataset has no camera
-- features, a VLA cannot train on it" — to be recorded.
--
-- NULLABLE, and null means NOT VALIDATED. That is deliberately distinguishable
-- from validated-and-clean: `register-local-dataset.ts` has always written
-- `status: 'ready'` directly, so every locally registered dataset in this
-- database has passed no check at all, and a UI that cannot tell the two apart
-- would show a green tick for a dataset nobody has looked at.
ALTER TABLE "Dataset" ADD COLUMN "validationJson" TEXT;

-- And a place to keep an operator's judgement about one episode.
--
-- `PATCH /:id/episodes/:index/flag` answered `{success:true}` and stored
-- nothing; `GET /:id/flagged` always answered `[]`; `POST /:id/trajectories/
-- :idx/unflag` answered with a reviewedAt timestamp for a review it did not
-- record. The viewer showed a flag control in front of all three. Keyed on
-- (datasetId, episodeIndex) like EpisodeReward, because an episode is a row
-- range in a parquet and this database has never held one.
CREATE TABLE "DatasetEpisodeFlag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "datasetId" TEXT NOT NULL,
    "episodeIndex" INTEGER NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "reviewDecision" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetEpisodeFlag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DatasetEpisodeFlag_datasetId_episodeIndex_key" ON "DatasetEpisodeFlag"("datasetId", "episodeIndex");
CREATE INDEX "DatasetEpisodeFlag_datasetId_idx" ON "DatasetEpisodeFlag"("datasetId");
CREATE INDEX "DatasetEpisodeFlag_datasetId_flagged_idx" ON "DatasetEpisodeFlag"("datasetId", "flagged");
