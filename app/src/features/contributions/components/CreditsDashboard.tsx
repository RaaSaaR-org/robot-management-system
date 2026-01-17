/**
 * @file CreditsDashboard.tsx
 * @description Dashboard component displaying credit balance and history
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import {
  Coins,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertCircle,
  History,
} from 'lucide-react';
import { TierBadge } from './TierBadge';
import type {
  CreditBalance,
  ContributionCredit,
} from '../types/contributions.types';
import {
  formatCredits,
  getTierForCredits,
  getNextTierThreshold,
  TIER_THRESHOLDS,
} from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface CreditsDashboardProps {
  balance: CreditBalance | null;
  history: ContributionCredit[];
  onRedeemClick?: () => void;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getCreditReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    contribution: 'Data Contribution',
    bonus: 'Bonus',
    referral: 'Referral Reward',
    redemption: 'Redemption',
    adjustment: 'Adjustment',
    expiration: 'Expired',
  };
  return labels[reason] || reason;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CreditsDashboard({
  balance,
  history,
  onRedeemClick,
  className,
}: CreditsDashboardProps) {
  if (!balance) {
    return (
      <div
        className={cn(
          'flex items-center justify-center p-8 text-gray-500 dark:text-gray-400',
          className
        )}
      >
        <Clock className="w-5 h-5 mr-2" />
        <span>Loading credit balance...</span>
      </div>
    );
  }

  const tier = getTierForCredits(balance.totalEarned);
  const nextThreshold = getNextTierThreshold(balance.totalEarned);
  const progressToNext = nextThreshold
    ? ((balance.totalEarned - TIER_THRESHOLDS[tier]) /
        (nextThreshold - TIER_THRESHOLDS[tier])) *
      100
    : 100;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Balance Card */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-primary-100 text-sm mb-1">Available Balance</p>
            <p className="text-4xl font-bold">{formatCredits(balance.available)}</p>
            <p className="text-primary-200 text-sm mt-1">credits</p>
          </div>
          <div className="flex items-center gap-2">
            <TierBadge tier={tier} className="bg-white/20 text-white" />
          </div>
        </div>

        {/* Tier Progress */}
        {nextThreshold && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-primary-200 mb-1">
              <span>{formatCredits(balance.totalEarned)} earned</span>
              <span>{formatCredits(nextThreshold)} for next tier</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{ width: `${progressToNext}%` }}
              />
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-white/20">
          <div>
            <p className="text-primary-200 text-xs">Total Earned</p>
            <p className="font-semibold">{formatCredits(balance.totalEarned)}</p>
          </div>
          <div>
            <p className="text-primary-200 text-xs">Redeemed</p>
            <p className="font-semibold">{formatCredits(balance.totalRedeemed)}</p>
          </div>
          <div>
            <p className="text-primary-200 text-xs">Pending</p>
            <p className="font-semibold">{formatCredits(balance.pending)}</p>
          </div>
        </div>
      </div>

      {/* Expiring Soon Warning */}
      {balance.expiringSoon > 0 && (
        <div className="flex items-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              {formatCredits(balance.expiringSoon)} credits expiring soon
            </p>
            {balance.expirationDate && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                Expires on {formatDate(balance.expirationDate)}
              </p>
            )}
          </div>
          {onRedeemClick && (
            <button
              onClick={onRedeemClick}
              className="px-3 py-1.5 text-sm font-medium bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
            >
              Redeem Now
            </button>
          )}
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-gray-400" />
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              Credit History
            </h3>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <Coins className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No credit activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {history.slice(0, 10).map((credit) => (
              <div
                key={credit.id}
                className="flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'p-2 rounded-lg',
                      credit.amount > 0
                        ? 'bg-green-100 dark:bg-green-900/30'
                        : 'bg-red-100 dark:bg-red-900/30'
                    )}
                  >
                    {credit.amount > 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {getCreditReasonLabel(credit.reason)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {credit.description || formatDate(credit.awardedAt)}
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    'font-semibold',
                    credit.amount > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {credit.amount > 0 ? '+' : ''}
                  {formatCredits(credit.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
