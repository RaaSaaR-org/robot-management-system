-- TASK-327: a robot is bound to a site — the digital twin it works in
-- (epic TASK-274). Nullable; deleting the twin unbinds its robots.
ALTER TABLE "Robot" ADD COLUMN "twinId" TEXT;

CREATE INDEX "Robot_twinId_idx" ON "Robot"("twinId");

ALTER TABLE "Robot" ADD CONSTRAINT "Robot_twinId_fkey" FOREIGN KEY ("twinId") REFERENCES "DigitalTwin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
