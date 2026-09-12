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
    classes: 'bg-signal-unknown/10 text-signal-unknown ',
  },
  processing: {
    label: 'Processing',
    classes: 'bg-signal-estimated/10 text-signal-estimated ',
  },
  approved: {
    label: 'Approved',
    classes: 'bg-signal-measured/10 text-signal-measured ',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-signal-stopped/10 text-signal-stopped ',
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
