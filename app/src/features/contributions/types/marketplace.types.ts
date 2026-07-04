/**
 * @file marketplace.types.ts
 * @description Type definitions for the Skill & Data Marketplace
 * @feature marketplace
 */

import type { ContributorTier } from './contributions.types';

// ============================================================================
// ENUMS
// ============================================================================

export type MarketplaceItemType = 'skill' | 'dataset';

export type MarketplaceLicenseTier =
  | 'research'
  | 'per_robot'
  | 'per_fleet'
  | 'enterprise';

export type RobotHardwareType = 'SO-101' | 'Unitree H1' | 'Generic';

export type BaseModelType = 'SmolVLA' | 'Pi0.5' | 'OpenVLA' | 'None';

// ============================================================================
// ENTITIES
// ============================================================================

export interface MarketplaceSeller {
  id: string;
  displayName: string;
  tier: ContributorTier;
  totalSales: number;
  rating: number;
  avatarInitials: string;
}

export interface LicenseTierPrice {
  tier: MarketplaceLicenseTier;
  label: string;
  description: string;
  priceCredits: number;
  features: string[];
}

export interface MarketplaceReview {
  id: string;
  authorName: string;
  authorTier: ContributorTier;
  rating: number;
  body: string;
  createdAt: string;
  robotType: RobotHardwareType;
}

export interface MarketplaceListing {
  id: string;
  type: MarketplaceItemType;
  title: string;
  shortDescription: string;
  fullDescription: string;
  seller: MarketplaceSeller;
  robotType: RobotHardwareType;
  baseModel: BaseModelType;
  tags: string[];
  rating: number;
  reviewCount: number;
  downloadCount: number;
  isTrending: boolean;
  isFeatured: boolean;
  // Skill-specific
  taskCategory?: string;
  successRate?: number;
  adapterSizeMB?: number;
  // Dataset-specific
  episodeCount?: number;
  frameCount?: number;
  datasetSizeGB?: number;
  collectionMethod?: string;
  // Pricing
  priceTiers: LicenseTierPrice[];
  lowestPriceCredits: number;
  createdAt: string;
  reviews: MarketplaceReview[];
}

export interface MarketplacePurchase {
  id: string;
  listingId: string;
  listing: MarketplaceListing;
  licenseTier: MarketplaceLicenseTier;
  purchasedAt: string;
  creditsSpent: number;
}

export interface MyMarketplaceListing {
  listing: MarketplaceListing;
  totalRevenue: number;
  totalDownloads: number;
  status: 'active' | 'pending_review' | 'draft';
}

export interface MarketplaceFilters {
  type: 'all' | MarketplaceItemType;
  robotType: 'all' | RobotHardwareType;
  baseModel: 'all' | BaseModelType;
  minRating: number | null;
  search: string;
}

// ============================================================================
// API REQUEST / RESPONSE TYPES
// ============================================================================

/** Price tier input when creating a listing */
export interface CreateListingPriceTierInput {
  tier: MarketplaceLicenseTier;
  priceCredits: number;
  description?: string;
  features?: string[];
}

/** Request body for POST /marketplace/listings */
export interface CreateListingInput {
  type: MarketplaceItemType;
  title: string;
  shortDescription: string;
  fullDescription: string;
  robotType: RobotHardwareType;
  baseModel: BaseModelType;
  tags?: string[];
  // Skill-specific
  taskCategory?: string;
  successRate?: number;
  adapterSizeMB?: number;
  // Dataset-specific
  episodeCount?: number;
  frameCount?: number;
  datasetSizeGB?: number;
  collectionMethod?: string;
  priceTiers: CreateListingPriceTierInput[];
}

/** Request body for POST /marketplace/listings/:id/reviews */
export interface SubmitReviewInput {
  rating: number;
  body: string;
  robotType?: RobotHardwareType;
}

/** Download metadata from GET /marketplace/listings/:id/download */
export interface MarketplaceDownloadInfo {
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string | null;
  /** e.g. 'safetensors' | 'lerobot-v3' */
  format: string;
  /** e.g. '1.0.0' */
  version: string;
  /** Presigned URL when object storage is available, else null (stream endpoint) */
  url: string | null;
  expiresInSeconds: number | null;
}

/** Query params for GET /marketplace/listings */
export interface ListListingsParams {
  type?: MarketplaceItemType;
  robotType?: RobotHardwareType;
  baseModel?: BaseModelType;
  search?: string;
  featured?: boolean;
  trending?: boolean;
}

/** Response of GET /marketplace/listings */
export interface ListListingsResponse {
  listings: MarketplaceListing[];
  total: number;
}

/** Response of GET /marketplace/listings/:id */
export interface GetListingResponse {
  listing: MarketplaceListing;
}

/** Response of POST /marketplace/listings/:id/purchase */
export interface PurchaseListingResponse {
  purchase: MarketplacePurchase;
  /** Buyer's new credit balance */
  balance: number;
}

/** Response of POST /marketplace/listings/:id/reviews */
export interface SubmitReviewResponse {
  review: MarketplaceReview;
  rating: number;
  reviewCount: number;
}

/** Response of GET /marketplace/my/purchases */
export interface MyPurchasesResponse {
  purchases: MarketplacePurchase[];
}

/** Response of GET /marketplace/my/listings */
export interface MyListingsResponse {
  listings: MyMarketplaceListing[];
}

/** Response of GET /marketplace/credits/balance */
export interface MarketplaceCreditBalanceResponse {
  balance: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const LICENSE_TIER_LABELS: Record<MarketplaceLicenseTier, string> = {
  research: 'Research',
  per_robot: 'Per Robot',
  per_fleet: 'Per Fleet',
  enterprise: 'Enterprise',
};

export const ITEM_TYPE_LABELS: Record<MarketplaceItemType, string> = {
  skill: 'Skill',
  dataset: 'Dataset',
};
