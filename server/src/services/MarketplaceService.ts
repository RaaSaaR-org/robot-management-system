/**
 * @file MarketplaceService.ts
 * @description Business logic for the Skill & Data Marketplace (TASK-156):
 *              listing DTO assembly (batched seller derivation), atomic
 *              credit-based purchases, reviews with denormalized rating
 *              updates, and artifact download resolution (RustFS presigned
 *              URL or local-disk fallback with path-traversal guard).
 * @feature marketplace
 */

import path from 'path';
import { stat } from 'fs/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/index.js';
import {
  marketplaceRepository,
  type MarketplaceListingRecord,
  type ListingPurchaseRecord,
  type SellerStats,
} from '../repositories/MarketplaceRepository.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';
import { getTierForCredits } from '../types/contribution.types.js';
import {
  DEFAULT_TIER_LABELS,
  type BaseModelType,
  type CreateListingInput,
  type CreateReviewInput,
  type ListListingsQuery,
  type MarketplaceDownloadInfoDto,
  type MarketplaceLicenseTier,
  type MarketplaceListingDto,
  type MarketplaceListingType,
  type MarketplacePurchaseDto,
  type MarketplaceReviewDto,
  type MyListingStatus,
  type MyMarketplaceListingDto,
  type RobotHardwareType,
} from '../types/marketplace.types.js';

// ============================================================================
// RESULT TYPES
// ============================================================================

/** Error result carrying the HTTP status the route should respond with. */
export interface MarketplaceServiceError {
  ok: false;
  status: number;
  error: string;
  extras?: Record<string, number | string>;
}

export type MarketplaceServiceResult<T> = ({ ok: true } & T) | MarketplaceServiceError;

// ============================================================================
// HELPERS
// ============================================================================

const TIER_ORDER: Record<string, number> = {
  research: 0,
  per_robot: 1,
  per_fleet: 2,
  enterprise: 3,
};

/** First letters of the first two words of the display name, uppercased. */
function avatarInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Default artifact file name when a listing has no uploaded version yet. */
function defaultFileName(listing: MarketplaceListingRecord): string {
  const slug = slugify(listing.title) || listing.id;
  return listing.type === 'skill' ? `${slug}-adapter.safetensors` : `${slug}-lerobot-v3.tar.gz`;
}

/** Prisma P2002: unique constraint violated (lost race with a concurrent write). */
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Prisma P2034: serializable transaction conflict/deadlock — safe to retry. */
function isTransactionConflictError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

function artifactFormat(listing: MarketplaceListingRecord): string {
  return listing.type === 'skill' ? 'safetensors' : 'lerobot-v3';
}

// ============================================================================
// SERVICE
// ============================================================================

