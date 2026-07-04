-- TASK-156 Skill & Data Marketplace: models added to schema.prisma via
-- `prisma db push` for local dev (SQLite). This migration captures them in
-- PostgreSQL dialect so `prisma migrate deploy` creates them in production.

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "fullDescription" TEXT NOT NULL,
    "robotType" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL DEFAULT 'None',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'published',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "taskCategory" TEXT,
    "successRate" DOUBLE PRECISION,
    "adapterSizeMB" DOUBLE PRECISION,
    "episodeCount" INTEGER,
    "frameCount" INTEGER,
    "datasetSizeGB" DOUBLE PRECISION,
    "collectionMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingVersion" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "artifactUri" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "checksumSha256" TEXT,
    "changelog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingLicense" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCredits" INTEGER NOT NULL,
    "features" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "ListingLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPurchase" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "versionId" TEXT,
    "creditsPaid" INTEGER NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingReview" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorTier" TEXT NOT NULL DEFAULT 'bronze',
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "robotType" TEXT NOT NULL DEFAULT 'Generic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceListing_sellerId_idx" ON "MarketplaceListing"("sellerId");
-- CreateIndex
CREATE INDEX "MarketplaceListing_type_idx" ON "MarketplaceListing"("type");
-- CreateIndex
CREATE INDEX "MarketplaceListing_status_idx" ON "MarketplaceListing"("status");
-- CreateIndex
CREATE INDEX "MarketplaceListing_robotType_idx" ON "MarketplaceListing"("robotType");
-- CreateIndex
CREATE INDEX "ListingVersion_listingId_idx" ON "ListingVersion"("listingId");
-- CreateIndex
CREATE UNIQUE INDEX "ListingLicense_listingId_tier_key" ON "ListingLicense"("listingId", "tier");
-- CreateIndex
CREATE UNIQUE INDEX "ListingPurchase_buyerId_listingId_key" ON "ListingPurchase"("buyerId", "listingId");
-- CreateIndex
CREATE INDEX "ListingPurchase_buyerId_idx" ON "ListingPurchase"("buyerId");
-- CreateIndex
CREATE INDEX "ListingPurchase_listingId_idx" ON "ListingPurchase"("listingId");
-- CreateIndex
CREATE UNIQUE INDEX "ListingReview_listingId_authorId_key" ON "ListingReview"("listingId", "authorId");
-- CreateIndex
CREATE INDEX "ListingReview_listingId_idx" ON "ListingReview"("listingId");

-- AddForeignKey
ALTER TABLE "ListingVersion" ADD CONSTRAINT "ListingVersion_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ListingLicense" ADD CONSTRAINT "ListingLicense_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ListingPurchase" ADD CONSTRAINT "ListingPurchase_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ListingPurchase" ADD CONSTRAINT "ListingPurchase_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "ListingLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ListingReview" ADD CONSTRAINT "ListingReview_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
