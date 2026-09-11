/**
 * @file MarketplaceStarRating.tsx
 * @description Star rating display (read-only) in token colours
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

const SIZE_CLASS = { sm: 'h-3 w-3', md: 'h-4 w-4' };

export function MarketplaceStarRating({
  rating,
  size = 'sm',
  showNumber = true,
  className,
}: MarketplaceStarRatingProps) {
  const filled = Math.round(rating);

  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      aria-label={`Rated ${rating.toFixed(1)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(SIZE_CLASS[size], i <= filled ? 'fill-current text-primary' : 'text-ink-muted')}
        />
      ))}
      {showNumber && (
        <span
          className={cn(
            'ml-1 font-medium tabular-nums text-ink-secondary',
            size === 'sm' ? 'text-xs' : 'text-sm'
          )}
        >
          {rating.toFixed(1)}
        </span>
      )}
    </span>
  );
}