export class MarketplaceService {
  /**
   * Interactive transaction at SERIALIZABLE isolation with retry on P2034.
   * READ COMMITTED (the PostgreSQL default) lets two concurrent transactions
   * read the same credit-ledger sum and both commit — write skew.
   */
  private async withSerializableRetry<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    maxAttempts = 3
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (isTransactionConflictError(error) && attempt < maxAttempts) {
          console.warn(
            `[MarketplaceService] Serializable conflict (attempt ${attempt}/${maxAttempts}), retrying`
          );
          continue;
        }
        throw error;
      }
    }
  }

  // ==========================================================================
  // DTO ASSEMBLY
  // ==========================================================================

  private toListingDto(
    record: MarketplaceListingRecord,
    sellerStats: Map<string, SellerStats>,
    options: { includeReviews?: boolean } = {}
  ): MarketplaceListingDto {
    const stats = sellerStats.get(record.sellerId) ?? { creditSum: 0, totalSales: 0, rating: 0 };
    const priceTiers = [...record.licenses]
      .sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99))
      .map((license) => ({
        tier: license.tier as MarketplaceLicenseTier,
        label: license.label,
        description: license.description,
        priceCredits: license.priceCredits,
        features: license.features,
      }));
    const lowestPriceCredits = priceTiers.length
      ? Math.min(...priceTiers.map((t) => t.priceCredits))
      : 0;

    return {
      id: record.id,
      type: record.type as MarketplaceListingType,
      title: record.title,
      shortDescription: record.shortDescription,
      fullDescription: record.fullDescription,
      seller: {
        id: record.sellerId,
        displayName: record.sellerName,
        tier: getTierForCredits(stats.creditSum),
        totalSales: stats.totalSales,
        rating: stats.rating,
        avatarInitials: avatarInitials(record.sellerName),
      },
      robotType: record.robotType as RobotHardwareType,
      baseModel: record.baseModel as BaseModelType,
      tags: record.tags,
      rating: record.rating,
      reviewCount: record.reviewCount,
      downloadCount: record.downloadCount,
      isTrending: record.isTrending,
      isFeatured: record.isFeatured,
      taskCategory: record.taskCategory ?? undefined,
      successRate: record.successRate ?? undefined,
      adapterSizeMB: record.adapterSizeMB ?? undefined,
      episodeCount: record.episodeCount ?? undefined,
      frameCount: record.frameCount ?? undefined,
      datasetSizeGB: record.datasetSizeGB ?? undefined,
      collectionMethod: record.collectionMethod ?? undefined,
      priceTiers,
      lowestPriceCredits,
      createdAt: record.createdAt,
      reviews: options.includeReviews
        ? record.reviews.map((review) => this.toReviewDto(review))
        : [],
    };
  }

  private toReviewDto(review: MarketplaceListingRecord['reviews'][number]): MarketplaceReviewDto {
    return {
      id: review.id,
      authorName: review.authorName,
      authorTier: review.authorTier as MarketplaceReviewDto['authorTier'],
      rating: review.rating,
      body: review.body,
      createdAt: review.createdAt,
      robotType: review.robotType as RobotHardwareType,
    };
  }

  private toPurchaseDto(
    purchase: ListingPurchaseRecord,
    sellerStats: Map<string, SellerStats>
  ): MarketplacePurchaseDto {
    return {
      id: purchase.id,
      listingId: purchase.listingId,
      listing: this.toListingDto(purchase.listing, sellerStats),
      licenseTier: purchase.licenseTier as MarketplaceLicenseTier,
      purchasedAt: purchase.purchasedAt,
      creditsSpent: purchase.creditsPaid,
    };
  }

  // ==========================================================================
  // LISTINGS
  // ==========================================================================

  async listListings(
    query: ListListingsQuery
  ): Promise<{ listings: MarketplaceListingDto[]; total: number }> {
    let records = await marketplaceRepository.findListings({
      status: 'published',
      type: query.type,
      robotType: query.robotType,
      baseModel: query.baseModel,
      featured: query.featured ? true : undefined,
      trending: query.trending ? true : undefined,
    });

    if (query.search) {
      const needle = query.search.toLowerCase();
      records = records.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          r.shortDescription.toLowerCase().includes(needle) ||
          r.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    }

    const sellerStats = await marketplaceRepository.getSellerStats(
      records.map((r) => r.sellerId)
    );
    const listings = records.map((r) => this.toListingDto(r, sellerStats));
    return { listings, total: listings.length };
  }

  async getListing(id: string): Promise<MarketplaceListingDto | null> {
    const record = await marketplaceRepository.findListingById(id, { includeReviews: true });
    if (!record) return null;
    const sellerStats = await marketplaceRepository.getSellerStats([record.sellerId]);
    return this.toListingDto(record, sellerStats, { includeReviews: true });
  }

  async createListing(
    sellerId: string,
    sellerName: string,
    input: CreateListingInput
  ): Promise<MarketplaceListingDto> {
    const record = await marketplaceRepository.createListing({
      sellerId,
      sellerName,
      type: input.type,
      title: input.title,
      shortDescription: input.shortDescription,
      fullDescription: input.fullDescription,
      robotType: input.robotType,
      baseModel: input.baseModel,
      tags: input.tags ?? [],
      taskCategory: input.taskCategory,
      successRate: input.successRate,
      adapterSizeMB: input.adapterSizeMB,
      episodeCount: input.episodeCount,
      frameCount: input.frameCount,
      datasetSizeGB: input.datasetSizeGB,
      collectionMethod: input.collectionMethod,
      licenses: input.priceTiers.map((tier) => ({
        tier: tier.tier,
        label: DEFAULT_TIER_LABELS[tier.tier].label,
        description: tier.description ?? DEFAULT_TIER_LABELS[tier.tier].description,
        priceCredits: tier.priceCredits,
        features: tier.features ?? [],
      })),
    });
    const sellerStats = await marketplaceRepository.getSellerStats([sellerId]);
    return this.toListingDto(record, sellerStats);
  }

  // ==========================================================================
  // PURCHASE
  // ==========================================================================

  async purchaseListing(
    buyerId: string,
    listingId: string,
    tier: MarketplaceLicenseTier
  ): Promise<MarketplaceServiceResult<{ purchase: MarketplacePurchaseDto; balance: number }>> {
    const listing = await marketplaceRepository.findListingById(listingId);
    if (!listing || listing.status !== 'published') {
      return { ok: false, status: 404, error: 'Listing not found' };
    }

    const license = listing.licenses.find((l) => l.tier === tier);
    if (!license) {
      return { ok: false, status: 400, error: `Unknown tier '${tier}' for this listing` };
    }

    if (listing.sellerId === buyerId) {
      return { ok: false, status: 400, error: 'Sellers cannot purchase their own listing' };
    }

    const existing = await marketplaceRepository.findPurchase(buyerId, listingId);
    if (existing) {
      return { ok: false, status: 400, error: 'You already own this listing' };
    }

    // Serializable so two concurrent purchases cannot both read the same
    // pre-debit balance (the ledger is append-only, so READ COMMITTED would
    // let both debits commit and drive the balance negative).
    let txResult: { insufficient: true; balance: number } | { insufficient: false; balance: number };
    try {
      txResult = await this.withSerializableRetry(async (tx) => {
        const aggregate = await tx.contributionCredit.aggregate({
          where: { userId: buyerId },
          _sum: { amount: true },
        });
        const balance = aggregate._sum.amount ?? 0;
        if (balance < license.priceCredits) {
          return { insufficient: true as const, balance };
        }

        const version = await tx.listingVersion.findFirst({
          where: { listingId },
          orderBy: { createdAt: 'desc' },
        });
        await tx.listingPurchase.create({
          data: {
            buyerId,
            listingId,
            licenseId: license.id,
            versionId: version?.id ?? null,
            creditsPaid: license.priceCredits,
          },
        });
        await tx.contributionCredit.create({
          data: {
            userId: buyerId,
            amount: -license.priceCredits,
            reason: `Marketplace purchase: ${listing.title}`,
          },
        });
        await tx.contributionCredit.create({
          data: {
            userId: listing.sellerId,
            amount: license.priceCredits,
            reason: `Marketplace sale: ${listing.title}`,
          },
        });
        return { insufficient: false as const, balance: balance - license.priceCredits };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { ok: false, status: 400, error: 'You already own this listing' };
      }
      throw error;
    }

    if (txResult.insufficient) {
      return {
        ok: false,
        status: 402,
        error: 'Insufficient credits',
        extras: { balance: txResult.balance, required: license.priceCredits },
      };
    }

    const purchaseRecord = await marketplaceRepository.findPurchase(buyerId, listingId);
    if (!purchaseRecord) {
      return { ok: false, status: 500, error: 'Purchase could not be loaded after creation' };
    }
    const sellerStats = await marketplaceRepository.getSellerStats([
      purchaseRecord.listing.sellerId,
    ]);

    console.log(
      `[MarketplaceService] Purchase ${purchaseRecord.id}: ${buyerId} bought ${listingId} (${tier}) for ${license.priceCredits} credits`
    );

    return {
      ok: true,
      purchase: this.toPurchaseDto(purchaseRecord, sellerStats),
      balance: txResult.balance,
    };
  }

  // ==========================================================================
  // REVIEWS
  // ==========================================================================

  async createReview(
    authorId: string,
    authorName: string,
    listingId: string,
    input: CreateReviewInput
  ): Promise<
    MarketplaceServiceResult<{ review: MarketplaceReviewDto; rating: number; reviewCount: number }>
  > {
    const listing = await marketplaceRepository.findListingById(listingId);
    if (!listing) {
      return { ok: false, status: 404, error: 'Listing not found' };
    }
    if (listing.sellerId === authorId) {
      return { ok: false, status: 403, error: 'Sellers cannot review their own listing' };
    }

    const purchase = await marketplaceRepository.findPurchase(authorId, listingId);
    if (!purchase) {
      return { ok: false, status: 403, error: 'You must purchase this listing before reviewing it' };
    }

    const existing = await marketplaceRepository.findReview(listingId, authorId);
    if (existing) {
      return { ok: false, status: 400, error: 'You already reviewed this listing' };
    }

    const authorCredits = await marketplaceRepository.getCreditBalance(authorId);
    const authorTier = getTierForCredits(authorCredits);

    // Recompute the denormalized rating from a fresh in-transaction read so
    // concurrent reviews cannot desync rating from reviewCount.
    let reviewRow;
    let updatedListing;
    try {
      ({ reviewRow, updatedListing } = await this.withSerializableRetry(async (tx) => {
        const fresh = await tx.marketplaceListing.findUniqueOrThrow({
          where: { id: listingId },
          select: { rating: true, reviewCount: true },
        });
        const createdReview = await tx.listingReview.create({
          data: {
            listingId,
            authorId,
            authorName,
            authorTier,
            rating: input.rating,
            body: input.body,
            robotType: input.robotType ?? 'Generic',
          },
        });
        const newRating =
          (fresh.rating * fresh.reviewCount + input.rating) / (fresh.reviewCount + 1);
        const updated = await tx.marketplaceListing.update({
          where: { id: listingId },
          data: { rating: newRating, reviewCount: fresh.reviewCount + 1 },
        });
        return { reviewRow: createdReview, updatedListing: updated };
      }));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { ok: false, status: 400, error: 'You already reviewed this listing' };
      }
      throw error;
    }

    console.log(
      `[MarketplaceService] Review ${reviewRow.id} on ${listingId} by ${authorId} (${input.rating} stars)`
    );

    return {
      ok: true,
      review: {
        id: reviewRow.id,
        authorName: reviewRow.authorName,
        authorTier: reviewRow.authorTier as MarketplaceReviewDto['authorTier'],
        rating: reviewRow.rating,
        body: reviewRow.body,
        createdAt: reviewRow.createdAt.toISOString(),
        robotType: reviewRow.robotType as RobotHardwareType,
      },
      rating: updatedListing.rating,
      reviewCount: updatedListing.reviewCount,
    };
  }

  // ==========================================================================
  // DOWNLOADS
  // ==========================================================================

  /** Root directory for `local://` artifact URIs. */
  private get localDataRoot(): string {
    return path.join(process.cwd(), 'data');
  }

  /**
   * Resolve a `local://<rel>` URI to an absolute path under the data root.
   * Returns null when the resolved path escapes the root (path traversal).
   */
  private resolveLocalUri(uri: string): string | null {
    const relative = uri.slice('local://'.length);
    const resolved = path.resolve(this.localDataRoot, relative);
    if (resolved !== this.localDataRoot && !resolved.startsWith(this.localDataRoot + path.sep)) {
      console.error(`[MarketplaceService] Blocked path traversal in artifact URI: ${uri}`);
      return null;
    }
    return resolved;
  }

  private async authorizeDownload(
    userId: string,
    listingId: string
  ): Promise<
    MarketplaceServiceResult<{ listing: MarketplaceListingRecord; purchaseId: string | null }>
  > {
    const listing = await marketplaceRepository.findListingById(listingId);
    if (!listing) {
      return { ok: false, status: 404, error: 'Listing not found' };
    }
    if (listing.sellerId === userId) {
      return { ok: true, listing, purchaseId: null };
    }
    const purchase = await marketplaceRepository.findPurchase(userId, listingId);
    if (!purchase) {
      return { ok: false, status: 403, error: 'You must purchase this listing to download it' };
    }
    return { ok: true, listing, purchaseId: purchase.id };
  }

  /**
   * Download metadata: presigned RustFS URL when storage is up, otherwise
   * `url: null` (client falls back to the streaming endpoint). Never 500s on
   * a missing version — returns metadata derived from the listing instead.
   * Increments download counters (listing + purchase when purchaser).
   */
  async getDownloadInfo(
    userId: string,
    listingId: string
  ): Promise<MarketplaceServiceResult<{ info: MarketplaceDownloadInfoDto }>> {
    const auth = await this.authorizeDownload(userId, listingId);
    if (!auth.ok) return auth;

    const { listing, purchaseId } = auth;
    const version = await marketplaceRepository.findLatestVersion(listingId);

    let url: string | null = null;
    let expiresInSeconds: number | null = null;
    if (version?.artifactUri.startsWith('rustfs://')) {
      const remainder = version.artifactUri.slice('rustfs://'.length);
      const slashIndex = remainder.indexOf('/');
      if (slashIndex > 0 && isRustFSInitialized()) {
        const bucket = remainder.slice(0, slashIndex);
        const key = remainder.slice(slashIndex + 1);
        try {
          url = await getRustFSClient().getPresignedDownloadUrl(bucket, key, 3600);
          expiresInSeconds = 3600;
        } catch (error) {
          console.error('[MarketplaceService] Failed to presign RustFS URL:', error);
          url = null;
          expiresInSeconds = null;
        }
      }
    }

    await marketplaceRepository.incrementDownloadCounts(listingId, purchaseId ?? undefined);

    return {
      ok: true,
      info: {
        fileName: version?.fileName ?? defaultFileName(listing),
        fileSizeBytes: version?.fileSizeBytes ?? 0,
        checksumSha256: version?.checksumSha256 ?? null,
        format: artifactFormat(listing),
        version: version?.version ?? '1.0.0',
        url,
        expiresInSeconds,
      },
    };
  }

  /**
   * Resolve the artifact for streaming from local disk. 404s when there is no
   * version, the URI is not locally resolvable, or the file is missing.
   * Does NOT increment counters — counting happens in getDownloadInfo.
   */
  async resolveDownloadFile(
    userId: string,
    listingId: string
  ): Promise<
    MarketplaceServiceResult<{ absolutePath: string; fileName: string; sizeBytes: number }>
  > {
    const auth = await this.authorizeDownload(userId, listingId);
    if (!auth.ok) return auth;

    const version = await marketplaceRepository.findLatestVersion(listingId);
    if (!version) {
      return { ok: false, status: 404, error: 'No artifact available for this listing' };
    }

    if (!version.artifactUri.startsWith('local://')) {
      return {
        ok: false,
        status: 404,
        error: 'Artifact is not available for direct streaming (storage unavailable)',
      };
    }

    const absolutePath = this.resolveLocalUri(version.artifactUri);
    if (!absolutePath) {
      return { ok: false, status: 404, error: 'Artifact path is invalid' };
    }

    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) {
        return { ok: false, status: 404, error: 'Artifact missing on disk' };
      }
      return { ok: true, absolutePath, fileName: version.fileName, sizeBytes: stats.size };
    } catch {
      return { ok: false, status: 404, error: 'Artifact missing on disk' };
    }
  }

  // ==========================================================================
  // MY PURCHASES / MY LISTINGS / BALANCE
  // ==========================================================================

  async getMyPurchases(userId: string): Promise<{ purchases: MarketplacePurchaseDto[] }> {
    const records = await marketplaceRepository.findPurchasesByBuyer(userId);
    const sellerStats = await marketplaceRepository.getSellerStats(
      records.map((r) => r.listing.sellerId)
    );
    return { purchases: records.map((r) => this.toPurchaseDto(r, sellerStats)) };
  }

  async getMyListings(userId: string): Promise<{ listings: MyMarketplaceListingDto[] }> {
    const records = await marketplaceRepository.findListings({ sellerId: userId });
    const [sellerStats, revenueByListing] = await Promise.all([
      marketplaceRepository.getSellerStats([userId]),
      marketplaceRepository.getRevenueByListing(records.map((r) => r.id)),
    ]);

    const statusMap: Record<string, MyListingStatus> = {
      published: 'active',
      pending_review: 'pending_review',
      draft: 'draft',
      suspended: 'draft',
    };

    return {
      listings: records.map((record) => ({
        listing: this.toListingDto(record, sellerStats),
        totalRevenue: revenueByListing.get(record.id) ?? 0,
        totalDownloads: record.downloadCount,
        status: statusMap[record.status] ?? 'draft',
      })),
    };
  }

  async getCreditBalance(userId: string): Promise<number> {
    return marketplaceRepository.getCreditBalance(userId);
  }
}

// Singleton instance
export const marketplaceService = new MarketplaceService();
