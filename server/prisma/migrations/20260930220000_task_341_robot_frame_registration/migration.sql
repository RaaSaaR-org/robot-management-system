-- TASK-341: a robot's odometry frame registered to its site twin (epic TASK-325).
CREATE TABLE "RobotFrameRegistration" (
    "id" TEXT NOT NULL,
    "robotId" TEXT NOT NULL,
    "twinId" TEXT NOT NULL,
    "odomFrameId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "yawDeg" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "anchorPlaceId" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobotFrameRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RobotFrameRegistration_robotId_key" ON "RobotFrameRegistration"("robotId");

CREATE INDEX "RobotFrameRegistration_tenantId_idx" ON "RobotFrameRegistration"("tenantId");

ALTER TABLE "RobotFrameRegistration" ADD CONSTRAINT "RobotFrameRegistration_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
