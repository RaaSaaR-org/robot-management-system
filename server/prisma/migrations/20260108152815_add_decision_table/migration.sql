-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "inputFactors" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "alternatives" TEXT NOT NULL,
    "safetyFactors" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Decision_entityId_idx" ON "Decision"("entityId");

-- CreateIndex
CREATE INDEX "Decision_robotId_idx" ON "Decision"("robotId");

-- CreateIndex
CREATE INDEX "Decision_decisionType_idx" ON "Decision"("decisionType");

-- CreateIndex
CREATE INDEX "Decision_createdAt_idx" ON "Decision"("createdAt");
