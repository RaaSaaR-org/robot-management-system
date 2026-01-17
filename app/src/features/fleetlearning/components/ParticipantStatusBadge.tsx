/**
 * @file ParticipantStatusBadge.tsx
 * @description Badge component for displaying participant status in federated round
 * @feature fleetlearning
 */

import { cn } from '@/shared/utils/cn';
import type { ParticipantStatus } from '../types/fleetlearning.types';
import { PARTICIPANT_STATUS_LABELS } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ParticipantStatusBadgeProps {
  status: ParticipantStatus;
  size?: 'sm' | 'md';
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const statusColorClasses: Record<ParticipantStatus, string> = {
  selected: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  model_received: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  training: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  uploaded: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  timeout: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  excluded: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-0.5',
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ParticipantStatusBadge({
  status,
  size = 'sm',
  className,
}: ParticipantStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        statusColorClasses[status],
        sizeClasses[size],
        className
      )}
    >
      {PARTICIPANT_STATUS_LABELS[status]}
    </span>
  );
}
