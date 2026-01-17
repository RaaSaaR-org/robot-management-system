-- AlterTable
ALTER TABLE "SkillDefinition" ADD COLUMN     "defaultParameters" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "linkedModelVersionId" TEXT,
ADD COLUMN     "requiredCapabilities" TEXT[];

-- CreateTable
CREATE TABLE "SkillChain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "estimatedDuration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillChainStep" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "parameters" TEXT NOT NULL DEFAULT '{}',
    "inputMapping" TEXT NOT NULL DEFAULT '{}',
    "onFailure" TEXT NOT NULL DEFAULT 'abort',
    "maxRetries" INTEGER,
    "timeoutOverride" INTEGER,

    CONSTRAINT "SkillChainStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillChain_status_idx" ON "SkillChain"("status");

-- CreateIndex
CREATE INDEX "SkillChain_name_idx" ON "SkillChain"("name");

-- CreateIndex
CREATE INDEX "SkillChainStep_chainId_idx" ON "SkillChainStep"("chainId");

-- CreateIndex
CREATE INDEX "SkillChainStep_skillId_idx" ON "SkillChainStep"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillChainStep_chainId_order_key" ON "SkillChainStep"("chainId", "order");

-- CreateIndex
CREATE INDEX "SkillDefinition_linkedModelVersionId_idx" ON "SkillDefinition"("linkedModelVersionId");

-- AddForeignKey
ALTER TABLE "SkillChainStep" ADD CONSTRAINT "SkillChainStep_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "SkillChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillChainStep" ADD CONSTRAINT "SkillChainStep_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
