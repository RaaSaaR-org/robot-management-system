/**
 * @file index.ts
 * @description Barrel export for contributions feature
 * @feature contributions
 */

// Types
export * from './types/contributions.types';

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

// API
export { contributionsApi } from './api/contributionsApi';

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
} from './components';

// Pages
export {
  ContributionsPage,
  NewContributionPage,
  ContributionDetailPage,
} from './pages';
