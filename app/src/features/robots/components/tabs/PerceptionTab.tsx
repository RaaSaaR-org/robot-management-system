/**
 * @file PerceptionTab.tsx
 * @description Perception tab — live point cloud with the robot inside its own
 *              scan, view controls, capture + download, and the recorded scans.
 * @feature robots
 */

import { Suspense, lazy, useEffect, useState, useCallback } from 'react';
import { Download, Radar, ScanLine } from 'lucide-react';
import {
  Button,
  EmptyState,
  Panel,
  SegmentedControl,
  StatusTag,
  ToggleChip,
  Tooltip,
  toast,
} from '@/shared/components/ui';
import { Robot3DViewerFallback } from '../visualization';
import { PointCloudGallery } from '../PointCloudGallery';
import { usePointCloudStream } from '../../hooks/usePointCloudStream';
import { useRobotsStore } from '../../store/robotsStore';
import { sensorScansApi } from '../../api/sensorScansApi';
import { frameToPcdBlob, downloadBlob } from '../../utils/pointcloud';
import type { RobotType } from '../../types/robots.types';
import type { PerceptionTabProps } from './types';
import type { PointCloudColorMode } from '../visualization';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

const PointCloudViewer = lazy(() =>
  import('../visualization/PointCloudViewer').then((m) => ({ default: m.PointCloudViewer })),
);

/**
 * Below this point count a "live" hardware LiDAR frame is a heartbeat, not a
 * scan — the MID-360 keeps publishing 1-point dummy frames while the sensor
 * itself is switched off (rt/utlidar/switch). Real frames carry ~20k points.
 */
const IDLE_SENSOR_POINT_THRESHOLD = 50;

/** Embodiments that carry no depth camera or LiDAR at all. */
const NO_PERCEPTION: RobotType[] = ['so101'];

