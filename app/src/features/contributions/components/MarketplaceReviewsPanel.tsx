/**
 * @file MarketplaceReviewsPanel.tsx
 * @description Reviews of a listing plus the review form for license holders
 * @feature marketplace
 */

import { useState } from 'react';
import { MessageSquare, Star } from 'lucide-react';
import { Button, EmptyState, FormField, Panel, Textarea, toast } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { getErrorMessage } from '@/shared/utils';
import { formatTimeAgo } from '@/shared/utils/format';
import { MarketplaceStarRating } from './MarketplaceStarRating';
import { TierBadge } from './TierBadge';
import type { MarketplaceReview } from '../types/marketplace.types';

export interface MarketplaceReviewsPanelProps {
  reviews: MarketplaceReview[];
  reviewCount: number;
  /** Show the review form (the user holds a license and has not reviewed yet) */
  canReview: boolean;
  isSubmitting: boolean;
  onSubmit: (rating: number, body: string) => Promise<void>;
}

export function MarketplaceReviewsPanel({
  reviews, reviewCount, canReview, isSubmitting, onSubmit,
}: MarketplaceReviewsPanelProps) {
  return (
    <Panel>
      <Panel.Header title="Reviews" description={`${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}`} />
      <Panel.Body className="flex flex-col gap-4">
        {canReview && <ReviewForm isSubmitting={isSubmitting} onSubmit={onSubmit} />}
        {reviews.length === 0 ? (
          <EmptyState size="sm" icon={<MessageSquare />} title="No reviews yet" description="License holders can rate a listing after using it." />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-primary">{review.authorName}</span>
                  <TierBadge tier={review.authorTier} size="sm" showLabel={false} />
                  <span className="text-[13px] text-ink-tertiary">{review.robotType}</span>
                  <span className="ml-auto text-[13px] text-ink-tertiary">{formatTimeAgo(review.createdAt)}</span>
                </div>
                <MarketplaceStarRating rating={review.rating} showNumber={false} />
                <p className="max-w-[70ch] text-sm text-ink-secondary">{review.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
}

function ReviewForm({ isSubmitting, onSubmit }: Pick<MarketplaceReviewsPanelProps, 'isSubmitting' | 'onSubmit'>) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [ratingError, setRatingError] = useState<string>();
  const [bodyError, setBodyError] = useState<string>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const rErr = rating < 1 ? 'Pick a star rating.' : undefined;
    const bErr = body.trim() ? undefined : 'Write a few words about how it performed.';
    setRatingError(rErr); setBodyError(bErr);
    if (rErr || bErr) return;
    try {
      await onSubmit(rating, body.trim());
      toast.success('Review submitted');
    } catch (err) {
      toast.error("Couldn't submit review", { description: getErrorMessage(err) });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-control border border-line-subtle bg-inset p-4">
      <FormField label="Your rating" required error={ratingError}>
        <div role="radiogroup" aria-label="Rating" className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} star${star > 1 ? 's' : ''}`}
              onClick={() => setRating(star)}
              className="rounded-tag p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Star
                strokeWidth={1.75}
                className={cn('h-5 w-5 transition-colors', star <= rating ? 'fill-current text-primary' : 'text-ink-muted')}
              />
            </button>
          ))}
        </div>
      </FormField>
      <FormField label="Review" required error={bodyError}>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="How did it perform on your robot?" />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" isLoading={isSubmitting} loadingText="Submitting…">Submit review</Button>
      </div>
    </form>
  );
}
