-- TASK-162: Unified role model
-- Rename legacy role values to the new union: super-admin | owner | member | viewer
UPDATE "User" SET "role" = 'owner'  WHERE "role" = 'admin';
UPDATE "User" SET "role" = 'member' WHERE "role" = 'operator';
-- 'viewer' stays 'viewer'

-- Change the default for newly-created rows from 'viewer' to 'member'
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'member';
