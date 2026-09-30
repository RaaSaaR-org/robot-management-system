/**
 * @file RatingWidget.tsx
 * @description Ratings for one subject: the viewer's own stars, the human and
 *   agent means side by side, and every rating — stars for a person, a
 *   read-only percentage plus evidence for an agent.
 * @feature social
 */

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { toast, errorMessage } from '@/shared/components/ui';
import { ActorBadge } from './ActorBadge';
import { EvidenceChips } from './EvidenceChips';
import { dimensionLabel, formatPercent, scoreToStars, starsToScore } from '../utils/social';
import type { RatingDTO, RatingSummary } from '../types/social.types';

/** Five stars, optionally clickable. */
export function Stars({ value, onChange, label }: { value: number; onChange?: (stars: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center" role={onChange ? 'radiogroup' : 'img'} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const icon = <Star className={cn('h-4 w-4', filled ? 'fill-current text-primary' : 'text-ink-muted')} aria-hidden />;
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className="p-0.5"
            onClick={() => onChange(n)}
          >
            {icon}
          </button>
        ) : (
          <span key={n} className="p-0.5">
            {icon}
          </span>
        );
      })}
    </span>
  );
}

/** How one rating reads: stars for a person, a percentage for a machine. */
export function RatingValue({ rating }: { rating: Pick<RatingDTO, 'actorType' | 'score'> }) {
  if (rating.actorType === 'user') {
    return <Stars value={scoreToStars(rating.score)} label={`${scoreToStars(rating.score)} of 5 stars`} />;
  }
  return (
    <span className="text-sm font-semibold tabular-nums text-ink-primary" data-testid="rating-percent">
      {formatPercent(rating.score)}
    </span>
  );
}

function DimensionBars({ dimensions }: { dimensions: Record<string, number> }) {
  const entries = Object.entries(dimensions);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
      {entries.map(([key, v]) => (
        <div key={key} className="contents">
          <dt className="text-xs text-ink-secondary">{dimensionLabel(key)}</dt>
          <dd className="h-1.5 rounded-full bg-inset" aria-hidden>
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(v * 100)}%` }} />
          </dd>
          <dd className="text-xs tabular-nums text-ink-muted">{formatPercent(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mean({ label, agg, asStars }: { label: string; agg: { count: number; mean: number | null }; asStars: boolean }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={`mean-${label.toLowerCase()}`}>
      <span className="text-xs text-ink-muted">{label}</span>
      {agg.mean === null ? (
        <span className="text-sm text-ink-tertiary">No ratings</span>
      ) : (
        <span className="flex items-center gap-2 text-sm text-ink-primary">
          {asStars ? <Stars value={scoreToStars(agg.mean)} label={`${label} mean`} /> : formatPercent(agg.mean)}
          <span className="text-xs text-ink-muted">({agg.count})</span>
        </span>
      )}
    </div>
  );
}

export interface RatingWidgetProps {
  ratings: RatingDTO[];
  mine: RatingDTO | null;
  summary: RatingSummary | null;
  /** Omit to render read-only (e.g. the viewer is not a person). */
  onRate?: (score: number) => Promise<void>;
}

export function RatingWidget({ ratings, mine, summary, onRate }: RatingWidgetProps) {
  const [saving, setSaving] = useState(false);
  const rate = async (stars: number) => {
    if (!onRate) return;
    setSaving(true);
    try {
      await onRate(starsToScore(stars));
    } catch (err) {
      toast.error("Couldn't save the rating", { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="rating-widget">
      <div className="flex flex-wrap items-start gap-6">
        {onRate && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-ink-muted">Your rating</span>
            <span className={cn(saving && 'opacity-60')}>
              <Stars value={mine ? scoreToStars(mine.score) : 0} onChange={(n) => void rate(n)} label="Your rating" />
            </span>
          </div>
        )}
        {summary && (
          <>
            <Mean label="People" agg={summary.byActorType.user} asStars />
            <Mean label="Agents" agg={summary.byActorType.agent} asStars={false} />
            {/* Only when present — the AUTH_DISABLED dev actor rates as `system`. */}
            {summary.byActorType.system.count > 0 && <Mean label="System" agg={summary.byActorType.system} asStars={false} />}
          </>
        )}
      </div>
      {ratings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ratings.map((r) => (
            <li key={r.id} className="flex flex-col gap-1.5 rounded-md border border-line-subtle p-2" data-testid="rating-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ActorBadge actor={r} />
                <RatingValue rating={r} />
              </div>
              {r.comment && <p className="text-sm text-ink-secondary">{r.comment}</p>}
              <DimensionBars dimensions={r.dimensions} />
              <EvidenceChips evidence={r.evidence} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
