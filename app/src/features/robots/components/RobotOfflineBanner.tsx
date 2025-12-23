/**
 * @file RobotOfflineBanner.tsx
 * @description Prominent banner displayed when a robot is offline
 * @feature robots
 */

import { memo } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotOfflineBannerProps {
  /** Robot name for display */
  robotName: string;
  /** ISO timestamp of when the robot was last seen */
  lastSeen: string;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Prominent offline banner displayed at the top of robot details when the robot is offline.
 */
export const RobotOfflineBanner = memo(function RobotOfflineBanner({
  robotName,
  lastSeen,
  className,
}: RobotOfflineBannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-4 p-4 rounded-xl',
        'glass-subtle border-gray-500/30 bg-gray-500/10',
        className
      )}
    >
      {/* Icon */}
      <div className="p-2 rounded-lg glass-subtle border-gray-500/20">
        <svg
          className="h-5 w-5 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          {/* Wifi off icon */}
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
          />
          {/* Strikethrough line */}
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3l18 18"
          />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1">
        <h3 className="font-semibold text-gray-300">Robot Offline</h3>
        <p className="mt-1 text-sm text-gray-400">
          <span className="font-medium">{robotName}</span> is currently disconnected.
          Last connected {formatTimeAgo(lastSeen)}.
        </p>
      </div>
    </div>
  );
});
