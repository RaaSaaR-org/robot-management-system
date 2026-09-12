/**
 * @file MarketplaceDetailPage.tsx
 * @description Marketplace listing detail: description, specs, reviews and the license purchase
 * @feature marketplace
 */

import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, ShoppingCart } from 'lucide-react';
import {
  Badge, Button, ErrorState, KeyValueList, PageHeader, Panel, SkeletonText, confirm, toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { TierBadge } from '../components/TierBadge';
import { MarketplaceStarRating } from '../components/MarketplaceStarRating';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { MarketplaceLicensePanel } from '../components/MarketplaceLicensePanel';
import { MarketplaceReviewsPanel } from '../components/MarketplaceReviewsPanel';
import { formatMarketplaceDate, listingTypeLabel } from '../components/marketplaceUi';
import { formatCredits } from '../types/contributions.types';
import { useMarketplaceListing } from '../hooks/marketplace';
import { LICENSE_TIER_LABELS, type MarketplaceLicenseTier } from '../types/marketplace.types';

const BACK = { to: '/marketplace', label: 'Marketplace' };

export function MarketplaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const {
    listing, isLoading, error, creditBalance, alreadyPurchased, purchase, isPurchasing,
    submitReview, isSubmittingReview, refetch,
  } = useMarketplaceListing(id);

  const [selectedTier, setSelectedTier] = useState<MarketplaceLicenseTier | null>(null);
  const [justPurchased, setJustPurchased] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const licenseRef = useRef<HTMLDivElement>(null);

  if (!listing && isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" back={BACK} title="Loading…" />
        <Panel><SkeletonText lines={4} /></Panel>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" back={BACK} title="Listing not found" />
        <Panel>
          <ErrorState
            title="Couldn't load this listing"
            message={error ?? 'It may have been removed, or the link is wrong.'}
            onRetry={() => void refetch()}
          />
        </Panel>
      </div>
    );
  }

  const isSkill = listing.type === 'skill';
  const owned = alreadyPurchased || justPurchased;
  const balance = creditBalance ?? 0;

  const focusLicense = () => {
    licenseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    licenseRef.current?.focus({ preventScroll: true });
  };

  const handlePurchase = async () => {
    const tier = listing.priceTiers.find((t) => t.tier === selectedTier);
    if (!tier) return;
    const ok = await confirm({
      title: `Purchase ${LICENSE_TIER_LABELS[tier.tier]} license?`,
      description: `${formatCredits(tier.priceCredits)} credits are deducted from your balance of ${formatCredits(balance)}.`,
      confirmLabel: 'Purchase license',
    });
    if (!ok) return;
    try {
      await purchase(tier.tier);
      setJustPurchased(true);
      toast.success('License purchased', { description: `${listing.title} · ${LICENSE_TIER_LABELS[tier.tier]}` });
    } catch (err) {
      const message = getErrorMessage(err);
      if (/insufficient credits/i.test(message)) {
        const missing = Math.max(tier.priceCredits - (creditBalance ?? 0), 0);
        toast.error('Not enough credits', {
          description: missing > 0 ? `You need ${formatCredits(missing)} more credits for this license.` : message,
        });
      } else {
        toast.error("Couldn't purchase license", { description: message });
      }
    }
  };

  const specs = [
    { label: 'Artifact', value: isSkill ? 'LoRA adapter (.safetensors)' : 'Dataset (LeRobot v3)' },
    { label: 'Robot', value: listing.robotType },
    { label: 'Base model', value: listing.baseModel !== 'None' ? listing.baseModel : undefined },
    ...(isSkill
      ? [
          { label: 'Task category', value: listing.taskCategory },
          { label: 'Success rate', value: listing.successRate != null ? `${listing.successRate}%` : undefined },
          { label: 'Adapter size', value: listing.adapterSizeMB != null ? `${listing.adapterSizeMB} MB` : undefined },
        ]
      : []),
    { label: 'Downloads', value: listing.downloadCount.toLocaleString(UI_DATE_LOCALE) },
    { label: 'Published', value: formatMarketplaceDate(listing.createdAt) },
    { label: 'Listing ID', value: listing.id, mono: true },
  ];

  const datasetSpecs = [
    { label: 'Episodes', value: listing.episodeCount?.toLocaleString(UI_DATE_LOCALE) },
    { label: 'Frames', value: listing.frameCount?.toLocaleString(UI_DATE_LOCALE) },
    { label: 'Size', value: listing.datasetSizeGB != null ? `${listing.datasetSizeGB} GB` : undefined },
    { label: 'Collection method', value: listing.collectionMethod },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        back={BACK}
        title={listing.title}
        description={`${listing.seller.displayName} · ${listingTypeLabel(listing)}`}
        meta={
          <>
            <Badge variant={isSkill ? 'info' : 'neutral'} size="sm">{listingTypeLabel(listing)}</Badge>
            {listing.isFeatured && <Badge variant="accent" size="sm">Featured</Badge>}
            {listing.isTrending && <Badge variant="accent" size="sm">Trending</Badge>}
            <TierBadge tier={listing.seller.tier} size="sm" />
            <MarketplaceStarRating rating={listing.rating} />
          </>
        }
        actions={
          owned ? (
            <Button leftIcon={<Download className="h-4 w-4" />} onClick={() => setDownloadOpen(true)}>Download</Button>
          ) : (
            <Button leftIcon={<ShoppingCart className="h-4 w-4" />} onClick={focusLicense}>Get license</Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Panel>
            <Panel.Header title="Description" />
            <Panel.Body className="flex flex-col gap-4">
              <p className="max-w-[70ch] whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                {listing.fullDescription || listing.shortDescription}
              </p>
              {listing.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {listing.tags.map((tag) => (
                    <span key={tag} className="rounded-tag border border-line-subtle bg-inset px-1.5 py-0.5 text-xs text-ink-secondary">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Panel.Body>
          </Panel>

          <Panel>
            <Panel.Header title="Technical specs" />
            <Panel.Body><KeyValueList items={specs} /></Panel.Body>
          </Panel>

          {!isSkill && (
            <Panel>
              <Panel.Header title="Dataset" />
              <Panel.Body><KeyValueList items={datasetSpecs} /></Panel.Body>
            </Panel>
          )}

          <MarketplaceReviewsPanel
            reviews={listing.reviews}
            reviewCount={listing.reviewCount}
            canReview={owned && !hasReviewed}
            isSubmitting={isSubmittingReview}
            onSubmit={async (rating, body) => {
              await submitReview({ rating, body, robotType: listing.robotType });
              setHasReviewed(true);
            }}
          />
        </div>

        <div className="order-first flex flex-col gap-6 xl:order-none">
          <MarketplaceLicensePanel
            ref={licenseRef}
            tiers={listing.priceTiers}
            selectedTier={selectedTier}
            onSelectTier={setSelectedTier}
            balance={balance}
            owned={owned}
            isPurchasing={isPurchasing}
            onPurchase={() => void handlePurchase()}
            onDownload={() => setDownloadOpen(true)}
          />
          <Panel>
            <Panel.Header title="Data sovereignty" />
            <Panel.Body>
              <p className="text-sm text-ink-secondary">
                Files download to your own infrastructure. No cloud dependency, no phone-home: they run on your hardware.
              </p>
            </Panel.Body>
          </Panel>
        </div>
      </div>

      <MarketplaceDownloadModal listing={listing} open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </div>
  );
}
