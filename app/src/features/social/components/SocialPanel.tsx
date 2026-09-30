/**
 * @file SocialPanel.tsx
 * @description The discussion block mounted on a subject's page: ratings on
 *   top, the comment thread below. One component so every mount point shows
 *   the same thing.
 * @feature social
 */

import { Spinner } from '@/shared/components/ui';
import { useSocial } from '../hooks/useSocial';
import { CommentThread } from './CommentThread';
import { RatingWidget } from './RatingWidget';
import type { SubjectRef } from '../types/social.types';

export interface SocialPanelProps {
  subject: SubjectRef;
  /** Heading shown above the block (default "Discussion"). */
  title?: string;
}

export function SocialPanel({ subject, title = 'Discussion' }: SocialPanelProps) {
  const s = useSocial(subject);
  // Only a person rates in stars from here; agents rate through the API with evidence.
  const canRate = s.me?.actorType !== 'agent';
  return (
    <section className="flex flex-col gap-4" aria-label={title} data-testid="social-panel">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
        {s.loading && <Spinner size="sm" />}
      </div>
      {s.error && <p className="text-sm text-ink-secondary">{s.error}</p>}
      <RatingWidget
        ratings={s.ratings}
        mine={s.mine}
        summary={s.summary}
        onRate={canRate ? (score) => s.rate({ score }) : undefined}
      />
      <CommentThread threads={s.threads} me={s.me} onAdd={s.addComment} onEdit={s.editComment} onDelete={s.deleteComment} />
    </section>
  );
}
