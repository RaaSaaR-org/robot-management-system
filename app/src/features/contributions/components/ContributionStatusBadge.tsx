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
  draft: 'bg-inset text-ink-primary ',
  uploaded: 'bg-signal-estimated/10 text-signal-estimated ',
  validating: 'bg-signal-unknown/10 text-signal-unknown ',
  reviewing: 'bg-primary/10 text-primary ',
  accepted: 'bg-signal-measured/10 text-signal-measured ',
  rejected: 'bg-signal-stopped/10 text-signal-stopped ',
  revoked: 'bg-signal-unknown/10 text-signal-unknown ',
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
