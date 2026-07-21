/**
 * @file MarketplaceListingCard.tsx
 * @description Marketplace listing card for the browse grid
 * @feature marketplace
 */

import { cn } from '@/shared/utils/cn';
import { Download, TrendingUp, Brain, Database, Cpu } from 'lucide-react';
import { TierBadge } from './TierBadge';
import { MarketplaceStarRating } from './MarketplaceStarRating';
import { formatCredits } from '../types/contributions.types';
import type { MarketplaceListing } from '../types/marketplace.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface MarketplaceListingCardProps {
  listing: MarketplaceListing;
  onClick: () => void;
}

export function MarketplaceListingCard({ listing, onClick }: MarketplaceListingCardProps) {
  const isSkill = listing.type === 'skill';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border transition-all duration-200',
        'bg-theme-card border-theme hover:border-cobalt-500/50',
        'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-cobalt-500/5',
        'flex flex-col'
      )}
    >
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
              isSkill
                ? 'bg-cobalt-500/10 text-cobalt-500 dark:text-cobalt-300'
                : 'bg-teal-500/15 text-teal-400'
            )}
          >
            {isSkill ? <Brain size={12} /> : <Database size={12} />}
            {isSkill ? 'Skill' : 'Dataset'}
          </span>
          <div className="flex items-center gap-1.5">
            {listing.isTrending && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">
                <TrendingUp size={10} />
                Trending
              </span>
            )}
          </div>
        </div>

        {/* Title & Description */}
        <h3 className="text-sm font-semibold text-theme-primary line-clamp-2 mb-1.5">
          {listing.title}
        </h3>
        <p className="text-xs text-theme-secondary line-clamp-2 mb-3">
          {listing.shortDescription}
        </p>

        {/* Tags */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-theme-elevated text-xs text-theme-secondary">
            <Cpu size={10} />
            {listing.robotType}
          </span>
          {listing.baseModel !== 'None' && (
            <span className="px-2 py-0.5 rounded bg-theme-elevated text-xs text-theme-secondary">
              {listing.baseModel}
            </span>
          )}
          {isSkill && listing.successRate && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-xs text-emerald-400">
              {listing.successRate}% success
            </span>
          )}
          {!isSkill && listing.episodeCount && (
            <span className="px-2 py-0.5 rounded bg-theme-elevated text-xs text-theme-secondary">
              {listing.episodeCount} episodes
            </span>
          )}
        </div>
      </div>

      {/* Rating & Downloads */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-3 text-xs text-theme-secondary">
          <MarketplaceStarRating rating={listing.rating} size="sm" />
          <span>({listing.reviewCount})</span>
          <span className="inline-flex items-center gap-1">
            <Download size={10} />
            {listing.downloadCount.toLocaleString(UI_DATE_LOCALE)}
          </span>
        </div>
      </div>

      {/* Seller */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-theme-elevated flex items-center justify-center text-[10px] font-bold text-theme-secondary">
            {listing.seller.avatarInitials}
          </span>
          <span className="text-xs text-theme-secondary truncate">{listing.seller.displayName}</span>
          <TierBadge tier={listing.seller.tier} size="sm" showLabel={false} />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto px-4 py-3 border-t border-theme flex items-center justify-between">
        <div>
          <span className="text-xs text-theme-tertiary">from</span>{' '}
          <span className="text-sm font-bold text-theme-primary">{formatCredits(listing.lowestPriceCredits)}</span>{' '}
          <span className="text-xs text-theme-tertiary">credits</span>
        </div>
        <span className="px-3 py-1.5 rounded-brand bg-cobalt-500 text-white text-xs font-medium hover:bg-cobalt-600 transition-colors">
          View
        </span>
      </div>
    </button>
  );
}
