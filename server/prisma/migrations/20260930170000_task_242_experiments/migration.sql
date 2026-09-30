-- TASK-242: the experiment loop. An Experiment groups arms that each train,
-- evaluate in sim and get rated; nothing runs until a human approves it.
--
-- EvaluationEpisode learns to hold a simulated rollout: robotId becomes
-- nullable (a sim rollout ran on no robot) and `source` says which kind a row
-- is, so the real-hardware success-rate derivation can keep reading 'real' only.
ALTER TABLE "EvaluationEpisode" ALTER COLUMN "robotId" DROP NOT NULL;
ALTER TABLE "EvaluationEpisode" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'real';
CREATE INDEX "EvaluationEpisode_source_idx" ON "EvaluationEpisode"("source");

CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "fineTuneMethod" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "budgetJson" TEXT NOT NULL DEFAULT '{}',
    "evaluationJson" TEXT NOT NULL DEFAULT '{}',
    "baselineArmId" TEXT,
    "verdictJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExperimentArm" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "datasetRefsJson" TEXT NOT NULL DEFAULT '[]',
    "initFromModelVersionId" TEXT,
    "hyperparametersJson" TEXT NOT NULL DEFAULT '{}',
    "trainingJobId" TEXT,
    "modelVersionId" TEXT,
    "simJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "resultJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExperimentArm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Experiment_status_createdAt_idx" ON "Experiment"("status", "createdAt");
CREATE INDEX "Experiment_tenantId_createdAt_idx" ON "Experiment"("tenantId", "createdAt");
CREATE INDEX "ExperimentArm_experimentId_idx" ON "ExperimentArm"("experimentId");
CREATE INDEX "ExperimentArm_trainingJobId_idx" ON "ExperimentArm"("trainingJobId");
CREATE INDEX "ExperimentArm_simJobId_idx" ON "ExperimentArm"("simJobId");

ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
