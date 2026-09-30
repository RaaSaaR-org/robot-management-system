-- TASK-241: comments and ratings by people and agents on datasets, dataset
-- views, model versions, episodes and training jobs. Actors are loose id +
-- denormalized displayName, no FK. Rating is unique per actor per subject on
-- a non-null subjectKey (a unique index over a nullable episodeIndex would let
-- NULLs repeat).
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "episodeIndex" INTEGER,
    "parentId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "episodeIndex" INTEGER,
    "subjectKey" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "dimensionsJson" TEXT NOT NULL DEFAULT '{}',
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Comment_subjectType_subjectId_createdAt_idx" ON "Comment"("subjectType", "subjectId", "createdAt");
CREATE INDEX "Comment_actorType_actorId_idx" ON "Comment"("actorType", "actorId");
CREATE INDEX "Comment_tenantId_createdAt_idx" ON "Comment"("tenantId", "createdAt");
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

CREATE UNIQUE INDEX "Rating_subjectType_subjectKey_actorType_actorId_key" ON "Rating"("subjectType", "subjectKey", "actorType", "actorId");
CREATE INDEX "Rating_subjectType_subjectId_idx" ON "Rating"("subjectType", "subjectId");
CREATE INDEX "Rating_tenantId_updatedAt_idx" ON "Rating"("tenantId", "updatedAt");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
