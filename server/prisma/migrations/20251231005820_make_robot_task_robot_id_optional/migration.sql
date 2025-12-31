-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RobotTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
INSERT INTO "new_RobotTask" ("a2aContextId", "a2aTaskId", "actionConfig", "actionType", "assignedAt", "completedAt", "createdAt", "error", "id", "instruction", "maxRetries", "priority", "processInstanceId", "result", "retryCount", "robotId", "source", "startedAt", "status", "stepInstanceId", "timeoutMs", "updatedAt") SELECT "a2aContextId", "a2aTaskId", "actionConfig", "actionType", "assignedAt", "completedAt", "createdAt", "error", "id", "instruction", "maxRetries", "priority", "processInstanceId", "result", "retryCount", "robotId", "source", "startedAt", "status", "stepInstanceId", "timeoutMs", "updatedAt" FROM "RobotTask";
DROP TABLE "RobotTask";
ALTER TABLE "new_RobotTask" RENAME TO "RobotTask";
CREATE UNIQUE INDEX "RobotTask_stepInstanceId_key" ON "RobotTask"("stepInstanceId");
CREATE INDEX "RobotTask_robotId_idx" ON "RobotTask"("robotId");
CREATE INDEX "RobotTask_processInstanceId_idx" ON "RobotTask"("processInstanceId");
CREATE INDEX "RobotTask_status_idx" ON "RobotTask"("status");
CREATE INDEX "RobotTask_priority_idx" ON "RobotTask"("priority");
CREATE INDEX "RobotTask_source_idx" ON "RobotTask"("source");
CREATE INDEX "RobotTask_createdAt_idx" ON "RobotTask"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
