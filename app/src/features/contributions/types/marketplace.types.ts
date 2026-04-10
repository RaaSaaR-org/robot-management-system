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
