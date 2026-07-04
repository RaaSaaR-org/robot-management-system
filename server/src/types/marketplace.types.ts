/**
 * @file marketplace.types.ts
 * @description DTO and input types for the Skill & Data Marketplace (TASK-156).
 *              Wire shapes match app/src/features/contributions/types/marketplace.types.ts
 *              verbatim — the server serializes to these shapes.
 * @feature marketplace
 */

import type { ContributorTier } from './contribution.types.js';

// ============================================================================
// PRIMITIVE UNIONS
// ============================================================================

export type MarketplaceListingType = 'skill' | 'dataset';

export type RobotHardwareType = 'SO-101' | 'Unitree G1' | 'Unitree H1' | 'Generic';

export type BaseModelType = 'SmolVLA' | 'Pi0.5' | 'OpenVLA' | 'None';

export type MarketplaceLicenseTier = 'research' | 'per_robot' | 'per_fleet' | 'enterprise';

export type MarketplaceListingStatus = 'draft' | 'pending_review' | 'published' | 'suspended';

export type MyListingStatus = 'active' | 'pending_review' | 'draft';

// ============================================================================
// DTOs (JSON, over the wire)
// ============================================================================

export interface MarketplaceSellerDto {
  id: string;
  displayName: string;
  tier: ContributorTier;
  totalSales: number;
  rating: number;
  avatarInitials: string;
}

export interface MarketplacePriceTierDto {
  tier: MarketplaceLicenseTier;
  label: string;
  description: string;
  priceCredits: number;
  features: string[];
}

export interface MarketplaceReviewDto {
  id: string;
  authorName: string;
  authorTier: ContributorTier;
  rating: number;
  body: string;
  createdAt: string; // ISO 8601
  robotType: RobotHardwareType;
}

export interface MarketplaceListingDto {
  id: string;
  type: MarketplaceListingType;
  title: string;
  shortDescription: string;
  fullDescription: string;
  seller: MarketplaceSellerDto;
  robotType: RobotHardwareType;
  baseModel: BaseModelType;
  tags: string[];
  rating: number;
  reviewCount: number;
  downloadCount: number;
  isTrending: boolean;
  isFeatured: boolean;
  // skill
  taskCategory?: string;
  successRate?: number;
  adapterSizeMB?: number;
  // dataset
  episodeCount?: number;
  frameCount?: number;
  datasetSizeGB?: number;
  collectionMethod?: string;
  priceTiers: MarketplacePriceTierDto[];
  lowestPriceCredits: number;
  createdAt: string; // ISO 8601
  reviews: MarketplaceReviewDto[]; // [] in list responses, populated in detail
}

export interface MarketplacePurchaseDto {
  id: string;
  listingId: string;
  listing: MarketplaceListingDto; // reviews: []
  licenseTier: MarketplaceLicenseTier;
  purchasedAt: string; // ISO 8601
  creditsSpent: number;
}

export interface MyMarketplaceListingDto {
  listing: MarketplaceListingDto; // reviews: []
  totalRevenue: number;
  totalDownloads: number;
  status: MyListingStatus;
}

export interface MarketplaceDownloadInfoDto {
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string | null;
  format: string; // 'safetensors' | 'lerobot-v3'
  version: string; // e.g. '1.0.0'
  url: string | null; // presigned RustFS URL when storage is up, else null
  expiresInSeconds: number | null;
}

// ============================================================================
// INPUTS
// ============================================================================

export interface CreateListingPriceTierInput {
  tier: MarketplaceLicenseTier;
  priceCredits: number;
  description?: string;
  features?: string[];
}

export interface CreateListingInput {
  type: MarketplaceListingType;
  title: string;
  shortDescription: string;
  fullDescription: string;
  robotType: RobotHardwareType;
  baseModel: BaseModelType;
  tags?: string[];
  taskCategory?: string;
  successRate?: number;
  adapterSizeMB?: number;
  episodeCount?: number;
  frameCount?: number;
  datasetSizeGB?: number;
  collectionMethod?: string;
  priceTiers: CreateListingPriceTierInput[];
}

export interface CreateReviewInput {
  rating: number; // int 1..5
  body: string; // non-empty
  robotType?: RobotHardwareType;
}

export interface ListListingsQuery {
  type?: MarketplaceListingType;
  robotType?: string;
  baseModel?: string;
  search?: string;
  featured?: boolean;
  trending?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const MARKETPLACE_LICENSE_TIERS: MarketplaceLicenseTier[] = [
  'research',
  'per_robot',
  'per_fleet',
  'enterprise',
];

/** Default tier labels/descriptions used when a created listing omits them. */
export const DEFAULT_TIER_LABELS: Record<MarketplaceLicenseTier, { label: string; description: string }> = {
  research: { label: 'Research', description: 'Non-commercial use only' },
  per_robot: { label: 'Per Robot', description: 'One robot instance' },
  per_fleet: { label: 'Per Fleet', description: 'Unlimited robots in one org' },
  enterprise: { label: 'Enterprise', description: 'Unlimited + redistribution rights' },
};
