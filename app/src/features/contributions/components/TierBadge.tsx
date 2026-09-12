/**
 * @file TierBadge.tsx
 * @description Contributor tier badge — a neutral tag with a tier icon (token colours only)
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import { Trophy, Award, Star, Crown, Gem } from 'lucide-react';
import type { ContributorTier } from '../types/contributions.types';

export interface TierBadgeProps {
  tier: ContributorTier;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const TIER_CONFIG: Record<ContributorTier, { label: string; icon: typeof Trophy }> = {
  bronze: { label: 'Bronze', icon: Award },
  silver: { label: 'Silver', icon: Star },
  gold: { label: 'Gold', icon: Trophy },
  platinum: { label: 'Platinum', icon: Crown },
  diamond: { label: 'Diamond', icon: Gem },
};

const SIZE_CONFIG = {
  sm: { badge: 'px-1.5 py-0.5 text-xs gap-1', icon: 'h-3 w-3' },
  md: { badge: 'px-2 py-0.5 text-[13px] gap-1.5', icon: 'h-3.5 w-3.5' },
  lg: { badge: 'px-2.5 py-1 text-sm gap-1.5', icon: 'h-4 w-4' },
};

export function TierBadge({ tier, size = 'md', showLabel = true, className }: TierBadgeProps) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.bronze;
  const sizeConfig = SIZE_CONFIG[size];
  const Icon = config.icon;

  return (
    <span
      title={`${config.label} tier`}
      aria-label={showLabel ? undefined : `${config.label} tier`}
      className={cn(
        'inline-flex items-center rounded-tag border border-line bg-inset font-medium text-ink-secondary',
        sizeConfig.badge,
        className
      )}
    >
      <Icon className={sizeConfig.icon} strokeWidth={1.75} aria-hidden="true" />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