function normalizeRobotType(raw?: string): RobotType {
  const t = (raw ?? 'generic').toLowerCase();
  if (t.startsWith('g1_edu') || t.startsWith('g1-edu')) return 'g1_edu';
  if (t.startsWith('g1')) return 'g1';
  if (t.startsWith('h1')) return 'h1';
  if (t.startsWith('so101')) return 'so101';
  return 'generic';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  // The API client rejects with plain {code, message} objects.
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

const COLOR_OPTIONS: { value: PointCloudColorMode; label: string }[] = [
  { value: 'height', label: 'Height' },
  { value: 'intensity', label: 'Intensity' },
];

export function PerceptionTab({ robot, robotId, telemetry }: PerceptionTabProps) {
  const { frame: streamFrame, isConnected, lastUpdate } = usePointCloudStream(robotId, { enabled: true });
  // A frame without points (the demo mocks answer the snapshot route with a
  // stub) is treated as no frame, so the panel shows its calm empty state.
  const frame =
    streamFrame && typeof streamFrame.pointCount === 'number' && streamFrame.positions != null
      ? streamFrame
      : null;
  const fetchSensorScans = useRobotsStore((s) => s.fetchSensorScans);

  const [showRobotModel, setShowRobotModel] = useState(true);
  const [colorMode, setColorMode] = useState<PointCloudColorMode>('height');
  const [pointSize, setPointSize] = useState(0.025);
  // Default ON: clips stray far returns above room height and below-floor reflections.
  const [hideCeiling, setHideCeiling] = useState(true);
  const [capturing, setCapturing] = useState(false);
  // LiDAR power switch: target state while a switch is in flight (null = none).
  // Kept pending until the point stream reflects the change (spin-up takes seconds).
  const [lidarPending, setLidarPending] = useState<boolean | null>(null);

  // The stream is the source of truth for LiDAR power: a switched-off MID-360
  // still publishes 1-point heartbeats, a live one ~20k points.
  const isHardwareLidar = frame?.source === 'hardware' && frame.sensorType === 'lidar';
  const lidarOn = isHardwareLidar && frame.pointCount >= IDLE_SENSOR_POINT_THRESHOLD;
  const sensorIdle = frame?.source === 'hardware' && frame.pointCount < IDLE_SENSOR_POINT_THRESHOLD;

  const robotType = normalizeRobotType(
    (telemetry?.robotType as string | undefined) ?? (robot.metadata?.robotType as string | undefined),
  );
  const unsupported = NO_PERCEPTION.includes(robotType) && !frame;
  const isOffline = robot.status === 'offline';

  useEffect(() => {
    void fetchSensorScans(robotId);
  }, [robotId, fetchSensorScans]);

  // Resolve the pending switch when the stream reflects it; give up after 45 s
  // (a cold MID-360 was observed to take >20 s to its first dense frame).
  useEffect(() => {
    if (lidarPending === null) return;
    if (lidarOn === lidarPending) {
      setLidarPending(null);
      return;
    }
    const timeout = setTimeout(() => {
      setLidarPending(null);
      toast.error(`Couldn't switch LiDAR ${lidarPending ? 'on' : 'off'}`, {
        description: 'The point stream did not follow within 45 s.',
      });
    }, 45_000);
    return () => clearTimeout(timeout);
  }, [lidarPending, lidarOn]);

  const handleLidarSwitch = useCallback(async () => {
    const target = !lidarOn;
    setLidarPending(target);
    try {
      const result = await sensorScansApi.setLidarSwitch(robotId, target);
      if (!result.ok) {
        setLidarPending(null);
        toast.error(`Couldn't switch LiDAR ${target ? 'on' : 'off'}`, { description: result.error });
      }
    } catch (error) {
      setLidarPending(null);
      toast.error(`Couldn't switch LiDAR ${target ? 'on' : 'off'}`, { description: errorText(error) });
    }
  }, [lidarOn, robotId]);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    try {
      await sensorScansApi.captureScan(robotId);
      await fetchSensorScans(robotId);
      toast.success('Scan captured', { description: robot.name });
    } catch (error) {
      toast.error("Couldn't capture scan", { description: errorText(error) });
    } finally {
      setCapturing(false);
    }
  }, [robotId, robot.name, fetchSensorScans]);

  const handleDownloadLive = useCallback(() => {
    if (!frame) return;
    downloadBlob(frameToPcdBlob(frame), `${frame.sensor}-live.pcd`);
  }, [frame]);

  if (unsupported) {
    return (
      <Panel>
        <Panel.Header title="Point cloud" />
        <Panel.Body>
          <EmptyState
            icon={<Radar />}
            title="LiDAR is not available for this robot"
            description={`${robot.name} has no depth camera or LiDAR, so there is no point cloud to show.`}
          />
        </Panel.Body>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <Panel.Header
          title="Point cloud"
          description={
            frame
              ? `${frame.sensorType === 'lidar' ? 'LiDAR' : 'Depth camera'} · ${frame.pointCount.toLocaleString(UI_DATE_LOCALE)} points`
              : 'The robot inside its own scan.'
          }
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Download className="h-4 w-4" strokeWidth={1.75} />}
                onClick={handleDownloadLive}
                disabled={!frame}
              >
                Download frame
              </Button>
              <Button
                size="sm"
                leftIcon={<ScanLine className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => void handleCapture()}
                isLoading={capturing}
                loadingText="Capturing…"
              >
                Capture scan
              </Button>
            </>
          }
        />
        <Panel.Body className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {isConnected ? (
              <StatusTag tone="live" dot pulse>Live</StatusTag>
            ) : (
              <StatusTag tone="neutral" dot>No link</StatusTag>
            )}
            {frame?.source === 'sim' && <StatusTag tone="sim">Sim</StatusTag>}
            {frame?.source === 'replay' && (
              <Tooltip content={`Replayed recording${frame.sourceLabel ? ` — ${frame.sourceLabel}` : ''}`}>
                <span><StatusTag tone="neutral">Replay</StatusTag></span>
              </Tooltip>
            )}
            {sensorIdle && (
              <Tooltip content="The sensor is connected but only sends heartbeat frames — the LiDAR is switched off.">
                <span><StatusTag tone="gated">Sensor idle</StatusTag></span>
              </Tooltip>
            )}
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            <ToggleChip active={showRobotModel} onClick={() => setShowRobotModel((v) => !v)}>
              Robot model
            </ToggleChip>
            {frame?.sensorType === 'lidar' && (
              <Tooltip content="Clip points above 2.2 m and below-floor reflections, keeping walls and obstacles at robot height.">
                <span>
                  <ToggleChip active={hideCeiling} onClick={() => setHideCeiling((v) => !v)}>
                    Clip room
                  </ToggleChip>
                </span>
              </Tooltip>
            )}
            <SegmentedControl label="Color by" size="sm" options={COLOR_OPTIONS} value={colorMode} onChange={setColorMode} />
            <label className="flex items-center gap-2 text-xs text-ink-tertiary">
              Point size
              <input
                type="range"
                min={0.01}
                max={0.08}
                step={0.005}
                value={pointSize}
                onChange={(e) => setPointSize(parseFloat(e.target.value))}
                className="w-20 accent-[var(--color-primary)]"
              />
            </label>
            {isHardwareLidar && (
              <Button
                size="sm"
                variant="secondary"
                className="sm:ml-auto"
                onClick={() => void handleLidarSwitch()}
                isLoading={lidarPending !== null}
                loadingText={lidarPending ? 'Starting LiDAR…' : 'Stopping LiDAR…'}
              >
                {lidarOn ? 'Turn LiDAR off' : 'Turn LiDAR on'}
              </Button>
            )}
          </div>
          <div className="h-[280px] sm:h-[380px]">
            {!frame && isOffline ? (
              <EmptyState
                className="h-full"
                icon={<Radar />}
                title="No point cloud yet"
                description={`${robot.name} is offline. Start its robot agent to see live telemetry and send commands.`}
              />
            ) : (
              <Suspense fallback={<Robot3DViewerFallback className="h-full min-h-0" />}>
                <PointCloudViewer
                  frame={frame}
                  robotType={robotType}
                  jointStates={telemetry?.jointStates}
                  robotId={robotId}
                  showRobotModel={showRobotModel}
                  colorMode={colorMode}
                  pointSize={pointSize}
                  hideCeiling={frame?.sensorType === 'lidar' && hideCeiling}
                  className="min-h-0"
                />
              </Suspense>
            )}
          </div>
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header
          title="Recorded scans"
          description={lastUpdate ? `Live view updated ${lastUpdate.toLocaleTimeString(UI_DATE_LOCALE)}` : undefined}
        />
        <Panel.Body>
          <PointCloudGallery robotId={robotId} />
        </Panel.Body>
      </Panel>
    </div>
  );
}
