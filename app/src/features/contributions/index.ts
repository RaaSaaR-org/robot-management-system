/**
 * @file index.ts
 * @description Barrel export for contributions feature
 * @feature contributions
 */

// Types
export * from './types/contributions.types';
export * from './types/marketplace.types';

// Store
export { useContributionsStore } from './store/contributionsStore';
export {
  selectContributions,
  selectSelectedContribution,
  selectCreditBalance,
  selectCreditHistory,
  selectStats,
  selectLeaderboard,
  selectRewards,
  selectRedemptions,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectError,
  selectWizardStep,
  selectWizardData,
  selectContributionById,
  selectContributionsByStatus,
  selectAffordableRewards,
} from './store/contributionsStore';

// Marketplace Store
export { useMarketplaceStore } from './store/marketplaceStore';
export {
  selectMarketplaceListings,
  selectCurrentListing,
  selectMyPurchases,
  selectMyListings,
  selectMarketplaceCreditBalance,
  selectIsLoadingListings,
  selectIsLoadingDetail,
  selectIsLoadingMy,
  selectIsPurchasing,
  selectIsSubmittingReview,
  selectIsCreatingListing,
  selectMarketplaceError,
  selectPurchaseError,
  selectFeaturedListings,
  selectTrendingListings,
} from './store/marketplaceStore';
export type { MarketplaceStore } from './store/marketplaceStore';

// API
export { contributionsApi } from './api/contributionsApi';
export { marketplaceApi, InsufficientCreditsError } from './api/marketplaceApi';

// Hooks
export {
  useContributions,
  useContribution,
  useContributionCredits,
  useContributionWizard,
  useLeaderboard,
  useRewards,
} from './hooks/contributions';
export type {
  UseContributionsReturn,
  UseContributionReturn,
  UseContributionCreditsReturn,
  UseContributionWizardReturn,
  UseLeaderboardReturn,
  UseRewardsReturn,
} from './hooks/contributions';
export {
  useMarketplace,
  useMarketplaceListing,
  useMyMarketplace,
  useMarketplaceDownload,
} from './hooks/marketplace';
export type {
  UseMarketplaceReturn,
  UseMarketplaceListingReturn,
  UseMyMarketplaceReturn,
  UseMarketplaceDownloadReturn,
  MarketplaceDownloadState,
} from './hooks/marketplace';

// Components
export {
  ContributionStatusBadge,
  TierBadge,
  ContributionCard,
  ContributionList,
  ContributionDetail,
  LicenseSelector,
  ContributionWizard,
  CreditsDashboard,
  RewardCard,
  RewardsList,
  Leaderboard,
  ImpactVisualization,
  ContributionBadge,
  CreditBalance,
  LeaderboardTable,
  MarketplaceListingCard,
  MarketplaceLicenseTierSelector,
  MarketplaceStarRating,
  MarketplaceDownloadModal,
  MarketplacePublishDialog,
} from './components';
export type {
  ContributionStatusBadgeProps,
  TierBadgeProps,
  ContributionCardProps,
  ContributionListProps,
  ContributionDetailProps,
  LicenseSelectorProps,
  ContributionWizardProps,
  CreditsDashboardProps,
  RewardCardProps,
  RewardsListProps,
  LeaderboardProps,
  ImpactVisualizationProps,
  ContributionBadgeProps,
  DbContributionStatus,
  CreditBalanceProps,
  LeaderboardTableProps,
  LeaderboardRow,
  MarketplaceListingCardProps,
  MarketplaceLicenseTierSelectorProps,
  MarketplaceStarRatingProps,
  MarketplaceDownloadModalProps,
  MarketplacePublishDialogProps,
} from './components';

// Pages
export {
  ContributionsPage,
  NewContributionPage,
  ContributionDetailPage,
  MarketplacePage,
  MarketplaceDetailPage,
  MyMarketplacePage,
} from './pages';
