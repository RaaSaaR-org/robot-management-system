/**
 * @file WorldCloudView.tsx
 * @description The robot's own 3-D world cloud (TASK-211) — the lidar frames
 *              its map integrated, kept one point per voxel in the odometry
 *              frame — rendered in the Map tab's 3-D view. Polls the server
 *              proxy every few seconds while mounted; the same three states as
 *              the grid: a cloud, "this robot keeps none", "could not ask".
 * @feature agentmode
 */

import { memo, useEffect, useMemo } from 'react';
import { cn } from '@/shared/utils';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { PointCloudViewer } from '@/features/robots/components/visualization/PointCloudViewer';
import type { PointCloudFrame } from '@/features/robots/types/robots.types';
import { useAgentModeStore } from '../store/agentmodeStore';
import type { RobotCloudPayload } from '../types/agentmode.types';
import { decodeCloudPositions } from '../utils/mapExport';

export interface WorldCloudViewProps {
  robotId: string | null;
  className?: string;
  /** Poll cadence while mounted (the cloud is a few hundred KB — slower than the grid). */
  pollMs?: number;
  /** Points to ask for per poll (even-stride sample); the export asks for all. */
  maxPoints?: number;
}

/** The viewer wants a frame; the cloud is one, already in the world frame. */
export function cloudToFrame(robotId: string, cloud: RobotCloudPayload): { frame: PointCloudFrame; centre: [number, number, number] } | null {
  const positions = decodeCloudPositions(cloud);
  if (!positions || positions.length === 0) return null;
  const n = positions.length / 3;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += positions[i * 3];
    sy += positions[i * 3 + 1];
  }
  return {
    frame: {
      robotId,
      sensor: 'world_cloud',
      sensorType: 'lidar',
      // The viewer only rotates z-up → y-up; it does not re-pose the frame.
      frame: 'base_link',
      pointCount: n,
      positions,
      intensities: [],
      hasIntensity: false,
      sequence: cloud.frames,
      timestamp: cloud.lastIntegratedAt ?? new Date().toISOString(),
    },
    centre: [sx / n, sy / n, 0],
  };
}

export const WorldCloudView = memo(function WorldCloudView({ robotId, className, pollMs = 3000, maxPoints = 80_000 }: WorldCloudViewProps) {
  const cloud = useAgentModeStore((s) => s.robotCloud);
  const status = useAgentModeStore((s) => s.robotCloudStatus);
  const error = useAgentModeStore((s) => s.robotCloudError);
  const fetchRobotCloud = useAgentModeStore((s) => s.fetchRobotCloud);

  useEffect(() => {
    if (!robotId) return;
    void fetchRobotCloud(robotId, maxPoints);
    const timer = setInterval(() => void fetchRobotCloud(robotId, maxPoints), pollMs);
    return () => clearInterval(timer);
  }, [robotId, pollMs, maxPoints, fetchRobotCloud]);

  const built = useMemo(() => (robotId && cloud ? cloudToFrame(robotId, cloud) : null), [robotId, cloud]);

  if (!built || !cloud) {
    return (
      <div className={cn('absolute inset-0 flex items-center justify-center p-4 text-center', className)} data-testid="agent-cloud-empty">
        <p className="card-meta max-w-[28ch]">
          {status === 'disabled'
            ? error?.includes('no cloud yet')
              ? 'No cloud yet — points arrive as the robot looks and walks.'
              : 'This robot does not keep a point cloud (AGENT_CLOUD_ENABLED).'
            : status === 'unavailable'
              ? `Cloud unavailable: ${error ?? 'the robot did not answer'}.`
              : robotId
                ? 'Reading the robot’s cloud…'
                : 'No robot selected.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('absolute inset-0', className)} data-testid="agent-cloud-view">
      <PointCloudViewer
        frame={built.frame}
        showRobotModel={false}
        robotPose={cloud.pose ? { x: cloud.pose.x, y: cloud.pose.y, yawDeg: cloud.pose.yawDeg } : null}
        orbitTarget={built.centre}
        label="world cloud"
        pointSize={0.04}
        className="rounded-none min-h-0"
      />
      <div
        className="absolute top-2 right-2 text-[10px] font-mono bg-surface-900/80 text-theme-tertiary px-2 py-1 rounded"
        data-testid="agent-cloud-stats"
        title="Points kept by the robot (one per voxel) · frames integrated · voxel size"
      >
        {cloud.pointCount.toLocaleString(UI_DATE_LOCALE)} pts
        {cloud.returned < cloud.pointCount ? ` (showing ${cloud.returned.toLocaleString(UI_DATE_LOCALE)})` : ''} · {cloud.frames} frames · {Math.round(cloud.voxelM * 100)} cm voxels
        {status === 'unavailable' ? ' · stale' : ''}
      </div>
    </div>
  );
});
