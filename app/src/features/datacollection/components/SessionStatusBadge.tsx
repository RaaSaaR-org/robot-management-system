/**
 * @file SessionStatusBadge.tsx
 * @description Status badge component for teleoperation sessions
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { Circle } from 'lucide-react';
import type { TeleoperationStatus } from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionStatusBadgeProps {
  status: TeleoperationStatus;
  size?: 'sm' | 'md' | 'lg';
  showPulse?: boolean;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_LABELS: Record<TeleoperationStatus, string> = {
  created: 'Ready',
  recording: 'Recording',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

const STATUS_COLORS: Record<TeleoperationStatus, string> = {
  created: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  recording: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const DOT_COLORS: Record<TeleoperationStatus, string> = {
  created: 'text-gray-400',
  recording: 'text-red-500',
  paused: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
};

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
};

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionStatusBadge({
  status,
  size = 'md',
  showPulse = true,
  className,
}: SessionStatusBadgeProps) {
  const isActive = status === 'recording';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-full',
        STATUS_COLORS[status],
        SIZE_CLASSES[size],
        className
      )}
    >
      <span className="relative">
        <Circle
          size={size === 'sm' ? 6 : size === 'md' ? 8 : 10}
          className={cn('fill-current', DOT_COLORS[status])}
        />
        {showPulse && isActive && (
          <span className="absolute inset-0 animate-ping">
            <Circle
              size={size === 'sm' ? 6 : size === 'md' ? 8 : 10}
              className="fill-current text-red-500 opacity-75"
            />
          </span>
        )}
      </span>
      {STATUS_LABELS[status]}
    </span>
  );
}
