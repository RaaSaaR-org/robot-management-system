/**
 * @file MarketplaceRepository.ts
 * @description Data access layer for the Skill & Data Marketplace (TASK-156).
 *              Maps Prisma rows to domain records (DateTime → ISO string,
 *              BigInt → number, JSON columns parsed) and batches seller
 *              statistics to avoid N+1 queries.
 * @feature marketplace
 */

import { prisma } from '../database/index.js';
import type { Prisma } from '@prisma/client';

// ============================================================================
// DOMAIN RECORDS
// ============================================================================

export interface ListingLicenseRecord {
  id: string;
  listingId: string;
  tier: string;
  label: string;
  description: string;
  priceCredits: number;
  features: string[];
}

export interface ListingReviewRecord {
  id: string;
  listingId: string;
  authorId: string;
  authorName: string;
  authorTier: string;
  rating: number;
  body: string;
  robotType: string;
  createdAt: string; // ISO 8601
}

export interface MarketplaceListingRecord {
  id: string;
  sellerId: string;
  sellerName: string;
  type: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  robotType: string;
  baseModel: string;
  tags: string[];
  status: string;
  isFeatured: boolean;
  isTrending: boolean;
  downloadCount: number;
  rating: number;
  reviewCount: number;
  taskCategory: string | null;
  successRate: number | null;
  adapterSizeMB: number | null;
  episodeCount: number | null;
  frameCount: number | null;
  datasetSizeGB: number | null;
  collectionMethod: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  licenses: ListingLicenseRecord[];
  reviews: ListingReviewRecord[];
}

export interface ListingVersionRecord {
  id: string;
  listingId: string;
  version: string;
  artifactUri: string;
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string | null;
  changelog: string | null;
  createdAt: string; // ISO 8601
}

export interface ListingPurchaseRecord {
  id: string;
  buyerId: string;
  listingId: string;
  licenseId: string;
  licenseTier: string;
  versionId: string | null;
  creditsPaid: number;
  downloadCount: number;
  purchasedAt: string; // ISO 8601
  listing: MarketplaceListingRecord;
}

/** Batched per-seller aggregates for seller DTO derivation. */
export interface SellerStats {
  /** SUM(ContributionCredit.amount) for the seller. */
  creditSum: number;
  /** COUNT of purchases across ALL listings of the seller. */
  totalSales: number;
  /** AVG listing.rating over published listings with reviewCount > 0 (1 decimal, 0 when none). */
  rating: number;
}

export interface ListingFilter {
  status?: string;
  sellerId?: string;
  type?: string;
  robotType?: string;
  baseModel?: string;
  featured?: boolean;
  trending?: boolean;
}

// ============================================================================
// DB → DOMAIN MAPPERS
// ============================================================================

type ListingRow = Prisma.MarketplaceListingGetPayload<{
  include: { licenses: true; reviews: true };
}>;
type ListingRowNoReviews = Prisma.MarketplaceListingGetPayload<{ include: { licenses: true } }>;
type LicenseRow = Prisma.ListingLicenseGetPayload<Record<string, never>>;
type ReviewRow = Prisma.ListingReviewGetPayload<Record<string, never>>;
type VersionRow = Prisma.ListingVersionGetPayload<Record<string, never>>;
type PurchaseRow = Prisma.ListingPurchaseGetPayload<{
  include: { listing: { include: { licenses: true } }; license: true };
}>;

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function licenseDbToDomain(row: LicenseRow): ListingLicenseRecord {
  return {
    id: row.id,
    listingId: row.listingId,
    tier: row.tier,
    label: row.label,
    description: row.description,
    priceCredits: row.priceCredits,
    features: parseStringArray(row.features),
  };
}

function reviewDbToDomain(row: ReviewRow): ListingReviewRecord {
  return {
    id: row.id,
    listingId: row.listingId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorTier: row.authorTier,
    rating: row.rating,
    body: row.body,
    robotType: row.robotType,
    createdAt: row.createdAt.toISOString(),
  };
}

function listingDbToDomain(row: ListingRow | ListingRowNoReviews): MarketplaceListingRecord {
  const reviews = 'reviews' in row ? (row.reviews as ReviewRow[]) : [];
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    type: row.type,
    title: row.title,
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    robotType: row.robotType,
    baseModel: row.baseModel,
    tags: parseStringArray(row.tags),
    status: row.status,
    isFeatured: row.isFeatured,
    isTrending: row.isTrending,
    downloadCount: row.downloadCount,
    rating: row.rating,
    reviewCount: row.reviewCount,
    taskCategory: row.taskCategory,
    successRate: row.successRate,
    adapterSizeMB: row.adapterSizeMB,
    episodeCount: row.episodeCount,
    frameCount: row.frameCount,
    datasetSizeGB: row.datasetSizeGB,
    collectionMethod: row.collectionMethod,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    licenses: row.licenses.map(licenseDbToDomain),
    reviews: reviews.map(reviewDbToDomain),
  };
}

