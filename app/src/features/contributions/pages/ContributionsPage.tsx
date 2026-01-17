/**
 * @file ContributionsPage.tsx
 * @description Main contributions dashboard page with tabs
 * @feature contributions
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Database, Coins, Trophy, Gift } from 'lucide-react';
import { ContributionList } from '../components/ContributionList';
import { CreditsDashboard } from '../components/CreditsDashboard';
import { Leaderboard } from '../components/Leaderboard';
import { RewardsList } from '../components/RewardCard';
import {
  useContributions,
  useContributionCredits,
  useLeaderboard,
  useRewards,
} from '../hooks/contributions';

// ============================================================================
// TYPES
// ============================================================================

type TabId = 'contributions' | 'credits' | 'leaderboard' | 'rewards';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Database;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TABS: Tab[] = [
  { id: 'contributions', label: 'My Contributions', icon: Database },
  { id: 'credits', label: 'Credits', icon: Coins },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'rewards', label: 'Rewards', icon: Gift },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('contributions');

  // Hooks
  const {
    contributions,
    filters,
    pagination,
    isLoading: contributionsLoading,
    setFilters,
    clearFilters,
    setPage,
  } = useContributions();

  const {
    balance,
    history,
  } = useContributionCredits();

  const {
    leaderboard,
    stats,
    isLoading: leaderboardLoading,
  } = useLeaderboard();

  const {
    rewards,
    redeemCredits: redeemReward,
    isLoading: rewardsLoading,
  } = useRewards();

  const handleContributionClick = (contribution: { id: string }) => {
    navigate(`/contributions/${contribution.id}`);
  };

  const handleNewContribution = () => {
    navigate('/contributions/new');
  };

  const handleRedeemReward = async (reward: { id: string }) => {
    try {
      await redeemReward(reward.id);
    } catch (error) {
      console.error('Failed to redeem:', error);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Data Contributions
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Contribute training data and earn credits for rewards
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex space-x-8">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors',
                  isActive
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                )}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[500px]">
        {activeTab === 'contributions' && (
          <ContributionList
            contributions={contributions}
            filters={filters}
            pagination={pagination}
            isLoading={contributionsLoading}
            onFilterChange={setFilters}
            onClearFilters={clearFilters}
            onPageChange={setPage}
            onContributionClick={handleContributionClick}
            onNewContribution={handleNewContribution}
          />
        )}

        {activeTab === 'credits' && (
          <CreditsDashboard
            balance={balance}
            history={history}
            onRedeemClick={() => setActiveTab('rewards')}
          />
        )}

        {activeTab === 'leaderboard' && (
          <Leaderboard
            entries={leaderboard}
            currentUserStats={stats}
            isLoading={leaderboardLoading}
          />
        )}

        {activeTab === 'rewards' && (
          <RewardsList
            rewards={rewards}
            availableCredits={balance?.available || 0}
            onRedeem={handleRedeemReward}
            isLoading={rewardsLoading}
          />
        )}
      </div>
    </div>
  );
}
