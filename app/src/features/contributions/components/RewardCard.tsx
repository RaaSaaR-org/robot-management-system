/**
 * @file RewardCard.tsx
 * @description Card component for displaying redeemable rewards
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import {
  Gift,
  Zap,
  Headphones,
  Rocket,
  Package,
  Coins,
  Lock,
} from 'lucide-react';
import type { Reward, RewardType } from '../types/contributions.types';
import { formatCredits } from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RewardCardProps {
  reward: Reward;
  availableCredits: number;
  onRedeem?: (reward: Reward) => void;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const REWARD_ICONS: Record<RewardType, typeof Gift> = {
  service_credit: Coins,
  feature_unlock: Zap,
  priority_support: Headphones,
  training_priority: Rocket,
  merchandise: Package,
};

const REWARD_COLORS: Record<RewardType, string> = {
  service_credit: ' ',
  feature_unlock: ' ',
  priority_support: ' ',
  training_priority: ' ',
  merchandise: ' ',
};

// ============================================================================
// COMPONENT
// ============================================================================

export function RewardCard({
  reward,
  availableCredits,
  onRedeem,
  isLoading,
  className,
}: RewardCardProps) {
  const Icon = REWARD_ICONS[reward.type] || Gift;
  const canAfford = availableCredits >= reward.creditCost;
  const isAvailable = reward.available && canAfford;

  return (
    <div
      className={cn(
        'bg-panel rounded-xl border border-line overflow-hidden',
        !reward.available && 'opacity-60',
        className
      )}
    >
      {/* Header with Icon */}
      <div
        className={cn(
          'h-24 bg-inset flex items-center justify-center',
          REWARD_COLORS[reward.type]
        )}
      >
        <Icon className="w-12 h-12 text-ink-secondary" />
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-ink-primary mb-1">
          {reward.name}
        </h3>
        <p className="text-sm text-ink-secondary mb-4 line-clamp-2">
          {reward.description}
        </p>

        {/* Price & Action */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-signal-unknown" />
            <span className="font-semibold text-ink-primary">
              {formatCredits(reward.creditCost)}
            </span>
            <span className="text-sm text-ink-tertiary">credits</span>
          </div>

          {!reward.available ? (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-ink-tertiary bg-inset rounded-lg">
              <Lock size={14} />
              Unavailable
            </span>
          ) : !canAfford ? (
            <span className="text-sm text-ink-tertiary">
              Need {formatCredits(reward.creditCost - availableCredits)} more
            </span>
          ) : (
            <button
              onClick={() => onRedeem?.(reward)}
              disabled={isLoading || !isAvailable}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
                'bg-primary text-on-primary hover:bg-primary-hover',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isLoading ? 'Redeeming...' : 'Redeem'}
            </button>
          )}
        </div>

        {/* Limits */}
        {(reward.limitPerUser || reward.totalLimit) && (
          <div className="mt-3 pt-3 border-t border-line-subtle">
            <div className="flex items-center justify-between text-xs text-ink-tertiary">
              {reward.limitPerUser && (
                <span>Limit: {reward.limitPerUser} per user</span>
              )}
              {reward.totalLimit && (
                <span>
                  {reward.redeemedCount}/{reward.totalLimit} redeemed
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// REWARDS LIST COMPONENT
// ============================================================================

export interface RewardsListProps {
  rewards: Reward[];
  availableCredits: number;
  onRedeem?: (reward: Reward) => void;
  isLoading?: boolean;
  className?: string;
}

export function RewardsList({
  rewards,
  availableCredits,
  onRedeem,
  isLoading,
  className,
}: RewardsListProps) {
  if (rewards.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-ink-tertiary ',
          className
        )}
      >
        <Gift className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg">No rewards available</p>
        <p className="text-sm">Check back later for new rewards</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
        className
      )}
    >
      {rewards.map((reward) => (
        <RewardCard
          key={reward.id}
          reward={reward}
          availableCredits={availableCredits}
          onRedeem={onRedeem}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
