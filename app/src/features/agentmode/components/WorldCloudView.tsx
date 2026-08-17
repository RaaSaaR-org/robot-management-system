/**
 * @file WorldCloudView.tsx
 * @description The robot's own 3-D world cloud (TASK-211) — the lidar frames
 *              its map integrated, kept one point per voxel in the odometry
 *              frame — rendered in the Map tab's 3-D view. Polls the server
 *              proxy every few seconds while mounted; the same three states as
 *              the grid: a cloud, "this robot keeps none", "could not ask".
 * @feature agentmode
 */

import { memo, useEffect, useMemo, useRef } from 'react';
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

  // One poll is ~1.3 MB of base64 read off the robot over WiFi, so it is only
  // ever paid for a view someone is looking at:
  //  - hidden tab: no fetch at all (the grid poll in RobotMapPanel already does
  //    this; the cloud poll did not, so a backgrounded tab kept the robot
  //    encoding full clouds for ten minutes for nobody), and one immediate
  //    catch-up fetch when the tab comes back so the view is never stale-by-a-
  //    poll on return;
  //  - one request in flight at a time: on a slow link the fixed interval
  //    stacked 1.3 MB requests, and out-of-order responses flipped the view
  //    back to an older cloud (`staleResponse` only guards a robot change).
  // The first load is still immediate — the 3-D view must fill on open.
  const inFlight = useRef(false);
  useEffect(() => {
    if (!robotId) return;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await fetchRobotCloud(robotId, maxPoints);
      } finally {
        inFlight.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [robotId, pollMs, maxPoints, fetchRobotCloud]);

  const built = useMemo(() => (robotId && cloud ? cloudToFrame(robotId, cloud) : null), [robotId, cloud]);

  // The store hands us a fresh cloud object every poll, so `built.centre` is a
  // fresh array every poll too — and a fresh OrbitControls target snaps the
  // camera back to the centroid while the operator is orbiting. Freeze the
  // target per robot: taken from the first cloud that decodes, kept until the
  // robot changes. The points still refresh; only the pivot stays put.
  const orbitRef = useRef<{ robotId: string; centre: [number, number, number] } | null>(null);
  if (built && robotId && orbitRef.current?.robotId !== robotId) {
    orbitRef.current = { robotId, centre: built.centre };
  }
  const orbitTarget = orbitRef.current?.robotId === robotId ? orbitRef.current.centre : built?.centre;

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
        orbitTarget={orbitTarget}
        label="world cloud"
        pointSize={0.04}
        className="rounded-none min-h-0"
      />
      <div
        className="absolute top-2 right-2 text-[10px] font-mono glass-elevated text-theme-primary px-2 py-1 rounded"
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
