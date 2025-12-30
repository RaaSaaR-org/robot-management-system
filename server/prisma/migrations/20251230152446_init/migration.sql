-- CreateTable
CREATE TABLE "Robot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "batteryLevel" INTEGER NOT NULL DEFAULT 100,
    "location" TEXT NOT NULL DEFAULT '{}',
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentTaskId" TEXT,
    "currentTaskName" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "firmware" TEXT,
    "ipAddress" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "a2aEnabled" BOOLEAN NOT NULL DEFAULT false,
    "a2aAgentUrl" TEXT,
    "registeredAt" DATETIME,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthCheck" DATETIME,
    "baseUrl" TEXT
);

-- CreateTable
CREATE TABLE "RobotTelemetry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "robotId" TEXT NOT NULL,
    "batteryLevel" INTEGER NOT NULL,
    "batteryVoltage" REAL,
    "batteryTemperature" REAL,
    "cpuUsage" REAL NOT NULL,
    "memoryUsage" REAL NOT NULL,
    "diskUsage" REAL,
    "temperature" REAL NOT NULL,
    "humidity" REAL,
    "speed" REAL,
    "sensors" TEXT NOT NULL DEFAULT '{}',
    "errors" TEXT NOT NULL DEFAULT '[]',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RobotTelemetry_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RobotCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "robotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "result" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "RobotCommand_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RobotEndpoints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "robotId" TEXT NOT NULL,
    "robot" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "telemetry" TEXT NOT NULL,
    "telemetryWs" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RobotEndpoints_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "robotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Conversation_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "parts" TEXT NOT NULL,
    "conversationId" TEXT,
    "taskId" TEXT,
    "metadata" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'submitted',
    "statusMessage" TEXT,
    "statusTimestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artifacts" TEXT NOT NULL DEFAULT '[]',
    "history" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "robotId" TEXT,
    CONSTRAINT "AgentCard_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" DATETIME,
    "acknowledgedBy" TEXT,
    "dismissable" BOOLEAN NOT NULL DEFAULT true,
    "autoDismissMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Alert_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Robot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bounds" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "avatar" TEXT,
    "tenantId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordResetToken" TEXT,
    "passwordResetExpires" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommandInterpretation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "robotId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "parameters" TEXT NOT NULL DEFAULT '{}',
    "confidence" REAL NOT NULL,
    "safetyClassification" TEXT NOT NULL,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "suggestedAlternatives" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'interpreted',
    "executedCommandId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ProcessDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProcessInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processDefinitionId" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "preferredRobotIds" TEXT NOT NULL DEFAULT '[]',
    "assignedRobotIds" TEXT NOT NULL DEFAULT '[]',
    "scheduledAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "estimatedCompletionAt" DATETIME,
    "inputData" TEXT,
    "outputData" TEXT,
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessInstance_processDefinitionId_fkey" FOREIGN KEY ("processDefinitionId") REFERENCES "ProcessDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StepInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processInstanceId" TEXT NOT NULL,
    "stepTemplateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "actionType" TEXT NOT NULL,
    "actionConfig" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedRobotId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "result" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StepInstance_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RobotTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processInstanceId" TEXT,
    "stepInstanceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "robotId" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actionType" TEXT NOT NULL,
    "actionConfig" TEXT NOT NULL DEFAULT '{}',
    "instruction" TEXT NOT NULL,
    "a2aTaskId" TEXT,
    "a2aContextId" TEXT,
    "assignedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "timeoutMs" INTEGER,
    "result" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RobotTask_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RobotTask_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RobotTask_stepInstanceId_fkey" FOREIGN KEY ("stepInstanceId") REFERENCES "StepInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
