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
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700',
        'p-4 transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {contribution.metadata.description}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {contribution.metadata.robotType}
          </p>
        </div>
        <ContributionStatusBadge status={contribution.status} size="sm" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <FileStack size={16} className="text-gray-400" />
          <span>{contribution.trajectoryCount.toLocaleString()} trajectories</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Database size={16} className="text-gray-400" />
          <span>{LICENSE_TYPE_LABELS[contribution.licenseType].replace(' License', '')}</span>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {contribution.metadata.taskCategories.slice(0, 3).map((cat) => (
          <span
            key={cat}
            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
          >
            {cat}
          </span>
        ))}
        {contribution.metadata.taskCategories.length > 3 && (
          <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 rounded">
            +{contribution.metadata.taskCategories.length - 3}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Calendar size={14} />
          <span>{formatDate(contribution.createdAt)}</span>
        </div>
        {contribution.creditsAwarded ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
            <Award size={14} />
            <span>{formatCredits(contribution.creditsAwarded)} credits</span>
          </div>
        ) : contribution.qualityScore ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Quality: {contribution.qualityScore}%
          </div>
        ) : null}
      </div>
    </div>
  );
}
