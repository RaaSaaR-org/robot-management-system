/**
 * @file RoundStatusBadge.tsx
 * @description Badge component for displaying federated round status
 * @feature fleetlearning
 */

import { cn } from '@/shared/utils/cn';
import type { FederatedRoundStatus } from '../types/fleetlearning.types';
import { ROUND_STATUS_LABELS } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RoundStatusBadgeProps {
  status: FederatedRoundStatus;
  showPulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const statusColorClasses: Record<FederatedRoundStatus, string> = {
  created: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  selecting: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  distributing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  training: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  collecting: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  aggregating: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const pulseColorClasses: Record<FederatedRoundStatus, string> = {
  created: 'bg-gray-400',
  selecting: 'bg-blue-400',
  distributing: 'bg-purple-400',
  training: 'bg-yellow-400',
  collecting: 'bg-orange-400',
  aggregating: 'bg-cyan-400',
  completed: 'bg-green-400',
  failed: 'bg-red-400',
  cancelled: 'bg-gray-400',
};

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
  lg: 'text-base px-3 py-1.5',
};

// ============================================================================
// COMPONENT
// ============================================================================

export function RoundStatusBadge({
  status,
  showPulse = false,
  size = 'md',
  className,
}: RoundStatusBadgeProps) {
  const isActive = ['selecting', 'distributing', 'training', 'collecting', 'aggregating'].includes(status);
  const shouldPulse = showPulse && isActive;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-full',
        statusColorClasses[status],
        sizeClasses[size],
        className
      )}
    >
      {shouldPulse && (
        <span className="relative flex h-2 w-2">
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
              pulseColorClasses[status]
            )}
          />
          <span
            className={cn(
              'relative inline-flex rounded-full h-2 w-2',
              pulseColorClasses[status]
            )}
          />
        </span>
      )}
      {ROUND_STATUS_LABELS[status]}
    </span>
  );
}
