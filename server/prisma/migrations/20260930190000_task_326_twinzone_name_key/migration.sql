-- TASK-326: every navigable TwinZone is a uniquely named place (epic TASK-274).
-- `nameKey` is lower(trim(name)) and is unique per twin, so "AISLE-1" and
-- "aisle-1" cannot both exist on one twin (the same name on another twin is fine).
--
-- Backfill never fails on legacy duplicates: the first row (by createdAt, id)
-- keeps its key, later ones get "-2", "-3", ... appended to BOTH name and
-- nameKey, so the displayed name stays consistent with its key.
ALTER TABLE "TwinZone" ADD COLUMN "nameKey" TEXT;

WITH ranked AS (
    SELECT "id",
           ROW_NUMBER() OVER (
               PARTITION BY "twinId", lower(trim("name"))
               ORDER BY "createdAt", "id"
           ) AS rn
    FROM "TwinZone"
)
UPDATE "TwinZone" z
SET "name"    = CASE WHEN r.rn = 1 THEN trim(z."name") ELSE trim(z."name") || '-' || r.rn END,
    "nameKey" = CASE WHEN r.rn = 1 THEN lower(trim(z."name")) ELSE lower(trim(z."name")) || '-' || r.rn END
FROM ranked r
WHERE r."id" = z."id";

ALTER TABLE "TwinZone" ALTER COLUMN "nameKey" SET NOT NULL;

CREATE UNIQUE INDEX "TwinZone_twinId_nameKey_key" ON "TwinZone"("twinId", "nameKey");
