/**
 * @file CockpitPerceptionPanel.tsx
 * @description The control center's LiDAR panel. Streams point-cloud frames
 *   (synthetic in sim, live on a real G1) into the shared point-cloud viewer, and
 *   explains calmly when the robot has no sensor or no telemetry link.
 * @feature robots
 */

import { memo } from 'react';
import { Radar } from 'lucide-react';
import { EmptyState, Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { PointCloudViewer } from '../visualization/PointCloudViewer';
import { usePointCloudStream } from '../../hooks/usePointCloudStream';
import { ProvenanceTag, type ProvenanceSource } from '../common/ProvenanceTag';
import type { JointState, RobotType } from '../../types/robots.types';

export interface CockpitPerceptionPanelProps {
  robotId: string;
  robotType: RobotType;
  jointStates?: JointState[];
  /** Whether this embodiment carries a depth/LiDAR sensor. */
  supported: boolean;
  /** Stream the cloud now (telemetry is live). Off → no polling, no 404 churn. */
  enabled?: boolean;
  /** Provenance of the robot's telemetry, shown in the header. */
  provenance?: ProvenanceSource;
  /** Height classes for the viewer body. */
  bodyClassName?: string;
  className?: string;
}

export const CockpitPerceptionPanel = memo(function CockpitPerceptionPanel({
  robotId,
  robotType,
  jointStates,
  supported,
  enabled = supported,
  provenance = 'none',
  bodyClassName,
  className,
}: CockpitPerceptionPanelProps) {
  const { frame } = usePointCloudStream(robotId, { enabled });

  const description = !supported
    ? 'No depth sensor on this robot.'
    : enabled
      ? frame
        ? `${frame.pointCount.toLocaleString(UI_DATE_LOCALE)} points in the latest scan`
        : 'Waiting for the first scan…'
      : 'Starts when telemetry arrives.';

  return (
    <Panel className={cn('flex flex-col', className)}>
      <Panel.Header
        title="LiDAR"
        description={description}
        actions={supported ? <ProvenanceTag source={enabled ? provenance : 'none'} /> : undefined}
      />
      <div className={cn('relative p-3', bodyClassName)}>
        {!supported ? (
          <EmptyState
            size="sm"
            icon={<Radar />}
            title="Not available for this robot"
            description="Perception needs a depth or LiDAR sensor. The Unitree G1 and H1 carry one."
            className="h-full"
          />
        ) : !enabled ? (
          <EmptyState
            size="sm"
            icon={<Radar />}
            title="Awaiting telemetry"
            description="The LiDAR stream starts when the robot is online and streaming."
            className="h-full"
          />
        ) : (
          <div className="h-full overflow-hidden rounded-control bg-inset">
            <PointCloudViewer
              frame={frame}
              robotType={robotType}
              jointStates={jointStates}
              showRobotModel={false}
              pointSize={0.045}
              colorMode="height"
              className="h-full"
            />
          </div>
        )}
      </div>
    </Panel>
  );
});
