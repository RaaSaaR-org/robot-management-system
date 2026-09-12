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
          'flex items-center justify-center p-8 text-ink-tertiary ',
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
      <div className="rounded-panel border border-line bg-panel p-6 text-ink-primary">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-ink-secondary text-sm mb-1">Available Balance</p>
            <p className="font-display text-4xl font-semibold tabular-nums">{formatCredits(balance.available)}</p>
            <p className="text-ink-secondary text-sm mt-1">credits</p>
          </div>
          <div className="flex items-center gap-2">
            <TierBadge tier={tier} />
          </div>
        </div>

        {/* Tier Progress */}
        {nextThreshold && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-ink-secondary mb-1">
              <span>{formatCredits(balance.totalEarned)} earned</span>
              <span>{formatCredits(nextThreshold)} for next tier</span>
            </div>
            <div className="h-2 bg-inset rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${progressToNext}%` }}
              />
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-line">
          <div>
            <p className="text-ink-secondary text-xs">Total Earned</p>
            <p className="font-semibold">{formatCredits(balance.totalEarned)}</p>
          </div>
          <div>
            <p className="text-ink-secondary text-xs">Redeemed</p>
            <p className="font-semibold">{formatCredits(balance.totalRedeemed)}</p>
          </div>
          <div>
            <p className="text-ink-secondary text-xs">Pending</p>
            <p className="font-semibold">{formatCredits(balance.pending)}</p>
          </div>
        </div>
      </div>

      {/* Expiring Soon Warning */}
      {balance.expiringSoon > 0 && (
        <div className="flex items-center gap-3 p-4 bg-signal-unknown/10 border border-signal-unknown/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-signal-unknown" />
          <div className="flex-1">
            <p className="text-sm font-medium text-signal-unknown">
              {formatCredits(balance.expiringSoon)} credits expiring soon
            </p>
            {balance.expirationDate && (
              <p className="text-xs text-signal-unknown">
                Expires on {formatDate(balance.expirationDate)}
              </p>
            )}
          </div>
          {onRedeemClick && (
            <button
              onClick={onRedeemClick}
              className="px-3 py-1.5 text-sm font-medium bg-primary text-on-primary rounded-lg hover:bg-primary-hover"
            >
              Redeem Now
            </button>
          )}
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-panel rounded-xl border border-line">
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-ink-muted" />
            <h3 className="font-medium text-ink-primary">
              Credit History
            </h3>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-ink-tertiary">
            <Coins className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No credit activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-line-subtle">
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
                        ? 'bg-signal-measured/10 '
                        : 'bg-signal-stopped/10 '
                    )}
                  >
                    {credit.amount > 0 ? (
                      <TrendingUp className="w-4 h-4 text-signal-measured" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-signal-stopped" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-ink-primary">
                      {getCreditReasonLabel(credit.reason)}
                    </p>
                    <p className="text-sm text-ink-tertiary">
                      {credit.description || formatDate(credit.awardedAt)}
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    'font-semibold',
                    credit.amount > 0
                      ? 'text-signal-measured '
                      : 'text-signal-stopped '
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
