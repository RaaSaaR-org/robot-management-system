/**
 * @file CockpitPerceptionPanel.tsx
 * @description LiDAR / depth perception panel for the cockpit. Streams point-cloud
 *   frames (synthetic in sim, live hardware on a real G1) and renders them in the
 *   shared Three.js viewer with the robot model standing inside its own scan.
 * @feature robots
 */

import { memo } from 'react';
import { Radar } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { PointCloudViewer } from '../visualization/PointCloudViewer';
import { usePointCloudStream } from '../../hooks/usePointCloudStream';
import type { JointState, RobotType } from '../../types/robots.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface CockpitPerceptionPanelProps {
  robotId: string;
  robotType: RobotType;
  jointStates?: JointState[];
  /** Whether this embodiment carries a depth/LiDAR sensor (G1 family). */
  supported: boolean;
  /** Stream the cloud now (telemetry is live). Off → no polling, no 404 churn. */
  enabled?: boolean;
  className?: string;
}

export const CockpitPerceptionPanel = memo(function CockpitPerceptionPanel({
  robotId,
  robotType,
  jointStates,
  supported,
  enabled = supported,
  className,
}: CockpitPerceptionPanelProps) {
  const { frame, isConnected } = usePointCloudStream(robotId, { enabled });

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border border-[#A97BFF]/20 bg-[#06070A]',
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Radar className={cn('h-4 w-4 text-[#A97BFF]', enabled && isConnected && 'animate-pulse')} />
          <span className="font-mono text-xs uppercase tracking-wider text-theme-secondary">Perception · LiDAR</span>
        </div>
        {supported && enabled && (
          <span className="font-mono text-[10px] text-theme-tertiary">
            {frame ? `${frame.pointCount.toLocaleString(UI_DATE_LOCALE)} pts` : 'scanning…'}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-[220px]">
        {!supported ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Radar className="h-8 w-8 text-theme-tertiary/40" />
            <p className="max-w-[16rem] text-xs text-theme-tertiary">
              No depth or LiDAR sensor on this embodiment. Perception is available on the Unitree G1.
            </p>
          </div>
        ) : !enabled ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Radar className="h-8 w-8 text-theme-tertiary/40" />
            <p className="max-w-[16rem] text-xs text-theme-tertiary">
              Awaiting telemetry link — the LiDAR stream starts when the robot is online.
            </p>
          </div>
        ) : (
          <PointCloudViewer
            frame={frame}
            robotType={robotType}
            jointStates={jointStates}
            showRobotModel={false}
            pointSize={0.045}
            colorMode="height"
            className="h-full"
          />
        )}
      </div>
    </div>
  );
});
