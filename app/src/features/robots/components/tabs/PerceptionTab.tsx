/**
 * @file PerceptionTab.tsx
 * @description Perception tab — live point cloud with the robot inside its own
 *              scan, a standalone toggle, color/size controls, capture + download,
 *              and a recorded-scan gallery.
 * @feature robots
 */

import { Suspense, lazy, useEffect, useState, useCallback } from 'react';
import { Card, Badge, Button } from '@/shared/components/ui';
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
  const [capturing, setCapturing] = useState(false);

  const robotType = normalizeRobotType(
    (telemetry?.robotType as string | undefined) ?? (robot.metadata?.robotType as string | undefined),
  );

  // Load recorded scans on mount.
  useEffect(() => {
    void fetchSensorScans(robotId);
  }, [robotId, fetchSensorScans]);

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
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowRobotModel((v) => !v)}
                className={controlBtn(showRobotModel)}
              >
                Robot model
              </button>
              <button
                onClick={() => setColorMode((m) => (m === 'height' ? 'intensity' : 'height'))}
                className={controlBtn(false)}
              >
                Color: {colorMode === 'height' ? 'Height' : 'Intensity'}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-theme-tertiary">
                Size
                <input
                  type="range"
                  min={0.01}
                  max={0.08}
                  step={0.005}
                  value={pointSize}
                  onChange={(e) => setPointSize(parseFloat(e.target.value))}
                  className="w-20 accent-[#FF6700]"
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
        </Card.Header>
        <Card.Body className="p-0 h-[380px]">
          <Suspense fallback={<Robot3DViewerFallback />}>
            <PointCloudViewer
              frame={frame}
              robotType={robotType}
              jointStates={telemetry?.jointStates}
              showRobotModel={showRobotModel}
              colorMode={colorMode}
              pointSize={pointSize}
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

function controlBtn(active: boolean): string {
  return [
    'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150',
    active
      ? 'text-[#FF6700] bg-[rgba(255,103,0,0.12)] border border-[rgba(255,103,0,0.25)]'
      : 'text-theme-tertiary hover:text-theme-secondary hover:bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]',
  ].join(' ');
}
