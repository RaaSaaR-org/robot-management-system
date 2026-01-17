-- CreateTable
CREATE TABLE "Embodiment" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "description" TEXT,
    "configYaml" TEXT NOT NULL,
    "actionDim" INTEGER NOT NULL,
    "proprioceptionDim" INTEGER NOT NULL,
    "robotTypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Embodiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Embodiment_tag_key" ON "Embodiment"("tag");

-- CreateIndex
CREATE INDEX "Embodiment_robotTypeId_idx" ON "Embodiment"("robotTypeId");

-- CreateIndex
CREATE INDEX "Embodiment_manufacturer_idx" ON "Embodiment"("manufacturer");

-- CreateIndex
CREATE INDEX "Embodiment_tag_idx" ON "Embodiment"("tag");

-- AddForeignKey
ALTER TABLE "Embodiment" ADD CONSTRAINT "Embodiment_robotTypeId_fkey" FOREIGN KEY ("robotTypeId") REFERENCES "RobotType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
