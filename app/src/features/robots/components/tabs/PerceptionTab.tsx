/**
 * @file PerceptionTab.tsx
 * @description Perception tab — live point cloud with the robot inside its own
 *              scan, a standalone toggle, color/size controls, capture + download,
 *              and a recorded-scan gallery.
 * @feature robots
 */

import { Suspense, lazy, useEffect, useState, useCallback } from 'react';
import { Card, Badge, Button, ToggleChip } from '@/shared/components/ui';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { Robot3DViewerFallback } from '../visualization';
import { PointCloudGallery } from '../PointCloudGallery';
import { usePointCloudStream } from '../../hooks/usePointCloudStream';
import { useRobotsStore } from '../../store/robotsStore';
import { sensorScansApi } from '../../api/sensorScansApi';
import { frameToPcdBlob, downloadBlob } from '../../utils/pointcloud';
import type { RobotType } from '../../types/robots.types';
import type { PerceptionTabProps } from './types';
import type { PointCloudColorMode } from '../visualization';

const PointCloudViewer = lazy(() =>
  import('../visualization/PointCloudViewer').then((m) => ({ default: m.PointCloudViewer })),
);

/**
 * Below this point count a "live" hardware LiDAR frame is a heartbeat, not a
 * scan — the MID-360 keeps publishing 1-point dummy frames while the sensor
 * itself is switched off (rt/utlidar/switch). Real frames carry ~20k points.
 */
const IDLE_SENSOR_POINT_THRESHOLD = 50;

function normalizeRobotType(raw?: string): RobotType {
  const t = (raw ?? 'generic').toLowerCase();
  if (t.startsWith('g1_edu') || t.startsWith('g1-edu')) return 'g1_edu';
  if (t.startsWith('g1')) return 'g1';
  if (t.startsWith('h1')) return 'h1';
  if (t.startsWith('so101')) return 'so101';
  return 'generic';
}

