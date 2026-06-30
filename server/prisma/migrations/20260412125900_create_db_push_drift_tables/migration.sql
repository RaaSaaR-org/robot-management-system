-- Catch-up migration: create tables that were added to schema.prisma via
-- `prisma db push` but never captured in a migration (see PR description).
-- Placed before 20260412130000_task_158_wave_3bcd_remaining_models so the
-- ALTER TABLE "SimulationJob" in that migration has a table to alter.
-- SimulationJob is created WITHOUT tenantId here; wave_3bcd adds tenantId,
-- its index and its FK.

-- CreateTable
CREATE TABLE "SensorScan" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "sensorName" TEXT NOT NULL,
    "sensorType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pcd',
    "pointCount" INTEGER NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "hasIntensity" BOOLEAN NOT NULL DEFAULT true,
    "storageBackend" TEXT NOT NULL DEFAULT 'rustfs',
    "storageBucket" TEXT NOT NULL DEFAULT 'sensor-scans',
    "storageKey" TEXT NOT NULL,
    "minX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sessionId" TEXT,
    "frameIndex" INTEGER,
    "poseX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poseY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poseZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poseQx" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poseQy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poseQz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poseQw" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensorScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalTwin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "robotId" TEXT,
    "floor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "worldOriginX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "worldOriginY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "worldOriginZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resolution" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "minX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointCount" INTEGER NOT NULL DEFAULT 0,
    "storageBackend" TEXT NOT NULL DEFAULT 'local',
    "cloudKey" TEXT,
    "meshKey" TEXT,
    "occupancyPgmKey" TEXT,
    "occupancyYamlKey" TEXT,
    "roadmapKey" TEXT,
    "simSceneKey" TEXT,
    "simSceneBackend" TEXT,
    "errorMessage" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalTwin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanSession" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "twinId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "originX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "originY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "originZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "workerId" TEXT,
    "lastHeartbeat" TIMESTAMP(3),
    "errorMessage" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwinZone" (
    "id" TEXT NOT NULL,
    "twinId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'keepout',
    "points" TEXT NOT NULL DEFAULT '[]',
    "minZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxZ" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "color" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwinZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCertificate" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "certificate" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "language" TEXT NOT NULL DEFAULT 'en',
    "compactMode" BOOLEAN NOT NULL DEFAULT false,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceReminders" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT false,
    "defaultDashboardView" TEXT NOT NULL DEFAULT 'fleet',
    "refreshIntervalSec" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MFACredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MFACredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLockout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastAttempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLockout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimScene" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'builtin',
    "builtinEnvId" TEXT,
    "twinId" TEXT,
    "embodimentTag" TEXT NOT NULL DEFAULT 'so101',
    "backend" TEXT NOT NULL DEFAULT 'mujoco',
    "mjcfKey" TEXT,
    "usdKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "minX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxZ" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationJob" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sceneId" TEXT,
    "backend" TEXT NOT NULL,
    "rolloutCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION,
    "avgSteps" DOUBLE PRECISION,
    "collisionCount" INTEGER,
    "avgDuration" DOUBLE PRECISION,
    "simToRealGap" DOUBLE PRECISION,
    "totalEpisodes" INTEGER,
    "successfulEpisodes" INTEGER,
    "framesDir" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationFrame" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "episode" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,

    CONSTRAINT "SimulationFrame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationEpisode" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "taskPrompt" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorType" TEXT,
    "videoUrl" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdatePackage" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdatePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateDeployment" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "previousVersion" TEXT,
    "deployedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataContribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "episodeCount" INTEGER NOT NULL DEFAULT 0,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "creditAwarded" INTEGER NOT NULL DEFAULT 0,
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VlaSession" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "prompt" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VlaSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SensorScan_robotId_capturedAt_idx" ON "SensorScan"("robotId", "capturedAt");
-- CreateIndex
CREATE INDEX "SensorScan_capturedAt_idx" ON "SensorScan"("capturedAt");
-- CreateIndex
CREATE INDEX "SensorScan_sessionId_frameIndex_idx" ON "SensorScan"("sessionId", "frameIndex");
-- CreateIndex
CREATE INDEX "DigitalTwin_robotId_idx" ON "DigitalTwin"("robotId");
-- CreateIndex
CREATE INDEX "DigitalTwin_status_idx" ON "DigitalTwin"("status");
-- CreateIndex
CREATE INDEX "DigitalTwin_tenantId_updatedAt_idx" ON "DigitalTwin"("tenantId", "updatedAt");
-- CreateIndex
CREATE INDEX "ScanSession_twinId_idx" ON "ScanSession"("twinId");
-- CreateIndex
CREATE INDEX "ScanSession_robotId_idx" ON "ScanSession"("robotId");
-- CreateIndex
CREATE INDEX "ScanSession_status_idx" ON "ScanSession"("status");
-- CreateIndex
CREATE INDEX "ScanSession_workerId_lastHeartbeat_idx" ON "ScanSession"("workerId", "lastHeartbeat");
-- CreateIndex
CREATE INDEX "TwinZone_twinId_idx" ON "TwinZone"("twinId");
-- CreateIndex
CREATE UNIQUE INDEX "DeviceCertificate_robotId_key" ON "DeviceCertificate"("robotId");
-- CreateIndex
CREATE UNIQUE INDEX "DeviceCertificate_fingerprint_key" ON "DeviceCertificate"("fingerprint");
-- CreateIndex
CREATE INDEX "DeviceCertificate_status_idx" ON "DeviceCertificate"("status");
-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");
-- CreateIndex
CREATE INDEX "MFACredential_userId_idx" ON "MFACredential"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "AccountLockout_userId_key" ON "AccountLockout"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "SimScene_builtinEnvId_key" ON "SimScene"("builtinEnvId");
-- CreateIndex
CREATE UNIQUE INDEX "SimScene_twinId_key" ON "SimScene"("twinId");
-- CreateIndex
CREATE INDEX "SimScene_source_idx" ON "SimScene"("source");
-- CreateIndex
CREATE INDEX "SimScene_tenantId_idx" ON "SimScene"("tenantId");
-- CreateIndex
CREATE INDEX "SimulationJob_modelId_status_idx" ON "SimulationJob"("modelId", "status");
-- CreateIndex
CREATE INDEX "SimulationJob_createdAt_idx" ON "SimulationJob"("createdAt");
-- CreateIndex
CREATE INDEX "SimulationFrame_jobId_episode_step_idx" ON "SimulationFrame"("jobId", "episode", "step");
-- CreateIndex
CREATE INDEX "EvaluationEpisode_robotId_idx" ON "EvaluationEpisode"("robotId");
-- CreateIndex
CREATE INDEX "EvaluationEpisode_modelVersion_idx" ON "EvaluationEpisode"("modelVersion");
-- CreateIndex
CREATE INDEX "EvaluationEpisode_createdAt_idx" ON "EvaluationEpisode"("createdAt");
-- CreateIndex
CREATE INDEX "EvaluationEpisode_success_idx" ON "EvaluationEpisode"("success");
-- CreateIndex
CREATE INDEX "UpdatePackage_status_idx" ON "UpdatePackage"("status");
-- CreateIndex
CREATE INDEX "UpdatePackage_version_idx" ON "UpdatePackage"("version");
-- CreateIndex
CREATE INDEX "UpdatePackage_createdAt_idx" ON "UpdatePackage"("createdAt");
-- CreateIndex
CREATE INDEX "UpdateDeployment_packageId_idx" ON "UpdateDeployment"("packageId");
-- CreateIndex
CREATE INDEX "UpdateDeployment_robotId_idx" ON "UpdateDeployment"("robotId");
-- CreateIndex
CREATE INDEX "UpdateDeployment_status_idx" ON "UpdateDeployment"("status");
-- CreateIndex
CREATE INDEX "UpdateDeployment_createdAt_idx" ON "UpdateDeployment"("createdAt");
-- CreateIndex
CREATE INDEX "DataContribution_userId_idx" ON "DataContribution"("userId");
-- CreateIndex
CREATE INDEX "DataContribution_robotId_idx" ON "DataContribution"("robotId");
-- CreateIndex
CREATE INDEX "DataContribution_status_idx" ON "DataContribution"("status");
-- CreateIndex
CREATE INDEX "DataContribution_createdAt_idx" ON "DataContribution"("createdAt");
-- CreateIndex
CREATE INDEX "ContributionCredit_userId_idx" ON "ContributionCredit"("userId");
-- CreateIndex
CREATE INDEX "ContributionCredit_createdAt_idx" ON "ContributionCredit"("createdAt");
-- CreateIndex
CREATE INDEX "VlaSession_robotId_idx" ON "VlaSession"("robotId");
-- CreateIndex
CREATE INDEX "VlaSession_startedAt_idx" ON "VlaSession"("startedAt");

-- AddForeignKey
ALTER TABLE "SensorScan" ADD CONSTRAINT "SensorScan_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ScanSession" ADD CONSTRAINT "ScanSession_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "DigitalTwin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "TwinZone" ADD CONSTRAINT "TwinZone_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "DigitalTwin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DeviceCertificate" ADD CONSTRAINT "DeviceCertificate_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "MFACredential" ADD CONSTRAINT "MFACredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AccountLockout" ADD CONSTRAINT "AccountLockout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SimulationFrame" ADD CONSTRAINT "SimulationFrame_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SimulationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "EvaluationEpisode" ADD CONSTRAINT "EvaluationEpisode_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "UpdateDeployment" ADD CONSTRAINT "UpdateDeployment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "UpdatePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "VlaSession" ADD CONSTRAINT "VlaSession_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
