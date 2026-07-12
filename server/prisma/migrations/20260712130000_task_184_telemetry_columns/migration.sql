-- TASK-184 real-data flow: rich per-frame hardware telemetry columns on
-- RobotTelemetry (joint states incl. temperatures, IMU, Dex3 touch pads,
-- battery/BMS, per-joint motor temperatures, odometry) plus honesty flags
-- (hardwareConnected, simulated field-group list). JSON-string columns follow
-- the existing `sensors` pattern so the same code path works on SQLite and
-- PostgreSQL. Applied to the local SQLite dev DB via `prisma db push`; the
-- statements below are dialect-neutral ADD COLUMNs so `prisma migrate deploy`
-- creates them in production too.

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "jointStates" TEXT;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "imu" TEXT;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "touch" TEXT;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "battery" TEXT;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "motorTemperatures" TEXT;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "odometry" TEXT;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "hardwareConnected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RobotTelemetry" ADD COLUMN "simulated" TEXT NOT NULL DEFAULT '[]';
