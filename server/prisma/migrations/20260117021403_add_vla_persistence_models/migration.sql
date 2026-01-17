-- CreateTable
CREATE TABLE "TeleoperationSession" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "languageInstr" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "exportedDatasetId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeleoperationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetProvenance" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "collectionMethod" TEXT,
    "collectionPeriod" JSONB,
    "labelingProcedure" TEXT,
    "annotatorInfo" TEXT,
    "cleaningSteps" JSONB,
    "licenseType" TEXT,
    "copyrightCompliance" TEXT,
    "chainOfCustody" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingDataSummary" (
    "id" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "datasetIds" JSONB NOT NULL,
    "totalTrajectories" INTEGER NOT NULL,
    "publicDatasets" JSONB,
    "privateDatasets" JSONB,
    "webScrapingSources" JSONB,
    "copyrightMeasures" TEXT NOT NULL,
    "processingPurposes" JSONB NOT NULL,
    "knownGaps" JSONB NOT NULL,
    "limitations" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextUpdateDue" TIMESTAMP(3) NOT NULL,
    "generatedBy" TEXT NOT NULL,

    CONSTRAINT "TrainingDataSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiasAssessment" (
    "id" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "assessmentVersion" INTEGER NOT NULL DEFAULT 1,
    "demographicCoverage" JSONB NOT NULL,
    "geographicCoverage" JSONB,
    "taskCoverage" JSONB,
    "knownLimitations" JSONB NOT NULL,
    "potentialBiasSources" JSONB NOT NULL,
    "mitigationMeasures" JSONB NOT NULL,
    "testingResults" JSONB,
    "assessedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "assessmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,

    CONSTRAINT "BiasAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeleoperationFrame" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "frameIndex" INTEGER NOT NULL,
    "timestamp" DOUBLE PRECISION NOT NULL,
    "jointPositions" JSONB NOT NULL,
    "jointVelocities" JSONB,
    "action" JSONB NOT NULL,
    "imagePath" TEXT,
    "depthImagePath" TEXT,
    "isIntervention" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TeleoperationFrame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyntheticJob" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "embodiment" TEXT NOT NULL,
    "trajectoryCount" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "successfulCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "processingRate" DOUBLE PRECISION,
    "estimatedTimeRemaining" DOUBLE PRECISION,
    "outputDatasetId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyntheticJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimToRealValidation" (
    "id" TEXT NOT NULL,
    "syntheticJobId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "validationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "simSuccessRate" DOUBLE PRECISION NOT NULL,
    "realSuccessRate" DOUBLE PRECISION NOT NULL,
    "domainGapScore" DOUBLE PRECISION NOT NULL,
    "realTestCount" INTEGER NOT NULL,
    "taskCategories" JSONB NOT NULL,
    "perTaskMetrics" JSONB,
    "notes" TEXT,

    CONSTRAINT "SimToRealValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederatedRound" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "globalModelVersion" TEXT NOT NULL,
    "newModelVersion" TEXT,
    "config" JSONB NOT NULL,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "completedParticipants" INTEGER NOT NULL DEFAULT 0,
    "failedParticipants" INTEGER NOT NULL DEFAULT 0,
    "totalLocalSamples" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederatedRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederatedParticipant" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'selected',
    "localSamples" INTEGER,
    "localLoss" DOUBLE PRECISION,
    "aggregationWeight" DOUBLE PRECISION,
    "privacyBudgetUsed" DOUBLE PRECISION,
    "failureReason" TEXT,
    "modelReceivedAt" TIMESTAMP(3),
    "trainingStartedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),

    CONSTRAINT "FederatedParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotPrivacyBudget" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "totalEpsilon" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "usedEpsilon" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "remainingEpsilon" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "roundsParticipated" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobotPrivacyBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionRecord" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "interventionType" TEXT NOT NULL,
    "confidenceBefore" DOUBLE PRECISION,
    "confidenceAfter" DOUBLE PRECISION,
    "description" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionLog" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "taskCategory" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "wasCorrect" BOOLEAN,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTarget" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "estimatedDemos" INTEGER NOT NULL,
    "collectedDemos" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeleoperationSession_operatorId_idx" ON "TeleoperationSession"("operatorId");

-- CreateIndex
CREATE INDEX "TeleoperationSession_robotId_idx" ON "TeleoperationSession"("robotId");

-- CreateIndex
CREATE INDEX "TeleoperationSession_status_idx" ON "TeleoperationSession"("status");

-- CreateIndex
CREATE INDEX "TeleoperationSession_type_idx" ON "TeleoperationSession"("type");

-- CreateIndex
CREATE INDEX "TeleoperationSession_createdAt_idx" ON "TeleoperationSession"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetProvenance_datasetId_key" ON "DatasetProvenance"("datasetId");

-- CreateIndex
CREATE INDEX "DatasetProvenance_datasetId_idx" ON "DatasetProvenance"("datasetId");

-- CreateIndex
CREATE INDEX "DatasetProvenance_sourceType_idx" ON "DatasetProvenance"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingDataSummary_modelVersionId_key" ON "TrainingDataSummary"("modelVersionId");

-- CreateIndex
CREATE INDEX "TrainingDataSummary_modelVersionId_idx" ON "TrainingDataSummary"("modelVersionId");

-- CreateIndex
CREATE INDEX "TrainingDataSummary_nextUpdateDue_idx" ON "TrainingDataSummary"("nextUpdateDue");

-- CreateIndex
CREATE INDEX "BiasAssessment_modelVersionId_idx" ON "BiasAssessment"("modelVersionId");

-- CreateIndex
CREATE INDEX "BiasAssessment_status_idx" ON "BiasAssessment"("status");

-- CreateIndex
CREATE INDEX "BiasAssessment_assessmentDate_idx" ON "BiasAssessment"("assessmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "BiasAssessment_modelVersionId_assessmentVersion_key" ON "BiasAssessment"("modelVersionId", "assessmentVersion");

-- CreateIndex
CREATE INDEX "TeleoperationFrame_sessionId_idx" ON "TeleoperationFrame"("sessionId");

-- CreateIndex
CREATE INDEX "TeleoperationFrame_timestamp_idx" ON "TeleoperationFrame"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TeleoperationFrame_sessionId_frameIndex_key" ON "TeleoperationFrame"("sessionId", "frameIndex");

-- CreateIndex
CREATE INDEX "SyntheticJob_status_idx" ON "SyntheticJob"("status");

-- CreateIndex
CREATE INDEX "SyntheticJob_task_idx" ON "SyntheticJob"("task");

-- CreateIndex
CREATE INDEX "SyntheticJob_embodiment_idx" ON "SyntheticJob"("embodiment");

-- CreateIndex
CREATE INDEX "SyntheticJob_createdAt_idx" ON "SyntheticJob"("createdAt");

-- CreateIndex
CREATE INDEX "SimToRealValidation_syntheticJobId_idx" ON "SimToRealValidation"("syntheticJobId");

-- CreateIndex
CREATE INDEX "SimToRealValidation_modelVersionId_idx" ON "SimToRealValidation"("modelVersionId");

-- CreateIndex
CREATE INDEX "SimToRealValidation_validationDate_idx" ON "SimToRealValidation"("validationDate");

-- CreateIndex
CREATE INDEX "FederatedRound_status_idx" ON "FederatedRound"("status");

-- CreateIndex
CREATE INDEX "FederatedRound_globalModelVersion_idx" ON "FederatedRound"("globalModelVersion");

-- CreateIndex
CREATE INDEX "FederatedRound_createdAt_idx" ON "FederatedRound"("createdAt");

-- CreateIndex
CREATE INDEX "FederatedParticipant_roundId_idx" ON "FederatedParticipant"("roundId");

-- CreateIndex
CREATE INDEX "FederatedParticipant_robotId_idx" ON "FederatedParticipant"("robotId");

-- CreateIndex
CREATE INDEX "FederatedParticipant_status_idx" ON "FederatedParticipant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FederatedParticipant_roundId_robotId_key" ON "FederatedParticipant"("roundId", "robotId");

-- CreateIndex
CREATE UNIQUE INDEX "RobotPrivacyBudget_robotId_key" ON "RobotPrivacyBudget"("robotId");

-- CreateIndex
CREATE INDEX "RobotPrivacyBudget_robotId_idx" ON "RobotPrivacyBudget"("robotId");

-- CreateIndex
CREATE INDEX "InterventionRecord_robotId_idx" ON "InterventionRecord"("robotId");

-- CreateIndex
CREATE INDEX "InterventionRecord_task_idx" ON "InterventionRecord"("task");

-- CreateIndex
CREATE INDEX "InterventionRecord_timestamp_idx" ON "InterventionRecord"("timestamp");

-- CreateIndex
CREATE INDEX "PredictionLog_modelId_taskCategory_idx" ON "PredictionLog"("modelId", "taskCategory");

-- CreateIndex
CREATE INDEX "PredictionLog_modelId_environment_idx" ON "PredictionLog"("modelId", "environment");

-- CreateIndex
CREATE INDEX "PredictionLog_modelId_timestamp_idx" ON "PredictionLog"("modelId", "timestamp");

-- CreateIndex
CREATE INDEX "PredictionLog_timestamp_idx" ON "PredictionLog"("timestamp");

-- CreateIndex
CREATE INDEX "CollectionTarget_status_idx" ON "CollectionTarget"("status");

-- CreateIndex
CREATE INDEX "CollectionTarget_targetType_idx" ON "CollectionTarget"("targetType");

-- CreateIndex
CREATE INDEX "CollectionTarget_priorityScore_idx" ON "CollectionTarget"("priorityScore");

-- AddForeignKey
ALTER TABLE "TeleoperationFrame" ADD CONSTRAINT "TeleoperationFrame_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TeleoperationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimToRealValidation" ADD CONSTRAINT "SimToRealValidation_syntheticJobId_fkey" FOREIGN KEY ("syntheticJobId") REFERENCES "SyntheticJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederatedParticipant" ADD CONSTRAINT "FederatedParticipant_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "FederatedRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
