/**
 * @file ActorBadge.tsx
 * @description Avatar + name for a comment or rating author. Agents and the
 *   system get a visibly different avatar from people.
 * @feature social
 */

import { Bot, Cog, User } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ACTOR_LABEL } from '../utils/social';
import type { Actor } from '../types/social.types';

const AVATAR: Record<Actor['actorType'], { icon: typeof User; className: string }> = {
  user: { icon: User, className: 'rounded-full bg-inset text-ink-secondary' },
  agent: { icon: Bot, className: 'rounded-md bg-primary/15 text-primary' },
  system: { icon: Cog, className: 'rounded-md bg-inset text-ink-muted' },
};

export function ActorBadge({ actor, meta }: { actor: Actor; meta?: string }) {
  const { icon: Icon, className } = AVATAR[actor.actorType];
  return (
    <span className="inline-flex items-center gap-2" data-actor-type={actor.actorType}>
      <span className={cn('inline-flex h-6 w-6 items-center justify-center', className)} title={ACTOR_LABEL[actor.actorType]}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="text-sm font-medium text-ink-primary">{actor.displayName}</span>
      {actor.actorType !== 'user' && <span className="text-xs text-ink-muted">{ACTOR_LABEL[actor.actorType]}</span>}
      {meta && <span className="text-xs text-ink-muted">{meta}</span>}
    </span>
  );
}
