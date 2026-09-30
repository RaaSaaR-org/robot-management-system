-- TASK-337: Alert.sourceId is polymorphic — a robot, task, incident, twin zone
-- or workflow id, read according to Alert.source. The foreign key to Robot
-- rejected every non-robot id, so those alerts were never written. The
-- sourceId index stays for lookups.
ALTER TABLE "Alert" DROP CONSTRAINT IF EXISTS "Alert_sourceId_fkey";
