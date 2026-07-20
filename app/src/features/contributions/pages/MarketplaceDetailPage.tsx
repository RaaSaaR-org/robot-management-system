/**
 * @file MarketplaceDetailPage.tsx
 * @description Detail page for a marketplace listing with license purchase flow
 * @feature marketplace
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Brain, Database, Cpu, TrendingUp, Download,
  CheckCircle, Shield, Play, FileText, Clock, Loader2, AlertTriangle, Star, MessageSquarePlus,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { TierBadge } from '../components/TierBadge';
import { MarketplaceStarRating } from '../components/MarketplaceStarRating';
import { MarketplaceLicenseTierSelector } from '../components/MarketplaceLicenseTierSelector';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { formatCredits } from '../types/contributions.types';
import { useMarketplaceListing } from '../hooks/marketplace';
import type { MarketplaceLicenseTier } from '../types/marketplace.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export function MarketplaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    listing,
    isLoading,
    error,
    creditBalance,
    alreadyPurchased,
    purchase,
    isPurchasing,
    purchaseError,
    submitReview,
    isSubmittingReview,
  } = useMarketplaceListing(id);

  const [selectedTier, setSelectedTier] = useState<MarketplaceLicenseTier | null>(null);
  const [justPurchased, setJustPurchased] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  // Loading skeleton
  if (!listing && isLoading) {
    return <DetailSkeleton onBack={() => navigate('/marketplace')} />;
  }

  // Not found / load error
  if (!listing) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <EmptyState
          size="lg"
          icon={<AlertTriangle className="w-8 h-8" />}
          title="Listing not found"
          description={error && error.toLowerCase() !== 'listing not found' ? error : undefined}
          action={
            <button
              type="button"
              onClick={() => navigate('/marketplace')}
              className="text-sm text-cobalt-500 dark:text-cobalt-300 hover:underline"
            >
              Back to Marketplace
            </button>
          }
        />
      </div>
    );
  }

  const isSkill = listing.type === 'skill';
  const selectedPrice = listing.priceTiers.find((t) => t.tier === selectedTier)?.priceCredits ?? 0;
  const purchased = alreadyPurchased || justPurchased;
  const balance = creditBalance ?? 0;
  const canPurchase = !!selectedTier && balance >= selectedPrice && !isPurchasing;

  const handlePurchase = async () => {
    if (!selectedTier) return;
    try {
      await purchase(selectedTier);
      setJustPurchased(true);
    } catch {
      // purchaseError is surfaced inline below the button
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/marketplace')}
        className="flex items-center gap-2 text-sm text-theme-secondary hover:text-theme-primary mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Marketplace
      </button>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left column */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <PageHeader
            title={listing.title}
            subtitle={listing.shortDescription}
            meta={
              <>
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
                {listing.isTrending && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">
                    <TrendingUp size={10} />
                    Trending
                  </span>
                )}
              </>
            }
            className="mb-4"
          />

          {/* Seller */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-theme-card border border-theme mb-6">
            <span className="w-10 h-10 rounded-full bg-theme-elevated flex items-center justify-center text-sm font-bold text-theme-secondary">
              {listing.seller.avatarInitials}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-theme-primary">{listing.seller.displayName}</span>
                <TierBadge tier={listing.seller.tier} size="sm" />
              </div>
              <div className="flex items-center gap-3 text-xs text-theme-tertiary">
                <MarketplaceStarRating rating={listing.seller.rating} size="sm" />
                <span>{listing.seller.totalSales} sales</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-theme-primary mb-2">Description</h2>
            <div className="text-sm text-theme-secondary whitespace-pre-line leading-relaxed">
              {listing.fullDescription}
            </div>
          </div>

          {/* Preview / Stats */}
          {isSkill ? (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-theme-primary mb-3">Skill Preview</h2>
              <div className="rounded-lg bg-theme-card border border-theme aspect-video flex items-center justify-center mb-4">
                <div className="text-center">
                  <Play size={40} className="mx-auto text-theme-muted mb-2" />
                  <p className="text-sm text-theme-tertiary">Demo video coming soon</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Success Rate" value={`${listing.successRate ?? 0}%`} />
                <StatCard label="Adapter Size" value={`${listing.adapterSizeMB ?? 0} MB`} />
                <StatCard label="Robot Type" value={listing.robotType} />
                <StatCard label="Base Model" value={listing.baseModel} />
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-theme-primary mb-3">Dataset Info</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Episodes" value={(listing.episodeCount ?? 0).toLocaleString(UI_DATE_LOCALE)} />
                <StatCard label="Frames" value={(listing.frameCount ?? 0).toLocaleString(UI_DATE_LOCALE)} />
                <StatCard label="Size" value={`${listing.datasetSizeGB ?? 0} GB`} />
                <StatCard label="Collection" value={listing.collectionMethod ?? 'N/A'} />
              </div>
            </div>
          )}

          {/* Tags */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-theme-primary mb-2">Tags</h2>
            <div className="flex flex-wrap gap-2">
              {listing.tags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 rounded-full bg-theme-elevated text-xs text-theme-secondary border border-theme">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Technical Specs */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-theme-primary mb-3">Technical Specs</h2>
            <div className="rounded-lg border border-theme overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  <SpecRow label="Type" value={isSkill ? 'LoRA Adapter (.safetensors)' : 'Dataset (LeRobot v3)'} />
                  <SpecRow label="Robot" value={listing.robotType} />
                  {listing.baseModel !== 'None' && <SpecRow label="Base Model" value={listing.baseModel} />}
                  <SpecRow label="Downloads" value={listing.downloadCount.toLocaleString(UI_DATE_LOCALE)} />
                  <SpecRow label="Published" value={formatDate(listing.createdAt)} />
                </tbody>
              </table>
            </div>
          </div>

          {/* Write a review */}
          {purchased && !hasReviewed && (
            <ReviewForm
              isSubmitting={isSubmittingReview}
              onSubmit={async (rating, body) => {
                await submitReview({ rating, body, robotType: listing.robotType });
                setHasReviewed(true);
              }}
            />
          )}

          {/* Reviews */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-theme-primary mb-3">
              Reviews ({listing.reviewCount})
            </h2>
            <div className="space-y-3">
              {listing.reviews.map((review) => (
                <div key={review.id} className="p-4 rounded-lg bg-theme-card border border-theme">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-theme-primary">{review.authorName}</span>
                      <TierBadge tier={review.authorTier} size="sm" showLabel={false} />
                      <span className="text-xs text-theme-tertiary flex items-center gap-1">
                        <Cpu size={10} />
                        {review.robotType}
                      </span>
                    </div>
                    <span className="text-xs text-theme-tertiary flex items-center gap-1">
                      <Clock size={10} />
                      {formatDate(review.createdAt)}
                    </span>
                  </div>
                  <MarketplaceStarRating rating={review.rating} size="sm" className="mb-2" />
                  <p className="text-sm text-theme-secondary">{review.body}</p>
                </div>
              ))}
              {listing.reviews.length === 0 && (
                <div className="p-4 rounded-lg bg-theme-card border border-theme text-sm text-theme-tertiary">
                  No reviews yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-full lg:w-80 shrink-0">
          <div className="lg:sticky lg:top-6 rounded-xl bg-theme-card border border-theme p-5">
            {purchased ? (
              <div className="text-center py-4">
                <CheckCircle size={40} className="mx-auto text-emerald-400 mb-3" />
                <h3 className="text-lg font-semibold text-theme-primary mb-1">
                  {justPurchased ? 'Purchase Complete!' : 'Already Purchased'}
                </h3>
                <p className="text-sm text-theme-secondary mb-4">
                  {justPurchased
                    ? 'Your download is ready.'
                    : 'You already own a license for this item.'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowDownloadModal(true)}
                  className="w-full py-2.5 rounded-brand bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Download size={16} />
                  Download {isSkill ? 'Adapter' : 'Dataset'}
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-base font-semibold text-theme-primary mb-4">Purchase License</h3>

                <MarketplaceLicenseTierSelector
                  tiers={listing.priceTiers}
                  selected={selectedTier}
                  onChange={setSelectedTier}
                  userCredits={balance}
                />

                <button
                  type="button"
                  disabled={!canPurchase}
                  onClick={handlePurchase}
                  className={cn(
                    'w-full mt-4 py-2.5 rounded-brand text-sm font-medium transition-colors flex items-center justify-center gap-2',
                    canPurchase
                      ? 'bg-cobalt-500 text-white hover:bg-cobalt-600'
                      : 'bg-theme-elevated text-theme-muted cursor-not-allowed'
                  )}
                >
                  {isPurchasing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Processing purchase...
                    </>
                  ) : (
                    <>
                      <FileText size={16} />
                      {selectedTier
                        ? `Purchase — ${formatCredits(selectedPrice)} credits`
                        : 'Select a license tier'}
                    </>
                  )}
                </button>

                {purchaseError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                    <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-400">{purchaseError}</p>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-theme">
                  <div className="flex items-center justify-between text-xs text-theme-tertiary mb-3">
                    <span>Your balance</span>
                    <span className="text-theme-primary font-medium">{formatCredits(balance)} credits</span>
                  </div>
                </div>
              </>
            )}

            {/* Sovereignty note */}
            <div className="mt-4 p-3 rounded-lg bg-cobalt-500/5 border border-cobalt-500/20">
              <div className="flex items-start gap-2">
                <Shield size={14} className="text-cobalt-500 dark:text-cobalt-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-cobalt-500 dark:text-cobalt-300 mb-0.5">Data Sovereignty</p>
                  <p className="text-xs text-theme-secondary">
                    Files are downloaded to your infrastructure. No cloud dependency, no phone-home. Run on your own hardware.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Download Modal */}
      <MarketplaceDownloadModal
        listing={listing}
        open={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
      />
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(UI_DATE_LOCALE);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-theme-card border border-theme">
      <p className="text-xs text-theme-tertiary mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-theme-primary">{value}</p>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-theme last:border-0">
      <td className="px-4 py-2.5 text-theme-tertiary font-medium">{label}</td>
      <td className="px-4 py-2.5 text-theme-primary text-right">{value}</td>
    </tr>
  );
}

// ============================================================================
// REVIEW FORM
// ============================================================================

interface ReviewFormProps {
  isSubmitting: boolean;
  onSubmit: (rating: number, body: string) => Promise<void>;
}

function ReviewForm({ isSubmitting, onSubmit }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="mb-6 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2">
        <CheckCircle size={16} className="text-emerald-400 shrink-0" />
        <p className="text-sm text-emerald-400">Thanks — your review has been published.</p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (rating < 1) {
      setFormError('Please select a star rating.');
      return;
    }
    if (!body.trim()) {
      setFormError('Please write a few words about your experience.');
      return;
    }
    setFormError(null);
    try {
      await onSubmit(rating, body.trim());
      setSubmitted(true);
    } catch (error) {
      // Surface server-side rejections gracefully (e.g. "You already reviewed this listing")
      setFormError(error instanceof Error ? error.message : 'Failed to submit review');
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="mb-6 p-4 rounded-lg bg-theme-card border border-theme">
      <h2 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
        <MessageSquarePlus size={14} className="text-cobalt-500 dark:text-cobalt-300" />
        Write a review
      </h2>
      <div className="flex items-center gap-1 mb-3" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            className="p-0.5"
          >
            <Star
              size={20}
              className={cn(
                'transition-colors',
                star <= displayRating
                  ? 'text-cobalt-500 dark:text-cobalt-300 fill-current'
                  : 'text-theme-muted'
              )}
            />
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="How did this perform on your robot?"
        className="w-full px-3 py-2 rounded-brand bg-theme-elevated border border-theme text-sm text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:border-cobalt-500/50 resize-none mb-3"
      />
      {formError && (
        <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
          <AlertTriangle size={13} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400">{formError}</p>
        </div>
      )}
      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleSubmit}
        className={cn(
          'px-4 py-2 rounded-brand text-sm font-medium transition-colors flex items-center gap-2',
          isSubmitting
            ? 'bg-theme-elevated text-theme-muted cursor-not-allowed'
            : 'bg-cobalt-500 text-white hover:bg-cobalt-600'
        )}
      >
        {isSubmitting && <Loader2 size={14} className="animate-spin" />}
        {isSubmitting ? 'Submitting...' : 'Submit review'}
      </button>
    </div>
  );
}

// ============================================================================
// LOADING SKELETON
// ============================================================================

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-theme-secondary hover:text-theme-primary mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Marketplace
      </button>
      <div className="flex flex-col lg:flex-row gap-8 animate-pulse" aria-busy="true" aria-label="Loading listing">
        <div className="flex-1 min-w-0">
          <div className="h-5 w-20 rounded-full bg-theme-elevated mb-4" />
          <div className="h-7 w-2/3 rounded bg-theme-elevated mb-3" />
          <div className="h-4 w-full rounded bg-theme-elevated mb-6" />
          <div className="h-16 rounded-lg bg-theme-card border border-theme mb-6" />
          <div className="space-y-2 mb-6">
            <div className="h-3 w-full rounded bg-theme-elevated" />
            <div className="h-3 w-5/6 rounded bg-theme-elevated" />
            <div className="h-3 w-4/6 rounded bg-theme-elevated" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-theme-card border border-theme" />
            ))}
          </div>
          <div className="h-40 rounded-lg bg-theme-card border border-theme" />
        </div>
        <div className="w-full lg:w-80 shrink-0">
          <div className="rounded-xl bg-theme-card border border-theme p-5">
            <div className="h-5 w-32 rounded bg-theme-elevated mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg bg-theme-elevated border border-theme" />
              ))}
            </div>
            <div className="h-10 rounded-brand bg-cobalt-500/20 mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
