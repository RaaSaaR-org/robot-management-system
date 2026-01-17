/**
 * @file TierBadge.tsx
 * @description Contributor tier badge component
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import { Trophy, Award, Star, Crown, Gem } from 'lucide-react';
import type { ContributorTier } from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface TierBadgeProps {
  tier: ContributorTier;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TIER_CONFIG: Record<
  ContributorTier,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: typeof Trophy;
  }
> = {
  bronze: {
    label: 'Bronze',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: Award,
  },
  silver: {
    label: 'Silver',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    icon: Star,
  },
  gold: {
    label: 'Gold',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    icon: Trophy,
  },
  platinum: {
    label: 'Platinum',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    icon: Crown,
  },
  diamond: {
    label: 'Diamond',
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: Gem,
  },
};

const SIZE_CONFIG = {
  sm: {
    badge: 'px-2 py-0.5 text-xs gap-1',
    icon: 12,
  },
  md: {
    badge: 'px-2.5 py-1 text-sm gap-1.5',
    icon: 14,
  },
  lg: {
    badge: 'px-3 py-1.5 text-base gap-2',
    icon: 18,
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function TierBadge({
  tier,
  size = 'md',
  showLabel = true,
  className,
}: TierBadgeProps) {
  const config = TIER_CONFIG[tier];
  const sizeConfig = SIZE_CONFIG[size];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        config.bgColor,
        config.color,
        sizeConfig.badge,
        className
      )}
    >
      <Icon size={sizeConfig.icon} />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