function versionDbToDomain(row: VersionRow): ListingVersionRecord {
  return {
    id: row.id,
    listingId: row.listingId,
    version: row.version,
    artifactUri: row.artifactUri,
    fileName: row.fileName,
    fileSizeBytes: Number(row.fileSizeBytes),
    checksumSha256: row.checksumSha256,
    changelog: row.changelog,
    createdAt: row.createdAt.toISOString(),
  };
}

function purchaseDbToDomain(row: PurchaseRow): ListingPurchaseRecord {
  return {
    id: row.id,
    buyerId: row.buyerId,
    listingId: row.listingId,
    licenseId: row.licenseId,
    licenseTier: row.license.tier,
    versionId: row.versionId,
    creditsPaid: row.creditsPaid,
    downloadCount: row.downloadCount,
    purchasedAt: row.purchasedAt.toISOString(),
    listing: listingDbToDomain(row.listing),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class MarketplaceRepository {
  /**
   * List listings matching structured filters (licenses included, no reviews),
   * newest first. Free-text search is applied by the service layer so the
   * behaviour is identical on SQLite and PostgreSQL.
   */
  async findListings(filter: ListingFilter = {}): Promise<MarketplaceListingRecord[]> {
    const where: Prisma.MarketplaceListingWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.sellerId) where.sellerId = filter.sellerId;
    if (filter.type) where.type = filter.type;
    if (filter.robotType) where.robotType = filter.robotType;
    if (filter.baseModel) where.baseModel = filter.baseModel;
    if (filter.featured !== undefined) where.isFeatured = filter.featured;
    if (filter.trending !== undefined) where.isTrending = filter.trending;

    const rows = await prisma.marketplaceListing.findMany({
      where,
      include: { licenses: true },
      orderBy: { createdAt: 'desc' },
      // Safety cap: browse is unpaginated; without a bound this loads every
      // listing (plus licenses) into memory on each request.
      take: 500,
    });
    return rows.map(listingDbToDomain);
  }

  /** Get a single listing with licenses; reviews (newest first) when requested. */
  async findListingById(
    id: string,
    options: { includeReviews?: boolean } = {}
  ): Promise<MarketplaceListingRecord | null> {
    const row = await prisma.marketplaceListing.findUnique({
      where: { id },
      include: options.includeReviews
        ? { licenses: true, reviews: { orderBy: { createdAt: 'desc' } } }
        : { licenses: true },
    });
    return row ? listingDbToDomain(row as ListingRow | ListingRowNoReviews) : null;
  }

  /** Create a listing together with its license tiers. */
  async createListing(input: {
    sellerId: string;
    sellerName: string;
    type: string;
    title: string;
    shortDescription: string;
    fullDescription: string;
    robotType: string;
    baseModel: string;
    tags: string[];
    taskCategory?: string;
    successRate?: number;
    adapterSizeMB?: number;
    episodeCount?: number;
    frameCount?: number;
    datasetSizeGB?: number;
    collectionMethod?: string;
    licenses: {
      tier: string;
      label: string;
      description: string;
      priceCredits: number;
      features: string[];
    }[];
  }): Promise<MarketplaceListingRecord> {
    const row = await prisma.marketplaceListing.create({
      data: {
        sellerId: input.sellerId,
        sellerName: input.sellerName,
        type: input.type,
        title: input.title,
        shortDescription: input.shortDescription,
        fullDescription: input.fullDescription,
        robotType: input.robotType,
        baseModel: input.baseModel,
        tags: JSON.stringify(input.tags),
        status: 'published',
        taskCategory: input.taskCategory ?? null,
        successRate: input.successRate ?? null,
        adapterSizeMB: input.adapterSizeMB ?? null,
        episodeCount: input.episodeCount ?? null,
        frameCount: input.frameCount ?? null,
        datasetSizeGB: input.datasetSizeGB ?? null,
        collectionMethod: input.collectionMethod ?? null,
        licenses: {
          create: input.licenses.map((l) => ({
            tier: l.tier,
            label: l.label,
            description: l.description,
            priceCredits: l.priceCredits,
            features: JSON.stringify(l.features),
          })),
        },
      },
      include: { licenses: true },
    });
    return listingDbToDomain(row);
  }

  /** Latest artifact version for a listing (newest first), or null. */
  async findLatestVersion(listingId: string): Promise<ListingVersionRecord | null> {
    const row = await prisma.listingVersion.findFirst({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? versionDbToDomain(row) : null;
  }

  /** A buyer's purchase of a listing (any tier), or null. */
  async findPurchase(buyerId: string, listingId: string): Promise<ListingPurchaseRecord | null> {
    const row = await prisma.listingPurchase.findUnique({
      where: { buyerId_listingId: { buyerId, listingId } },
      include: { listing: { include: { licenses: true } }, license: true },
    });
    return row ? purchaseDbToDomain(row) : null;
  }

  /** All purchases by a buyer, newest first, with listing + license included. */
  async findPurchasesByBuyer(buyerId: string): Promise<ListingPurchaseRecord[]> {
    const rows = await prisma.listingPurchase.findMany({
      where: { buyerId },
      include: { listing: { include: { licenses: true } }, license: true },
      orderBy: { purchasedAt: 'desc' },
    });
    return rows.map(purchaseDbToDomain);
  }

  /** A buyer's review of a listing, or null. */
  async findReview(listingId: string, authorId: string): Promise<ListingReviewRecord | null> {
    const row = await prisma.listingReview.findUnique({
      where: { listingId_authorId: { listingId, authorId } },
    });
    return row ? reviewDbToDomain(row) : null;
  }

  /**
   * Increment download counters: always on the listing, and on the purchase
   * when the downloader is a purchaser (sellers download without a purchase).
   */
  async incrementDownloadCounts(listingId: string, purchaseId?: string): Promise<void> {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.marketplaceListing.update({
        where: { id: listingId },
        data: { downloadCount: { increment: 1 } },
      }),
    ];
    if (purchaseId) {
      ops.push(
        prisma.listingPurchase.update({
          where: { id: purchaseId },
          data: { downloadCount: { increment: 1 } },
        })
      );
    }
    await prisma.$transaction(ops);
  }

  /** SUM(ContributionCredit.amount) for a user (0 if none). */
  async getCreditBalance(userId: string): Promise<number> {
    const result = await prisma.contributionCredit.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  /** Sum of creditsPaid per listing, batched (for "My Listings" revenue). */
  async getRevenueByListing(listingIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (listingIds.length === 0) return map;
    const groups = await prisma.listingPurchase.groupBy({
      by: ['listingId'],
      where: { listingId: { in: listingIds } },
      _sum: { creditsPaid: true },
    });
    for (const g of groups) {
      map.set(g.listingId, g._sum.creditsPaid ?? 0);
    }
    return map;
  }

  /**
   * Batched seller aggregates for a set of seller ids (3 queries total,
   * regardless of how many sellers/listings are involved):
   *  - credit sums via contributionCredit.groupBy
   *  - purchase counts via listingPurchase.groupBy over the sellers' listings
   *  - avg rating over published listings with reviewCount > 0
   */
  async getSellerStats(sellerIds: string[]): Promise<Map<string, SellerStats>> {
    const stats = new Map<string, SellerStats>();
    const uniqueIds = [...new Set(sellerIds)];
    if (uniqueIds.length === 0) return stats;

    const [creditGroups, sellerListings] = await Promise.all([
      prisma.contributionCredit.groupBy({
        by: ['userId'],
        where: { userId: { in: uniqueIds } },
        _sum: { amount: true },
      }),
      prisma.marketplaceListing.findMany({
        where: { sellerId: { in: uniqueIds } },
        select: {
          id: true,
          sellerId: true,
          rating: true,
          reviewCount: true,
          status: true,
          downloadCount: true,
        },
      }),
    ]);

    const creditsBySeller = new Map(creditGroups.map((g) => [g.userId, g._sum.amount ?? 0]));

    for (const sellerId of uniqueIds) {
      const listings = sellerListings.filter((l) => l.sellerId === sellerId);
      // Downloads are the sales signal: every purchase leads to a download and
      // seeded listings carry historic download counts, while ListingPurchase
      // rows only exist for purchases made through this instance.
      const totalSales = listings.reduce((sum, l) => sum + l.downloadCount, 0);
      const rated = listings.filter((l) => l.status === 'published' && l.reviewCount > 0);
      const rating = rated.length
        ? Math.round((rated.reduce((sum, l) => sum + l.rating, 0) / rated.length) * 10) / 10
        : 0;
      stats.set(sellerId, {
        creditSum: creditsBySeller.get(sellerId) ?? 0,
        totalSales,
        rating,
      });
    }
    return stats;
  }
}

// Singleton instance
export const marketplaceRepository = new MarketplaceRepository();