export function PerceptionTab({ robot, robotId, telemetry }: PerceptionTabProps) {
  const { frame, isConnected, lastUpdate } = usePointCloudStream(robotId, { enabled: true });
  const fetchSensorScans = useRobotsStore((s) => s.fetchSensorScans);

  const [showRobotModel, setShowRobotModel] = useState(true);
  const [colorMode, setColorMode] = useState<PointCloudColorMode>('height');
  const [pointSize, setPointSize] = useState(0.025);
  // Default ON: clips stray far returns above room height and below-floor
  // reflections (through windows / glancing angles) so the room stays tight
  // around the robot.
  const [hideCeiling, setHideCeiling] = useState(true);
  const [capturing, setCapturing] = useState(false);
  // LiDAR power switch: target state while a switch is in flight (null = none).
  // Kept pending until the point stream actually reflects the change, because
  // the sensor takes a few seconds to spin up/down after the DDS write.
  const [lidarPending, setLidarPending] = useState<boolean | null>(null);
  const [lidarError, setLidarError] = useState<string | null>(null);

  // The stream itself is the source of truth for LiDAR power: a switched-off
  // MID-360 still publishes 1-point heartbeats, a live one ~20k points.
  const isHardwareLidar = frame?.source === 'hardware' && frame.sensorType === 'lidar';
  const lidarOn = isHardwareLidar && frame.pointCount >= IDLE_SENSOR_POINT_THRESHOLD;

  const robotType = normalizeRobotType(
    (telemetry?.robotType as string | undefined) ?? (robot.metadata?.robotType as string | undefined),
  );

  // Load recorded scans on mount.
  useEffect(() => {
    void fetchSensorScans(robotId);
  }, [robotId, fetchSensorScans]);

  // Resolve the pending switch when the stream reflects it; give up after 45 s
  // (e.g. the utlidar node ignored the command) so the button never sticks.
  // 45 s because a cold MID-360 was observed to take >20 s from the ON command
  // to the first dense frame (2026-07-17 live test).
  useEffect(() => {
    if (lidarPending === null) return;
    if (lidarOn === lidarPending) {
      setLidarPending(null);
      return;
    }
    const timeout = setTimeout(() => {
      setLidarPending(null);
      setLidarError(
        `LiDAR was commanded ${lidarPending ? 'ON' : 'OFF'} but the point stream did not follow within 45 s`,
      );
    }, 45_000);
    return () => clearTimeout(timeout);
  }, [lidarPending, lidarOn]);

  const handleLidarSwitch = useCallback(async () => {
    const target = !lidarOn;
    setLidarError(null);
    setLidarPending(target);
    try {
      const result = await sensorScansApi.setLidarSwitch(robotId, target);
      if (!result.ok) {
        setLidarPending(null);
        setLidarError(result.error ?? 'LiDAR switch failed');
      }
    } catch (error) {
      console.error('Failed to switch LiDAR:', error);
      setLidarPending(null);
      setLidarError(error instanceof Error ? error.message : 'LiDAR switch failed');
    }
  }, [lidarOn, robotId]);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    try {
      await sensorScansApi.captureScan(robotId);
      await fetchSensorScans(robotId);
    } catch (error) {
      console.error('Failed to capture scan:', error);
    } finally {
      setCapturing(false);
    }
  }, [robotId, fetchSensorScans]);

  const handleDownloadLive = useCallback(() => {
    if (!frame) return;
    downloadBlob(frameToPcdBlob(frame), `${frame.sensor}-live.pcd`);
  }, [frame]);

  return (
    <div className="space-y-6">
      <Card className="min-h-[440px]">
        <Card.Header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-theme-primary">Perception</h2>
              {frame && (
                <Badge variant="turquoise" size="sm">
                  {frame.sensorType === 'lidar' ? 'LiDAR' : 'Depth'}
                </Badge>
              )}
              {isConnected ? (
                <span className="flex items-center gap-1.5 text-xs text-green-500 font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-gray-500" /> Offline
                </span>
              )}
              {frame?.source === 'sim' && (
                <Tooltip content="Simulated point cloud — no hardware source">
                  <span className="inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider cursor-default bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/25">
                    SIM
                  </span>
                </Tooltip>
              )}
              {frame?.source === 'replay' && (
                <Tooltip content={`Replayed recording${frame.sourceLabel ? ` — ${frame.sourceLabel}` : ''}`}>
                  <span className="inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider cursor-default bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/25">
                    REPLAY
                  </span>
                </Tooltip>
              )}
              {frame?.source === 'hardware' && frame.pointCount < IDLE_SENSOR_POINT_THRESHOLD && (
                <Tooltip content={`The sensor is connected but returning heartbeat frames (${frame.pointCount} pt${frame.pointCount === 1 ? '' : 's'}) — the LiDAR is switched off. Use the "LiDAR on" button to start it.`}>
                  <span className="inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider cursor-default bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                    Sensor idle
                  </span>
                </Tooltip>
              )}
              {frame && (
                <span className="text-xs text-theme-tertiary tabular-nums">
                  {frame.pointCount.toLocaleString()} pts
                </span>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {isHardwareLidar && (
                <Tooltip
                  content={
                    lidarOn
                      ? 'Switch the MID-360 LiDAR off (rt/utlidar/switch — sensor only, no motion)'
                      : 'Switch the MID-360 LiDAR on (rt/utlidar/switch — sensor only, no motion)'
                  }
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleLidarSwitch}
                    isLoading={lidarPending !== null}
                    loadingText={lidarPending ? 'LiDAR starting…' : 'LiDAR stopping…'}
                  >
                    {lidarOn ? 'LiDAR off' : 'LiDAR on'}
                  </Button>
                </Tooltip>
              )}
              <ToggleChip active={showRobotModel} onClick={() => setShowRobotModel((v) => !v)}>
                Robot model
              </ToggleChip>
              {frame?.sensorType === 'lidar' && (
                <Tooltip content="Clip points above 2.2 m and below-floor reflections — keeps the view focused on walls and obstacles at robot height.">
                  <ToggleChip active={hideCeiling} onClick={() => setHideCeiling((v) => !v)}>
                    Clip room
                  </ToggleChip>
                </Tooltip>
              )}
              <ToggleChip
                active={false}
                onClick={() => setColorMode((m) => (m === 'height' ? 'intensity' : 'height'))}
              >
                Color: {colorMode === 'height' ? 'Height' : 'Intensity'}
              </ToggleChip>
              <label className="flex items-center gap-1.5 text-xs text-theme-tertiary">
                Size
                <input
                  type="range"
                  min={0.01}
                  max={0.08}
                  step={0.005}
                  value={pointSize}
                  onChange={(e) => setPointSize(parseFloat(e.target.value))}
                  className="w-20 accent-cobalt-500"
                />
              </label>
              <Button size="sm" variant="ghost" onClick={handleDownloadLive} disabled={!frame}>
                Download
              </Button>
              <Button size="sm" variant="primary" onClick={handleCapture} isLoading={capturing} loadingText="Capturing…">
                Capture scan
              </Button>
            </div>
          </div>
          {lidarError && (
            <p className="mt-2 text-xs text-red-500">{lidarError}</p>
          )}
        </Card.Header>
        <Card.Body className="p-0 h-[380px]">
          <Suspense fallback={<Robot3DViewerFallback />}>
            <PointCloudViewer
              frame={frame}
              robotType={robotType}
              jointStates={telemetry?.jointStates}
              robotId={robotId}
              showRobotModel={showRobotModel}
              colorMode={colorMode}
              pointSize={pointSize}
              hideCeiling={frame?.sensorType === 'lidar' && hideCeiling}
            />
          </Suspense>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-primary">Recorded Scans</h2>
            {lastUpdate && (
              <span className="text-xs text-theme-tertiary">
                Live updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </Card.Header>
        <Card.Body>
          <PointCloudGallery robotId={robotId} />
        </Card.Body>
      </Card>
    </div>
  );
}
