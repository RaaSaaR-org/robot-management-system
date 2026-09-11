/**
 * @file RobotOfflineBanner.tsx
 * @description One-line inline hint for an offline robot. Offline is a normal
 *              state, so it is calm and says what to do, not a red error.
 * @feature robots
 */

import { memo } from 'react';
import { WifiOff } from 'lucide-react';
import { Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { formatTimeAgo } from '@/shared/utils/format';

export interface RobotOfflineBannerProps {
  /** Robot name for display */
  robotName: string;
  /** ISO timestamp of when the robot was last seen */
  lastSeen?: string;
  /** Additional class names */
  className?: string;
}

/** "{name} is offline. Start its robot agent …" */
export const RobotOfflineBanner = memo(function RobotOfflineBanner({
  robotName,
  lastSeen,
  className,
}: RobotOfflineBannerProps) {
  return (
    <Panel
      variant="inset"
      padding="sm"
      role="status"
      className={cn('flex items-start gap-3 text-sm text-ink-secondary', className)}
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
      <p className="min-w-0">
        {robotName} is offline. Start its robot agent to see live telemetry and send commands.
        {lastSeen && (
          <span className="text-ink-tertiary"> Last seen {formatTimeAgo(lastSeen)}.</span>
        )}
      </p>
    </Panel>
  );
});
