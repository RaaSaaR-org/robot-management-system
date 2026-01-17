/**
 * @file ContributionList.tsx
 * @description List component for displaying contributions with filters
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import { Filter, Plus, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { ContributionCard } from './ContributionCard';
import type {
  DataContribution,
  ContributionFilters,
  ContributionPagination,
  ContributionStatus,
  ContributionLicenseType,
} from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ContributionListProps {
  contributions: DataContribution[];
  filters: ContributionFilters;
  pagination: ContributionPagination;
  isLoading: boolean;
  onFilterChange: (filters: Partial<ContributionFilters>) => void;
  onClearFilters: () => void;
  onPageChange: (offset: number) => void;
  onContributionClick: (contribution: DataContribution) => void;
  onNewContribution?: () => void;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_OPTIONS: { value: ContributionStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'validating', label: 'Validating' },
  { value: 'reviewing', label: 'Under Review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'revoked', label: 'Revoked' },
];

const LICENSE_OPTIONS: { value: ContributionLicenseType | ''; label: string }[] = [
  { value: '', label: 'All Licenses' },
  { value: 'exclusive', label: 'Exclusive' },
  { value: 'non_exclusive', label: 'Non-Exclusive' },
  { value: 'limited', label: 'Limited' },
  { value: 'research_only', label: 'Research Only' },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionList({
  contributions,
  filters,
  pagination,
  isLoading,
  onFilterChange,
  onClearFilters,
  onPageChange,
  onContributionClick,
  onNewContribution,
  className,
}: ContributionListProps) {
  const hasFilters = filters.status || filters.licenseType;
  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <Filter size={18} className="text-gray-400" />
          <select
            value={filters.status || ''}
            onChange={(e) =>
              onFilterChange({ status: e.target.value as ContributionStatus | undefined || undefined })
            }
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={filters.licenseType || ''}
            onChange={(e) =>
              onFilterChange({
                licenseType: e.target.value as ContributionLicenseType | undefined || undefined,
              })
            }
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            {LICENSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={onClearFilters}
              className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
            >
              Clear
            </button>
          )}
        </div>

        {onNewContribution && (
          <button
            onClick={onNewContribution}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus size={18} />
            <span>New Contribution</span>
          </button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && contributions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg mb-2">No contributions found</p>
          <p className="text-sm">
            {hasFilters
              ? 'Try adjusting your filters'
              : 'Start by creating your first contribution'}
          </p>
          {!hasFilters && onNewContribution && (
            <button
              onClick={onNewContribution}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={18} />
              <span>Create Contribution</span>
            </button>
          )}
        </div>
      )}

      {/* Contributions Grid */}
      {!isLoading && contributions.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {contributions.map((contribution) => (
              <ContributionCard
                key={contribution.id}
                contribution={contribution}
                onClick={() => onContributionClick(contribution)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Showing {pagination.offset + 1}-
                {Math.min(pagination.offset + pagination.limit, pagination.total)} of{' '}
                {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPageChange(Math.max(0, pagination.offset - pagination.limit))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() =>
                    onPageChange(
                      Math.min(
                        (totalPages - 1) * pagination.limit,
                        pagination.offset + pagination.limit
                      )
                    )
                  }
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
