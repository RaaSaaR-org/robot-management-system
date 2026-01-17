-- CreateTable
CREATE TABLE "Robot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "batteryLevel" INTEGER NOT NULL DEFAULT 100,
    "location" TEXT NOT NULL DEFAULT '{}',
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentTaskId" TEXT,
    "currentTaskName" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "firmware" TEXT,
    "ipAddress" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "a2aEnabled" BOOLEAN NOT NULL DEFAULT false,
    "a2aAgentUrl" TEXT,
    "registeredAt" TIMESTAMP(3),
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthCheck" TIMESTAMP(3),
    "baseUrl" TEXT,

    CONSTRAINT "Robot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotTelemetry" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "batteryLevel" INTEGER NOT NULL,
    "batteryVoltage" DOUBLE PRECISION,
    "batteryTemperature" DOUBLE PRECISION,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "memoryUsage" DOUBLE PRECISION NOT NULL,
    "diskUsage" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "sensors" TEXT NOT NULL DEFAULT '{}',
    "errors" TEXT NOT NULL DEFAULT '[]',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobotTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotCommand" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "result" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RobotCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotEndpoints" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "robot" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "telemetry" TEXT NOT NULL,
    "telemetryWs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotEndpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "robotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" TEXT NOT NULL,
    "conversationId" TEXT,
    "taskId" TEXT,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'submitted',
    "statusMessage" TEXT,
    "statusTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artifacts" TEXT NOT NULL DEFAULT '[]',
    "history" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" TEXT,
    "documentationUrl" TEXT,
    "provider" TEXT,
    "capabilities" TEXT,
    "authentication" TEXT,
    "defaultInputModes" TEXT NOT NULL DEFAULT '[]',
    "defaultOutputModes" TEXT NOT NULL DEFAULT '[]',
    "skills" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "robotId" TEXT,

    CONSTRAINT "AgentCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "dismissable" BOOLEAN NOT NULL DEFAULT true,
    "autoDismissMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bounds" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "avatar" TEXT,
    "tenantId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandInterpretation" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "parameters" TEXT NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL,
    "safetyClassification" TEXT NOT NULL,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "suggestedAlternatives" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'interpreted',
    "executedCommandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "CommandInterpretation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stepTemplates" TEXT NOT NULL DEFAULT '[]',
    "requiredCapabilities" TEXT NOT NULL DEFAULT '[]',
    "estimatedDurationMinutes" INTEGER,
    "maxConcurrentInstances" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessInstance" (
    "id" TEXT NOT NULL,
    "processDefinitionId" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "preferredRobotIds" TEXT NOT NULL DEFAULT '[]',
    "assignedRobotIds" TEXT NOT NULL DEFAULT '[]',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimatedCompletionAt" TIMESTAMP(3),
    "inputData" TEXT,
    "outputData" TEXT,
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepInstance" (
    "id" TEXT NOT NULL,
    "processInstanceId" TEXT NOT NULL,
    "stepTemplateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "actionType" TEXT NOT NULL,
    "actionConfig" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedRobotId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "failedRobotIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotTask" (
    "id" TEXT NOT NULL,
    "processInstanceId" TEXT,
    "stepInstanceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "robotId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actionType" TEXT NOT NULL,
    "actionConfig" TEXT NOT NULL DEFAULT '{}',
    "instruction" TEXT NOT NULL,
    "a2aTaskId" TEXT,
    "a2aContextId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeoutMs" INTEGER,
    "result" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "inputFactors" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "alternatives" TEXT NOT NULL,
    "safetyFactors" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "operatorId" TEXT,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "payloadEncrypted" TEXT NOT NULL,
    "payloadIv" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "modelVersion" TEXT,
    "modelHash" TEXT,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "decisionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "retentionExpiresAt" TIMESTAMP(3),
    "legalHoldId" TEXT,

    CONSTRAINT "ComplianceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceLogAccess" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "userId" TEXT,
    "accessType" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceLogAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "logIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RopaEntry" (
    "id" TEXT NOT NULL,
    "processingActivity" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "dataCategories" TEXT[],
    "dataSubjects" TEXT[],
    "recipients" TEXT[],
    "thirdCountryTransfers" TEXT,
    "retentionPeriod" TEXT NOT NULL,
    "securityMeasures" TEXT[],
    "legalBasis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RopaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDocumentation" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentUrl" TEXT,
    "content" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderDocumentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GDPRRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "requestData" TEXT NOT NULL DEFAULT '{}',
    "responseData" TEXT,
    "verificationToken" TEXT,
    "verificationExpires" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "internalNotes" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GDPRRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GDPRRequestStatusHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GDPRRequestStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRestriction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "gdprRequestId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ADMReviewQueue" (
    "id" TEXT NOT NULL,
    "gdprRequestId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestReason" TEXT NOT NULL,
    "userEvidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignedTo" TEXT,
    "reviewNotes" TEXT,
    "reviewOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ADMReviewQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "incidentNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'detected',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rootCause" TEXT,
    "resolution" TEXT,
    "riskScore" INTEGER,
    "affectedDataSubjects" INTEGER,
    "dataCategories" TEXT[],
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "containedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "robotId" TEXT,
    "complianceLogIds" TEXT[],
    "alertIds" TEXT[],
    "systemSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentNotification" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "regulation" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "deadlineHours" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "templateId" TEXT,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentBy" TEXT,

    CONSTRAINT "IncidentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regulation" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualControlSession" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "speedLimitMmPerSec" INTEGER NOT NULL DEFAULT 250,
    "forceLimitN" INTEGER NOT NULL DEFAULT 140,

    CONSTRAINT "ManualControlSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "intervalMinutes" INTEGER NOT NULL,
    "robotScope" TEXT NOT NULL DEFAULT 'all',
    "scopeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCompletion" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "robotId" TEXT,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OversightLog" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "robotId" TEXT,
    "taskId" TEXT,
    "decisionId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OversightLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyRecord" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "anomalyType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AnomalyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityData" TEXT NOT NULL DEFAULT '{}',
    "approvalType" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "affectedUserId" TEXT,
    "affectedRobotId" TEXT,
    "slaHours" INTEGER NOT NULL,
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "requestedBy" TEXT NOT NULL,
    "requestReason" TEXT NOT NULL,
    "blocksExecution" BOOLEAN NOT NULL DEFAULT true,
    "rollbackPlan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalChain" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requiredSteps" INTEGER NOT NULL,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "isSequential" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "assignedTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "decidedBy" TEXT,
    "decisionNotes" TEXT,
    "activeEngagement" BOOLEAN NOT NULL DEFAULT false,
    "reviewDurationSec" INTEGER,
    "competenceVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStatusHistory" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT,
    "reason" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerViewpoint" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "supportingDocs" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerViewpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionContest" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "decisionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "contestReason" TEXT NOT NULL,
    "contestEvidence" TEXT,
    "requestedOutcome" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignedTo" TEXT,
    "reviewNotes" TEXT,
    "reviewOutcome" TEXT,
    "humanInterventionProvided" BOOLEAN NOT NULL DEFAULT false,
    "newDecisionData" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DecisionContest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "approvalType" TEXT,
    "triggerCondition" TEXT NOT NULL,
    "triggerThreshold" INTEGER NOT NULL,
    "escalateTo" TEXT NOT NULL,
    "notifyOriginal" BOOLEAN NOT NULL DEFAULT true,
    "notifyAdmin" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT,
    "trainingType" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "certificateUrl" TEXT,
    "trainingProvider" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionSchedule" (
    "id" TEXT NOT NULL,
    "inspectionType" TEXT NOT NULL,
    "robotId" TEXT,
    "robotName" TEXT,
    "lastInspectionDate" TIMESTAMP(3) NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "intervalYears" INTEGER NOT NULL,
    "inspectorName" TEXT,
    "inspectorCompany" TEXT,
    "reportUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "assessmentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "nextReviewDate" TIMESTAMP(3) NOT NULL,
    "triggerConditions" TEXT[],
    "triggeredUpdates" TEXT[],
    "documentUrl" TEXT,
    "responsiblePerson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceGap" (
    "id" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "articleReference" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "targetState" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "estimatedEffort" TEXT NOT NULL DEFAULT 'medium',
    "dueDate" TIMESTAMP(3),
    "assignedTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryDeadline" (
    "id" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT[],
    "completedRequirements" TEXT[],
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceActivity" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "framework" TEXT,
    "entityId" TEXT,
    "entityType" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "actionDim" INTEGER NOT NULL,
    "proprioceptionDim" INTEGER NOT NULL,
    "cameras" TEXT NOT NULL DEFAULT '[]',
    "capabilities" TEXT[],
    "limits" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "parametersSchema" TEXT NOT NULL DEFAULT '{}',
    "preconditions" TEXT NOT NULL DEFAULT '[]',
    "postconditions" TEXT NOT NULL DEFAULT '[]',
    "timeout" INTEGER,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "robotTypeId" TEXT NOT NULL,
    "skillId" TEXT,
    "storagePath" TEXT NOT NULL,
    "lerobotVersion" TEXT NOT NULL,
    "fps" INTEGER NOT NULL,
    "totalFrames" INTEGER NOT NULL,
    "totalDuration" DOUBLE PRECISION NOT NULL,
    "demonstrationCount" INTEGER NOT NULL,
    "qualityScore" INTEGER,
    "infoJson" TEXT NOT NULL DEFAULT '{}',
    "statsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingJob" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "fineTuneMethod" TEXT NOT NULL,
    "hyperparameters" TEXT NOT NULL DEFAULT '{}',
    "gpuRequirements" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentEpoch" INTEGER,
    "totalEpochs" INTEGER,
    "metrics" TEXT NOT NULL DEFAULT '{}',
    "mlflowRunId" TEXT,
    "mlflowExperimentId" TEXT,
    "bullmqJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "trainingJobId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "artifactUri" TEXT NOT NULL,
    "checkpointUri" TEXT,
    "trainingMetrics" TEXT NOT NULL DEFAULT '{}',
    "validationMetrics" TEXT NOT NULL DEFAULT '{}',
    "deploymentStatus" TEXT NOT NULL DEFAULT 'staging',
    "mlflowModelName" TEXT,
    "mlflowModelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "targetRobotTypes" TEXT[],
    "targetZones" TEXT[],
    "trafficPercentage" INTEGER NOT NULL DEFAULT 0,
    "canaryConfig" TEXT NOT NULL DEFAULT '{}',
    "rollbackThresholds" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deployedRobotIds" TEXT[],
    "failedRobotIds" TEXT[],
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RobotTypeToSkillDefinition" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RobotTypeToSkillDefinition_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Robot_serialNumber_key" ON "Robot"("serialNumber");

-- CreateIndex
CREATE INDEX "Robot_status_idx" ON "Robot"("status");

-- CreateIndex
CREATE INDEX "Robot_a2aEnabled_idx" ON "Robot"("a2aEnabled");

-- CreateIndex
CREATE INDEX "RobotTelemetry_robotId_timestamp_idx" ON "RobotTelemetry"("robotId", "timestamp");

-- CreateIndex
CREATE INDEX "RobotTelemetry_timestamp_idx" ON "RobotTelemetry"("timestamp");

-- CreateIndex
CREATE INDEX "RobotCommand_robotId_status_idx" ON "RobotCommand"("robotId", "status");

-- CreateIndex
CREATE INDEX "RobotCommand_createdAt_idx" ON "RobotCommand"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RobotEndpoints_robotId_key" ON "RobotEndpoints"("robotId");

-- CreateIndex
CREATE INDEX "Conversation_robotId_idx" ON "Conversation"("robotId");

-- CreateIndex
CREATE INDEX "Conversation_isActive_idx" ON "Conversation"("isActive");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_timestamp_idx" ON "Message"("conversationId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_taskId_idx" ON "Message"("taskId");

-- CreateIndex
CREATE INDEX "Task_conversationId_idx" ON "Task"("conversationId");

-- CreateIndex
CREATE INDEX "Task_state_idx" ON "Task"("state");

-- CreateIndex
CREATE INDEX "Task_updatedAt_idx" ON "Task"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCard_name_key" ON "AgentCard"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCard_robotId_key" ON "AgentCard"("robotId");

-- CreateIndex
CREATE INDEX "AgentCard_name_idx" ON "AgentCard"("name");

-- CreateIndex
CREATE INDEX "Alert_severity_idx" ON "Alert"("severity");

-- CreateIndex
CREATE INDEX "Alert_source_idx" ON "Alert"("source");

-- CreateIndex
CREATE INDEX "Alert_sourceId_idx" ON "Alert"("sourceId");

-- CreateIndex
CREATE INDEX "Alert_acknowledged_idx" ON "Alert"("acknowledged");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "Zone_floor_idx" ON "Zone"("floor");

-- CreateIndex
CREATE INDEX "Zone_type_idx" ON "Zone"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_name_floor_key" ON "Zone"("name", "floor");

-- CreateIndex
CREATE INDEX "Event_timestamp_idx" ON "Event"("timestamp");

-- CreateIndex
CREATE INDEX "Event_actor_idx" ON "Event"("actor");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "CommandInterpretation_robotId_idx" ON "CommandInterpretation"("robotId");

-- CreateIndex
CREATE INDEX "CommandInterpretation_createdAt_idx" ON "CommandInterpretation"("createdAt");

-- CreateIndex
CREATE INDEX "CommandInterpretation_status_idx" ON "CommandInterpretation"("status");

-- CreateIndex
CREATE INDEX "ProcessDefinition_name_idx" ON "ProcessDefinition"("name");

-- CreateIndex
CREATE INDEX "ProcessDefinition_status_idx" ON "ProcessDefinition"("status");

-- CreateIndex
CREATE INDEX "ProcessDefinition_createdBy_idx" ON "ProcessDefinition"("createdBy");

-- CreateIndex
CREATE INDEX "ProcessInstance_processDefinitionId_idx" ON "ProcessInstance"("processDefinitionId");

-- CreateIndex
CREATE INDEX "ProcessInstance_status_idx" ON "ProcessInstance"("status");

-- CreateIndex
CREATE INDEX "ProcessInstance_priority_idx" ON "ProcessInstance"("priority");

-- CreateIndex
CREATE INDEX "ProcessInstance_createdBy_idx" ON "ProcessInstance"("createdBy");

-- CreateIndex
CREATE INDEX "ProcessInstance_createdAt_idx" ON "ProcessInstance"("createdAt");

-- CreateIndex
CREATE INDEX "StepInstance_processInstanceId_idx" ON "StepInstance"("processInstanceId");

-- CreateIndex
CREATE INDEX "StepInstance_status_idx" ON "StepInstance"("status");

-- CreateIndex
CREATE INDEX "StepInstance_order_idx" ON "StepInstance"("order");

-- CreateIndex
CREATE UNIQUE INDEX "RobotTask_stepInstanceId_key" ON "RobotTask"("stepInstanceId");

-- CreateIndex
CREATE INDEX "RobotTask_robotId_idx" ON "RobotTask"("robotId");

-- CreateIndex
CREATE INDEX "RobotTask_processInstanceId_idx" ON "RobotTask"("processInstanceId");

-- CreateIndex
CREATE INDEX "RobotTask_status_idx" ON "RobotTask"("status");

-- CreateIndex
CREATE INDEX "RobotTask_priority_idx" ON "RobotTask"("priority");

-- CreateIndex
CREATE INDEX "RobotTask_source_idx" ON "RobotTask"("source");

-- CreateIndex
CREATE INDEX "RobotTask_createdAt_idx" ON "RobotTask"("createdAt");

-- CreateIndex
CREATE INDEX "Decision_entityId_idx" ON "Decision"("entityId");

-- CreateIndex
CREATE INDEX "Decision_robotId_idx" ON "Decision"("robotId");

-- CreateIndex
CREATE INDEX "Decision_decisionType_idx" ON "Decision"("decisionType");

-- CreateIndex
CREATE INDEX "Decision_createdAt_idx" ON "Decision"("createdAt");

-- CreateIndex
CREATE INDEX "ComplianceLog_sessionId_idx" ON "ComplianceLog"("sessionId");

-- CreateIndex
CREATE INDEX "ComplianceLog_retentionExpiresAt_idx" ON "ComplianceLog"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "ComplianceLog_robotId_idx" ON "ComplianceLog"("robotId");

-- CreateIndex
CREATE INDEX "ComplianceLog_operatorId_idx" ON "ComplianceLog"("operatorId");

-- CreateIndex
CREATE INDEX "ComplianceLog_eventType_idx" ON "ComplianceLog"("eventType");

-- CreateIndex
CREATE INDEX "ComplianceLog_severity_idx" ON "ComplianceLog"("severity");

-- CreateIndex
CREATE INDEX "ComplianceLog_timestamp_idx" ON "ComplianceLog"("timestamp");

-- CreateIndex
CREATE INDEX "ComplianceLog_decisionId_idx" ON "ComplianceLog"("decisionId");

-- CreateIndex
CREATE INDEX "ComplianceLog_currentHash_idx" ON "ComplianceLog"("currentHash");

-- CreateIndex
CREATE INDEX "ComplianceLogAccess_logId_idx" ON "ComplianceLogAccess"("logId");

-- CreateIndex
CREATE INDEX "ComplianceLogAccess_userId_idx" ON "ComplianceLogAccess"("userId");

-- CreateIndex
CREATE INDEX "ComplianceLogAccess_timestamp_idx" ON "ComplianceLogAccess"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_eventType_key" ON "RetentionPolicy"("eventType");

-- CreateIndex
CREATE INDEX "RetentionPolicy_eventType_idx" ON "RetentionPolicy"("eventType");

-- CreateIndex
CREATE INDEX "LegalHold_isActive_idx" ON "LegalHold"("isActive");

-- CreateIndex
CREATE INDEX "LegalHold_createdBy_idx" ON "LegalHold"("createdBy");

-- CreateIndex
CREATE INDEX "RopaEntry_processingActivity_idx" ON "RopaEntry"("processingActivity");

-- CreateIndex
CREATE INDEX "ProviderDocumentation_providerName_idx" ON "ProviderDocumentation"("providerName");

-- CreateIndex
CREATE INDEX "ProviderDocumentation_modelVersion_idx" ON "ProviderDocumentation"("modelVersion");

-- CreateIndex
CREATE INDEX "ProviderDocumentation_documentType_idx" ON "ProviderDocumentation"("documentType");

-- CreateIndex
CREATE UNIQUE INDEX "GDPRRequest_verificationToken_key" ON "GDPRRequest"("verificationToken");

-- CreateIndex
CREATE INDEX "GDPRRequest_userId_idx" ON "GDPRRequest"("userId");

-- CreateIndex
CREATE INDEX "GDPRRequest_requestType_idx" ON "GDPRRequest"("requestType");

-- CreateIndex
CREATE INDEX "GDPRRequest_status_idx" ON "GDPRRequest"("status");

-- CreateIndex
CREATE INDEX "GDPRRequest_slaDeadline_idx" ON "GDPRRequest"("slaDeadline");

-- CreateIndex
CREATE INDEX "GDPRRequest_submittedAt_idx" ON "GDPRRequest"("submittedAt");

-- CreateIndex
CREATE INDEX "GDPRRequestStatusHistory_requestId_idx" ON "GDPRRequestStatusHistory"("requestId");

-- CreateIndex
CREATE INDEX "GDPRRequestStatusHistory_timestamp_idx" ON "GDPRRequestStatusHistory"("timestamp");

-- CreateIndex
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

-- CreateIndex
CREATE INDEX "UserConsent_consentType_idx" ON "UserConsent"("consentType");

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_userId_consentType_key" ON "UserConsent"("userId", "consentType");

-- CreateIndex
CREATE INDEX "DataRestriction_userId_idx" ON "DataRestriction"("userId");

-- CreateIndex
CREATE INDEX "DataRestriction_isActive_idx" ON "DataRestriction"("isActive");

-- CreateIndex
CREATE INDEX "DataRestriction_scope_idx" ON "DataRestriction"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "ADMReviewQueue_gdprRequestId_key" ON "ADMReviewQueue"("gdprRequestId");

-- CreateIndex
CREATE INDEX "ADMReviewQueue_status_idx" ON "ADMReviewQueue"("status");

-- CreateIndex
CREATE INDEX "ADMReviewQueue_priority_idx" ON "ADMReviewQueue"("priority");

-- CreateIndex
CREATE INDEX "ADMReviewQueue_assignedTo_idx" ON "ADMReviewQueue"("assignedTo");

-- CreateIndex
CREATE INDEX "ADMReviewQueue_decisionId_idx" ON "ADMReviewQueue"("decisionId");

-- CreateIndex
CREATE INDEX "ADMReviewQueue_createdAt_idx" ON "ADMReviewQueue"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_incidentNumber_key" ON "Incident"("incidentNumber");

-- CreateIndex
CREATE INDEX "Incident_type_idx" ON "Incident"("type");

-- CreateIndex
CREATE INDEX "Incident_severity_idx" ON "Incident"("severity");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_detectedAt_idx" ON "Incident"("detectedAt");

-- CreateIndex
CREATE INDEX "Incident_robotId_idx" ON "Incident"("robotId");

-- CreateIndex
CREATE INDEX "IncidentNotification_incidentId_idx" ON "IncidentNotification"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentNotification_status_idx" ON "IncidentNotification"("status");

-- CreateIndex
CREATE INDEX "IncidentNotification_dueAt_idx" ON "IncidentNotification"("dueAt");

-- CreateIndex
CREATE INDEX "IncidentNotification_authority_idx" ON "IncidentNotification"("authority");

-- CreateIndex
CREATE INDEX "IncidentNotification_regulation_idx" ON "IncidentNotification"("regulation");

-- CreateIndex
CREATE INDEX "NotificationTemplate_regulation_idx" ON "NotificationTemplate"("regulation");

-- CreateIndex
CREATE INDEX "NotificationTemplate_authority_idx" ON "NotificationTemplate"("authority");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_regulation_authority_type_isDefault_key" ON "NotificationTemplate"("regulation", "authority", "type", "isDefault");

-- CreateIndex
CREATE INDEX "ManualControlSession_robotId_idx" ON "ManualControlSession"("robotId");

-- CreateIndex
CREATE INDEX "ManualControlSession_operatorId_idx" ON "ManualControlSession"("operatorId");

-- CreateIndex
CREATE INDEX "ManualControlSession_isActive_idx" ON "ManualControlSession"("isActive");

-- CreateIndex
CREATE INDEX "VerificationSchedule_isActive_idx" ON "VerificationSchedule"("isActive");

-- CreateIndex
CREATE INDEX "VerificationSchedule_robotScope_idx" ON "VerificationSchedule"("robotScope");

-- CreateIndex
CREATE INDEX "VerificationCompletion_scheduleId_idx" ON "VerificationCompletion"("scheduleId");

-- CreateIndex
CREATE INDEX "VerificationCompletion_operatorId_idx" ON "VerificationCompletion"("operatorId");

-- CreateIndex
CREATE INDEX "VerificationCompletion_completedAt_idx" ON "VerificationCompletion"("completedAt");

-- CreateIndex
CREATE INDEX "OversightLog_actionType_idx" ON "OversightLog"("actionType");

-- CreateIndex
CREATE INDEX "OversightLog_operatorId_idx" ON "OversightLog"("operatorId");

-- CreateIndex
CREATE INDEX "OversightLog_robotId_idx" ON "OversightLog"("robotId");

-- CreateIndex
CREATE INDEX "OversightLog_timestamp_idx" ON "OversightLog"("timestamp");

-- CreateIndex
CREATE INDEX "AnomalyRecord_robotId_idx" ON "AnomalyRecord"("robotId");

-- CreateIndex
CREATE INDEX "AnomalyRecord_anomalyType_idx" ON "AnomalyRecord"("anomalyType");

-- CreateIndex
CREATE INDEX "AnomalyRecord_severity_idx" ON "AnomalyRecord"("severity");

-- CreateIndex
CREATE INDEX "AnomalyRecord_isActive_idx" ON "AnomalyRecord"("isActive");

-- CreateIndex
CREATE INDEX "AnomalyRecord_detectedAt_idx" ON "AnomalyRecord"("detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_requestNumber_key" ON "ApprovalRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_priority_idx" ON "ApprovalRequest"("priority");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entityType_idx" ON "ApprovalRequest"("entityType");

-- CreateIndex
CREATE INDEX "ApprovalRequest_affectedUserId_idx" ON "ApprovalRequest"("affectedUserId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_slaDeadline_idx" ON "ApprovalRequest"("slaDeadline");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedBy_idx" ON "ApprovalRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "ApprovalRequest_createdAt_idx" ON "ApprovalRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalChain_approvalRequestId_key" ON "ApprovalChain"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalChain_approvalRequestId_idx" ON "ApprovalChain"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalStep_approvalRequestId_idx" ON "ApprovalStep"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalStep_stepOrder_idx" ON "ApprovalStep"("stepOrder");

-- CreateIndex
CREATE INDEX "ApprovalStep_approverRole_idx" ON "ApprovalStep"("approverRole");

-- CreateIndex
CREATE INDEX "ApprovalStep_assignedTo_idx" ON "ApprovalStep"("assignedTo");

-- CreateIndex
CREATE INDEX "ApprovalStep_status_idx" ON "ApprovalStep"("status");

-- CreateIndex
CREATE INDEX "ApprovalStatusHistory_approvalRequestId_idx" ON "ApprovalStatusHistory"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalStatusHistory_timestamp_idx" ON "ApprovalStatusHistory"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerViewpoint_approvalRequestId_key" ON "WorkerViewpoint"("approvalRequestId");

-- CreateIndex
CREATE INDEX "WorkerViewpoint_workerId_idx" ON "WorkerViewpoint"("workerId");

-- CreateIndex
CREATE INDEX "WorkerViewpoint_status_idx" ON "WorkerViewpoint"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionContest_approvalRequestId_key" ON "DecisionContest"("approvalRequestId");

-- CreateIndex
CREATE INDEX "DecisionContest_decisionId_idx" ON "DecisionContest"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionContest_workerId_idx" ON "DecisionContest"("workerId");

-- CreateIndex
CREATE INDEX "DecisionContest_status_idx" ON "DecisionContest"("status");

-- CreateIndex
CREATE INDEX "DecisionContest_submittedAt_idx" ON "DecisionContest"("submittedAt");

-- CreateIndex
CREATE INDEX "EscalationRule_entityType_idx" ON "EscalationRule"("entityType");

-- CreateIndex
CREATE INDEX "EscalationRule_isActive_idx" ON "EscalationRule"("isActive");

-- CreateIndex
CREATE INDEX "TrainingRecord_userId_idx" ON "TrainingRecord"("userId");

-- CreateIndex
CREATE INDEX "TrainingRecord_trainingType_idx" ON "TrainingRecord"("trainingType");

-- CreateIndex
CREATE INDEX "TrainingRecord_expiresAt_idx" ON "TrainingRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "InspectionSchedule_inspectionType_idx" ON "InspectionSchedule"("inspectionType");

-- CreateIndex
CREATE INDEX "InspectionSchedule_robotId_idx" ON "InspectionSchedule"("robotId");

-- CreateIndex
CREATE INDEX "InspectionSchedule_nextDueDate_idx" ON "InspectionSchedule"("nextDueDate");

-- CreateIndex
CREATE INDEX "RiskAssessment_assessmentType_idx" ON "RiskAssessment"("assessmentType");

-- CreateIndex
CREATE INDEX "RiskAssessment_nextReviewDate_idx" ON "RiskAssessment"("nextReviewDate");

-- CreateIndex
CREATE INDEX "ComplianceGap_framework_idx" ON "ComplianceGap"("framework");

-- CreateIndex
CREATE INDEX "ComplianceGap_severity_idx" ON "ComplianceGap"("severity");

-- CreateIndex
CREATE INDEX "ComplianceGap_status_idx" ON "ComplianceGap"("status");

-- CreateIndex
CREATE INDEX "ComplianceGap_dueDate_idx" ON "ComplianceGap"("dueDate");

-- CreateIndex
CREATE INDEX "RegulatoryDeadline_framework_idx" ON "RegulatoryDeadline"("framework");

-- CreateIndex
CREATE INDEX "RegulatoryDeadline_deadline_idx" ON "RegulatoryDeadline"("deadline");

-- CreateIndex
CREATE INDEX "RegulatoryDeadline_priority_idx" ON "RegulatoryDeadline"("priority");

-- CreateIndex
CREATE INDEX "ComplianceActivity_type_idx" ON "ComplianceActivity"("type");

-- CreateIndex
CREATE INDEX "ComplianceActivity_framework_idx" ON "ComplianceActivity"("framework");

-- CreateIndex
CREATE INDEX "ComplianceActivity_timestamp_idx" ON "ComplianceActivity"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "RobotType_name_key" ON "RobotType"("name");

-- CreateIndex
CREATE INDEX "RobotType_manufacturer_idx" ON "RobotType"("manufacturer");

-- CreateIndex
CREATE INDEX "SkillDefinition_status_idx" ON "SkillDefinition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SkillDefinition_name_version_key" ON "SkillDefinition"("name", "version");

-- CreateIndex
CREATE INDEX "Dataset_robotTypeId_idx" ON "Dataset"("robotTypeId");

-- CreateIndex
CREATE INDEX "Dataset_skillId_idx" ON "Dataset"("skillId");

-- CreateIndex
CREATE INDEX "Dataset_status_idx" ON "Dataset"("status");

-- CreateIndex
CREATE INDEX "TrainingJob_datasetId_idx" ON "TrainingJob"("datasetId");

-- CreateIndex
CREATE INDEX "TrainingJob_status_idx" ON "TrainingJob"("status");

-- CreateIndex
CREATE INDEX "TrainingJob_baseModel_idx" ON "TrainingJob"("baseModel");

-- CreateIndex
CREATE INDEX "ModelVersion_deploymentStatus_idx" ON "ModelVersion"("deploymentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_skillId_version_key" ON "ModelVersion"("skillId", "version");

-- CreateIndex
CREATE INDEX "Deployment_modelVersionId_idx" ON "Deployment"("modelVersionId");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE INDEX "_RobotTypeToSkillDefinition_B_index" ON "_RobotTypeToSkillDefinition"("B");

-- AddForeignKey
ALTER TABLE "RobotTelemetry" ADD CONSTRAINT "RobotTelemetry_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotCommand" ADD CONSTRAINT "RobotCommand_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotEndpoints" ADD CONSTRAINT "RobotEndpoints_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCard" ADD CONSTRAINT "AgentCard_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Robot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_processDefinitionId_fkey" FOREIGN KEY ("processDefinitionId") REFERENCES "ProcessDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepInstance" ADD CONSTRAINT "StepInstance_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotTask" ADD CONSTRAINT "RobotTask_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotTask" ADD CONSTRAINT "RobotTask_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotTask" ADD CONSTRAINT "RobotTask_stepInstanceId_fkey" FOREIGN KEY ("stepInstanceId") REFERENCES "StepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceLog" ADD CONSTRAINT "ComplianceLog_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceLogAccess" ADD CONSTRAINT "ComplianceLogAccess_logId_fkey" FOREIGN KEY ("logId") REFERENCES "ComplianceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GDPRRequest" ADD CONSTRAINT "GDPRRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GDPRRequestStatusHistory" ADD CONSTRAINT "GDPRRequestStatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "GDPRRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRestriction" ADD CONSTRAINT "DataRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ADMReviewQueue" ADD CONSTRAINT "ADMReviewQueue_gdprRequestId_fkey" FOREIGN KEY ("gdprRequestId") REFERENCES "GDPRRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNotification" ADD CONSTRAINT "IncidentNotification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCompletion" ADD CONSTRAINT "VerificationCompletion_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "VerificationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalChain" ADD CONSTRAINT "ApprovalChain_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStatusHistory" ADD CONSTRAINT "ApprovalStatusHistory_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerViewpoint" ADD CONSTRAINT "WorkerViewpoint_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionContest" ADD CONSTRAINT "DecisionContest_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_robotTypeId_fkey" FOREIGN KEY ("robotTypeId") REFERENCES "RobotType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingJob" ADD CONSTRAINT "TrainingJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_trainingJobId_fkey" FOREIGN KEY ("trainingJobId") REFERENCES "TrainingJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RobotTypeToSkillDefinition" ADD CONSTRAINT "_RobotTypeToSkillDefinition_A_fkey" FOREIGN KEY ("A") REFERENCES "RobotType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RobotTypeToSkillDefinition" ADD CONSTRAINT "_RobotTypeToSkillDefinition_B_fkey" FOREIGN KEY ("B") REFERENCES "SkillDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
