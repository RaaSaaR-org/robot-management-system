/**
 * @file ContributionCard.tsx
 * @description Card component displaying contribution summary
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import { Calendar, Database, FileStack, Award } from 'lucide-react';
import { ContributionStatusBadge } from './ContributionStatusBadge';
import type { DataContribution } from '../types/contributions.types';
import { LICENSE_TYPE_LABELS, formatCredits } from '../types/contributions.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

// ============================================================================
// TYPES
// ============================================================================

export interface ContributionCardProps {
  contribution: DataContribution;
  onClick?: () => void;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionCard({
  contribution,
  onClick,
  className,
}: ContributionCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-panel rounded-lg border border-line ',
        'p-4 transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary/40 ',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-ink-primary truncate">
            {contribution.metadata.description}
          </h3>
          <p className="text-sm text-ink-tertiary mt-0.5">
            {contribution.metadata.robotType}
          </p>
        </div>
        <ContributionStatusBadge status={contribution.status} size="sm" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm text-ink-secondary">
          <FileStack size={16} className="text-ink-muted" />
          <span>{contribution.trajectoryCount.toLocaleString(UI_DATE_LOCALE)} trajectories</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-ink-secondary">
          <Database size={16} className="text-ink-muted" />
          <span>{LICENSE_TYPE_LABELS[contribution.licenseType].replace(' License', '')}</span>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {contribution.metadata.taskCategories.slice(0, 3).map((cat) => (
          <span
            key={cat}
            className="px-2 py-0.5 text-xs bg-inset text-ink-secondary rounded"
          >
            {cat}
          </span>
        ))}
        {contribution.metadata.taskCategories.length > 3 && (
          <span className="px-2 py-0.5 text-xs bg-inset text-ink-tertiary rounded">
            +{contribution.metadata.taskCategories.length - 3}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-line-subtle">
        <div className="flex items-center gap-1.5 text-sm text-ink-tertiary">
          <Calendar size={14} />
          <span>{formatDate(contribution.createdAt)}</span>
        </div>
        {contribution.creditsAwarded ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-signal-measured">
            <Award size={14} />
            <span>{formatCredits(contribution.creditsAwarded)} credits</span>
          </div>
        ) : contribution.qualityScore ? (
          <div className="text-sm text-ink-tertiary">
            Quality: {contribution.qualityScore}%
          </div>
        ) : null}
      </div>
    </div>
  );
}
