/**
 * @file MarketplaceStarRating.tsx
 * @description Star rating display component
 * @feature marketplace
 */

import { Star } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface MarketplaceStarRatingProps {
  rating: number;
  size?: 'sm' | 'md';
  showNumber?: boolean;
  className?: string;
}

const SIZE_MAP = { sm: 12, md: 16 };

export function MarketplaceStarRating({
  rating,
  size = 'sm',
  showNumber = true,
  className,
}: MarketplaceStarRatingProps) {
  const filled = Math.round(rating);
  const iconSize = SIZE_MAP[size];

  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={iconSize}
          className={cn(
            i <= filled
              ? 'text-[#FF6700] fill-[#FF6700]'
              : 'text-gray-400 dark:text-gray-600'
          )}
        />
      ))}
      {showNumber && (
        <span className={cn(
          'ml-1 font-medium text-gray-700 dark:text-gray-300',
          size === 'sm' ? 'text-xs' : 'text-sm'
        )}>
          {rating.toFixed(1)}
        </span>
      )}
    </span>
  );
}
