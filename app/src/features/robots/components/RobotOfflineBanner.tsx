/**
 * @file RobotOfflineBanner.tsx
 * @description One-line inline hint for an offline robot. Offline is a normal
 *              state, so it is calm and says what to do, not a red error.
 *              Given a `robotId` that a robot supervisor covers, it also shows
 *              the compact readiness panel with Start robot side (TASK-419).
 * @feature robots
 */

import { memo } from 'react';
import { WifiOff } from 'lucide-react';
import { Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { formatTimeAgo } from '@/shared/utils/format';
import { useRobotReadiness } from '../hooks/useRobotReadiness';
import { RobotReadinessPanel } from './readiness/RobotReadinessPanel';

export interface RobotOfflineBannerProps {
  /** Robot name for display */
  robotName: string;
  /** ISO timestamp of when the robot was last seen */
  lastSeen?: string;
  /** The robot's id: with a supervisor, the banner offers Start robot side. */
  robotId?: string;
  /** Additional class names */
  className?: string;
}

/** "{name} is offline. Start its robot agent …" — or "Start the robot side below." */
export const RobotOfflineBanner = memo(function RobotOfflineBanner({
  robotName,
  lastSeen,
  robotId,
  className,
}: RobotOfflineBannerProps) {
  const ready = useRobotReadiness(robotId ?? '', { enabled: !!robotId });
  const snapshot = robotId ? ready.readiness : null;
  const supervised = !!robotId && snapshot?.robotId === robotId && snapshot.bringup != null;
  return (
    <Panel
      variant="inset"
      padding="sm"
      role="status"
      className={cn('flex flex-col gap-3 text-sm text-ink-secondary', className)}
    >
      <div className="flex items-start gap-3">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
        <p className="min-w-0">
          {supervised
            ? `${robotName} is offline. Start the robot side below.`
            : `${robotName} is offline. Start its robot agent to see live telemetry and send commands.`}
          {lastSeen && (
            <span className="text-ink-tertiary"> Last seen {formatTimeAgo(lastSeen)}.</span>
          )}
        </p>
      </div>
      {supervised && robotId && <RobotReadinessPanel robotId={robotId} variant="compact" readiness={ready} />}
    </Panel>
  );
});
