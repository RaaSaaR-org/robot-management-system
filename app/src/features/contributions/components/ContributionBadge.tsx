/**
 * @file ContributionBadge.tsx
 * @description Color-coded status badge for data contributions (TASK-065)
 * @feature Data Contribution
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

/** Prisma-backed contribution statuses */
export type DbContributionStatus = 'pending' | 'processing' | 'approved' | 'rejected';

export interface ContributionBadgeProps {
  status: DbContributionStatus;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_CONFIG: Record<DbContributionStatus, { label: string; classes: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  processing: {
    label: 'Processing',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  approved: {
    label: 'Approved',
    classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionBadge({ status, className }: ContributionBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        config.classes,
        className
      )}
    >
      {config.label}
    </span>
  );
}
