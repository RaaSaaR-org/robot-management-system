/**
 * @file MarketplaceListingCard.tsx
 * @description Marketplace listing card for the browse grid — the whole card opens the listing
 * @feature marketplace
 */

import { Brain, Database, Download } from 'lucide-react';
import { Badge, Panel } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { TierBadge } from './TierBadge';
import { MarketplaceStarRating } from './MarketplaceStarRating';
import { listingTypeLabel } from './marketplaceUi';
import { formatCredits } from '../types/contributions.types';
import type { MarketplaceListing } from '../types/marketplace.types';

export interface MarketplaceListingCardProps {
  listing: MarketplaceListing;
  onClick: () => void;
}

const chip = 'rounded-tag border border-line-subtle bg-inset px-1.5 py-0.5 text-xs text-ink-secondary';

export function MarketplaceListingCard({ listing, onClick }: MarketplaceListingCardProps) {
  const isSkill = listing.type === 'skill';
  const TypeIcon = isSkill ? Brain : Database;

  return (
    <Panel
      as="article"
      interactive
      onClick={onClick}
      padding="none"
      aria-label={`${listing.title}, ${listingTypeLabel(listing)}`}
      className="flex h-full flex-col"
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={isSkill ? 'info' : 'neutral'} size="sm">
            <TypeIcon className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
            {listingTypeLabel(listing)}
          </Badge>
          {listing.isFeatured && <Badge variant="accent" size="sm">Featured</Badge>}
          {listing.isTrending && <Badge variant="accent" size="sm">Trending</Badge>}
        </div>

        <div className="min-w-0">
          <h3 className="line-clamp-2 font-display text-base font-semibold tracking-[-0.01em] text-ink-primary">
            {listing.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-[13px] text-ink-secondary">{listing.shortDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={chip}>{listing.robotType}</span>
          {listing.baseModel !== 'None' && <span className={chip}>{listing.baseModel}</span>}
          {isSkill && listing.successRate != null && (
            <span className="text-xs text-ink-tertiary">{listing.successRate}% success</span>
          )}
          {!isSkill && listing.episodeCount != null && (
            <span className="text-xs text-ink-tertiary">
              {listing.episodeCount.toLocaleString(UI_DATE_LOCALE)} episodes
            </span>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-tertiary">
          <MarketplaceStarRating rating={listing.rating} size="sm" />
          <span>({listing.reviewCount})</span>
          <span className="inline-flex items-center gap-1">
            <Download className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
            {listing.downloadCount.toLocaleString(UI_DATE_LOCALE)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] text-ink-secondary">{listing.seller.displayName}</span>
          <TierBadge tier={listing.seller.tier} size="sm" showLabel={false} />
        </span>
        <span className="shrink-0 text-[13px] text-ink-tertiary">
          from{' '}
          <span className="font-semibold tabular-nums text-ink-primary">
            {formatCredits(listing.lowestPriceCredits)}
          </span>{' '}
          credits
        </span>
      </div>
    </Panel>
  );
}
