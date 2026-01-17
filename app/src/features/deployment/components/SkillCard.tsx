/**
 * @file SkillCard.tsx
 * @description Card component for displaying skill summary
 * @feature deployment
 */

import { Card, Badge } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type { SkillDefinition } from '../types';
import { SkillStatusBadge } from './SkillStatusBadge';

export interface SkillCardProps {
  skill: SkillDefinition;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
  className?: string;
}

export function SkillCard({
  skill,
  onClick,
  selected,
  compact = false,
  className,
}: SkillCardProps) {
  return (
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className={cn(
        'transition-all cursor-pointer',
        selected && 'ring-2 ring-cobalt-500',
        compact && 'p-4',
        className
      )}
    >
      <div className={cn('space-y-3', compact && 'space-y-2')}>
        {/* Header with status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className={cn(
              'font-semibold text-theme-primary truncate',
              compact ? 'text-sm' : 'text-base'
            )}>
              {skill.name}
            </h3>
            <p className="text-xs text-theme-secondary">v{skill.version}</p>
          </div>
          <SkillStatusBadge status={skill.status} size={compact ? 'sm' : 'md'} />
        </div>

        {/* Description */}
        {!compact && skill.description && (
          <p className="text-sm text-theme-secondary line-clamp-2">
            {skill.description}
          </p>
        )}

        {/* Capabilities */}
        {!compact && skill.requiredCapabilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skill.requiredCapabilities.slice(0, 3).map((cap) => (
              <Badge key={cap} variant="default" size="sm">
                {cap}
              </Badge>
            ))}
            {skill.requiredCapabilities.length > 3 && (
              <Badge variant="default" size="sm">
                +{skill.requiredCapabilities.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-theme-tertiary">
          {skill.timeout && (
            <span>Timeout: {skill.timeout}s</span>
          )}
          {skill.maxRetries > 0 && (
            <span>Retries: {skill.maxRetries}</span>
          )}
          {skill.linkedModelVersionId && (
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Model linked
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
