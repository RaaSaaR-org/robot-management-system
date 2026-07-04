-- Catch-up migration: columns / indexes / FKs that were added to schema.prisma
-- via `prisma db push` but never captured in a migration (issue #174, follow-up
-- to #165 which caught the missing *tables*).
--
-- Generated from a fresh `migrate deploy` of prisma/migrations onto a clean
-- PostgreSQL DB, then:
--   prisma migrate diff \
--     --from-schema-datasource prisma/schema.prisma \
--     --to-schema-datamodel    prisma/schema.prisma --script
-- After this migration, `migrate diff --from-migrations … --to-schema-datamodel …`
-- is empty, so a fresh `migrate deploy` produces the same schema as `db push`.
--
-- NOTE for the already-hotfixed prod DB (see #174 "Ops impact"): those columns
-- already exist from the manual `db push`, so mark this migration as applied
-- instead of running it there:
--   prisma migrate resolve --applied 20260701120000_catch_up_db_push_column_drift

-- DropForeignKey
ALTER TABLE "ModelVersion" DROP CONSTRAINT "ModelVersion_skillId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingJob" DROP CONSTRAINT "TrainingJob_datasetId_fkey";

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "huggingFaceRepoId" TEXT;

-- AlterTable
ALTER TABLE "Deployment" ALTER COLUMN "targetRobotTypes" SET NOT NULL,
ALTER COLUMN "targetRobotTypes" SET DEFAULT '[]',
ALTER COLUMN "targetRobotTypes" SET DATA TYPE TEXT,
ALTER COLUMN "targetZones" SET NOT NULL,
ALTER COLUMN "targetZones" SET DEFAULT '[]',
ALTER COLUMN "targetZones" SET DATA TYPE TEXT,
ALTER COLUMN "deployedRobotIds" SET NOT NULL,
ALTER COLUMN "deployedRobotIds" SET DEFAULT '[]',
ALTER COLUMN "deployedRobotIds" SET DATA TYPE TEXT,
ALTER COLUMN "failedRobotIds" SET NOT NULL,
ALTER COLUMN "failedRobotIds" SET DEFAULT '[]',
ALTER COLUMN "failedRobotIds" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Incident" ALTER COLUMN "dataCategories" SET NOT NULL,
ALTER COLUMN "dataCategories" SET DEFAULT '[]',
ALTER COLUMN "dataCategories" SET DATA TYPE TEXT,
ALTER COLUMN "complianceLogIds" SET NOT NULL,
ALTER COLUMN "complianceLogIds" SET DEFAULT '[]',
ALTER COLUMN "complianceLogIds" SET DATA TYPE TEXT,
ALTER COLUMN "alertIds" SET NOT NULL,
ALTER COLUMN "alertIds" SET DEFAULT '[]',
ALTER COLUMN "alertIds" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "LegalHold" ALTER COLUMN "logIds" SET NOT NULL,
ALTER COLUMN "logIds" SET DEFAULT '[]',
ALTER COLUMN "logIds" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "ModelVersion" ADD COLUMN     "modelType" TEXT NOT NULL DEFAULT 'vla',
ALTER COLUMN "skillId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProcessDefinition" ADD COLUMN     "cronExpression" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastScheduledRunAt" TIMESTAMP(3),
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "triggerType" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "RegulatoryDeadline" ALTER COLUMN "requirements" SET NOT NULL,
ALTER COLUMN "requirements" SET DEFAULT '[]',
ALTER COLUMN "requirements" SET DATA TYPE TEXT,
ALTER COLUMN "completedRequirements" SET NOT NULL,
ALTER COLUMN "completedRequirements" SET DEFAULT '[]',
ALTER COLUMN "completedRequirements" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "RiskAssessment" ALTER COLUMN "triggerConditions" SET NOT NULL,
ALTER COLUMN "triggerConditions" SET DEFAULT '[]',
ALTER COLUMN "triggerConditions" SET DATA TYPE TEXT,
ALTER COLUMN "triggeredUpdates" SET NOT NULL,
ALTER COLUMN "triggeredUpdates" SET DEFAULT '[]',
ALTER COLUMN "triggeredUpdates" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Robot" ALTER COLUMN "batteryLevel" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RobotTelemetry" ALTER COLUMN "batteryLevel" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RobotType" ALTER COLUMN "capabilities" SET NOT NULL,
ALTER COLUMN "capabilities" SET DEFAULT '[]',
ALTER COLUMN "capabilities" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "RopaEntry" ALTER COLUMN "dataCategories" SET NOT NULL,
ALTER COLUMN "dataCategories" SET DEFAULT '[]',
ALTER COLUMN "dataCategories" SET DATA TYPE TEXT,
ALTER COLUMN "dataSubjects" SET NOT NULL,
ALTER COLUMN "dataSubjects" SET DEFAULT '[]',
ALTER COLUMN "dataSubjects" SET DATA TYPE TEXT,
ALTER COLUMN "recipients" SET NOT NULL,
ALTER COLUMN "recipients" SET DEFAULT '[]',
ALTER COLUMN "recipients" SET DATA TYPE TEXT,
ALTER COLUMN "securityMeasures" SET NOT NULL,
ALTER COLUMN "securityMeasures" SET DEFAULT '[]',
ALTER COLUMN "securityMeasures" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "SimToRealValidation" ADD COLUMN     "embodimentTag" TEXT,
ADD COLUMN     "simSceneId" TEXT,
ADD COLUMN     "twinId" TEXT,
ALTER COLUMN "syntheticJobId" DROP NOT NULL,
ALTER COLUMN "realSuccessRate" DROP NOT NULL,
ALTER COLUMN "domainGapScore" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SkillDefinition" ALTER COLUMN "requiredCapabilities" SET NOT NULL,
ALTER COLUMN "requiredCapabilities" SET DEFAULT '[]',
ALTER COLUMN "requiredCapabilities" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "TeleoperationSession" ADD COLUMN     "datasetRepoId" TEXT,
ADD COLUMN     "episodeTimeS" DOUBLE PRECISION,
ADD COLUMN     "numEpisodes" INTEGER,
ADD COLUMN     "sidecarDatasetPath" TEXT;

-- AlterTable
ALTER TABLE "TrainingJob" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'supervised',
ADD COLUMN     "sceneId" TEXT,
ADD COLUMN     "twinId" TEXT,
ALTER COLUMN "datasetId" DROP NOT NULL,
ALTER COLUMN "baseModel" DROP NOT NULL,
ALTER COLUMN "fineTuneMethod" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "forcePasswordChange" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastPasswordChange" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "loginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryCodes" TEXT;

-- CreateIndex
CREATE INDEX "Dataset_huggingFaceRepoId_idx" ON "Dataset"("huggingFaceRepoId");

-- CreateIndex
CREATE INDEX "ModelVersion_trainingJobId_idx" ON "ModelVersion"("trainingJobId");

-- CreateIndex
CREATE INDEX "ProcessDefinition_triggerType_enabled_idx" ON "ProcessDefinition"("triggerType", "enabled");

-- CreateIndex
CREATE INDEX "ProcessDefinition_nextRunAt_idx" ON "ProcessDefinition"("nextRunAt");

-- CreateIndex
CREATE INDEX "SimToRealValidation_twinId_idx" ON "SimToRealValidation"("twinId");

-- CreateIndex
CREATE INDEX "TrainingJob_kind_idx" ON "TrainingJob"("kind");

-- AddForeignKey
ALTER TABLE "TrainingJob" ADD CONSTRAINT "TrainingJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingJob" ADD CONSTRAINT "TrainingJob_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "SimScene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
