-- TASK-212: PatrolRun.promotedAt — set when an operator promotes a run to the
-- route's baseline ("Promote to baseline"). The robot rewrites its own
-- per-checkpoint baseline; the server records the promotion so
-- PatrolService.getBaseline prefers the most recently promoted run per
-- route+window over the latest baseline-mode run.

-- AlterTable
ALTER TABLE "PatrolRun" ADD COLUMN "promotedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PatrolRun_promotedAt_idx" ON "PatrolRun"("promotedAt");
