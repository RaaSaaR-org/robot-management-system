/**
 * @file ActivityFeed.tsx
 * @description Reverse-chronological comments and ratings across every
 *   subject — how a person catches up on what the agents did overnight.
 * @feature social
 */

import { Link } from 'react-router-dom';
import { SegmentedControl, Spinner } from '@/shared/components/ui';
import { useState } from 'react';
import { useActivityFeed } from '../hooks/useSocial';
import { ActorBadge } from './ActorBadge';
import { EvidenceChips } from './EvidenceChips';
import { RatingValue } from './RatingWidget';
import { SUBJECT_LABEL, subjectLink } from '../utils/social';
import type { ActorType } from '../types/social.types';

type Filter = 'all' | ActorType;

export function ActivityFeed({ limit = 50 }: { limit?: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const { items, loading, error } = useActivityFeed({ actorType: filter === 'all' ? undefined : filter, limit });
  return (
    <section className="flex flex-col gap-3" aria-label="Activity" data-testid="activity-feed">
      <div className="flex items-center gap-3">
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'user', label: 'People' },
            { value: 'agent', label: 'Agents' },
          ]}
        />
        {loading && <Spinner size="sm" />}
      </div>
      {error && <p className="text-sm text-ink-secondary">{error}</p>}
      {!loading && items.length === 0 && <p className="text-sm text-ink-tertiary">No activity yet.</p>}
      <ul className="flex flex-col gap-3">
        {items.map((it) => (
          <li key={`${it.kind}-${it.id}`} className="flex flex-col gap-1.5 border-b border-line-subtle pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <ActorBadge actor={it} meta={new Date(it.at).toLocaleString()} />
              <span className="text-xs text-ink-muted">{it.kind === 'rating' ? 'rated' : 'commented on'}</span>
              <Link to={subjectLink(it)} className="text-xs text-primary hover:underline">
                {SUBJECT_LABEL[it.subjectType]}
                {it.episodeIndex !== null ? ` #${it.episodeIndex}` : ''}
              </Link>
              {it.score !== null && <RatingValue rating={{ actorType: it.actorType, score: it.score }} />}
            </div>
            {it.text && <p className="text-sm text-ink-secondary">{it.text}</p>}
            <EvidenceChips evidence={it.evidence} />
          </li>
        ))}
      </ul>
    </section>
  );
}
