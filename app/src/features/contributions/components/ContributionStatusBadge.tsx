/**
 * @file ContributionStatusBadge.tsx
 * @description Status badge component for contributions
 * @feature contributions
 * @dependencies @/shared/components/ui/badge
 */

import { cn } from '@/shared/utils/cn';
import type { ContributionStatus } from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ContributionStatusBadgeProps {
  status: ContributionStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_LABELS: Record<ContributionStatus, string> = {
  draft: 'Draft',
  uploaded: 'Uploaded',
  validating: 'Validating',
  reviewing: 'Under Review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  revoked: 'Revoked',
};

const STATUS_COLORS: Record<ContributionStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  uploaded: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  validating: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  reviewing: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  revoked: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
};

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionStatusBadge({
  status,
  size = 'md',
  className,
}: ContributionStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        STATUS_COLORS[status],
        SIZE_CLASSES[size],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
