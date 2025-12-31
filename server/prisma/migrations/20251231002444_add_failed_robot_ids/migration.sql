-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StepInstance" (
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
    "failedRobotIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StepInstance_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StepInstance" ("actionConfig", "actionType", "assignedRobotId", "completedAt", "createdAt", "description", "error", "id", "maxRetries", "name", "order", "processInstanceId", "result", "retryCount", "startedAt", "status", "stepTemplateId", "updatedAt") SELECT "actionConfig", "actionType", "assignedRobotId", "completedAt", "createdAt", "description", "error", "id", "maxRetries", "name", "order", "processInstanceId", "result", "retryCount", "startedAt", "status", "stepTemplateId", "updatedAt" FROM "StepInstance";
DROP TABLE "StepInstance";
ALTER TABLE "new_StepInstance" RENAME TO "StepInstance";
CREATE INDEX "StepInstance_processInstanceId_idx" ON "StepInstance"("processInstanceId");
CREATE INDEX "StepInstance_status_idx" ON "StepInstance"("status");
CREATE INDEX "StepInstance_order_idx" ON "StepInstance"("order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
