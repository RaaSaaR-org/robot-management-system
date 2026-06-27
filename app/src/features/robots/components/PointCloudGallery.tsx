/**
 * @file PointCloudGallery.tsx
 * @description Lists recorded point-cloud scans with view / download / delete.
 * @feature robots
 */

import { useState, useCallback } from 'react';
import { Button, Badge, Spinner } from '@/shared/components/ui';
import { PointCloudViewer } from './visualization';
import { useRobotsStore } from '../store/robotsStore';
import { sensorScansApi } from '../api/sensorScansApi';
import { parsePcdBinary, downloadBlob } from '../utils/pointcloud';
import type { PointCloudFrame, SensorScanSummary } from '../types/robots.types';

export interface PointCloudGalleryProps {
  robotId: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function PointCloudGallery({ robotId }: PointCloudGalleryProps) {
  const scans = useRobotsStore((s) => s.sensorScans);
  const fetchSensorScans = useRobotsStore((s) => s.fetchSensorScans);

  const [selected, setSelected] = useState<{ scan: SensorScanSummary; frame: PointCloudFrame } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleView = useCallback(async (scan: SensorScanSummary) => {
    setLoadingId(scan.id);
    try {
      const buffer = await sensorScansApi.downloadScan(scan.id);
      const { positions, intensities, pointCount } = parsePcdBinary(buffer);
      setSelected({
        scan,
        frame: {
          robotId: scan.robotId,
          sensor: scan.sensorName,
          sensorType: scan.sensorType,
          frame: 'base_link',
          pointCount,
          positions,
          intensities,
          hasIntensity: scan.hasIntensity,
          sequence: 0,
          timestamp: scan.capturedAt,
        },
      });
    } catch (error) {
      console.error('Failed to load scan:', error);
    } finally {
      setLoadingId(null);
    }
  }, []);

  const handleDownload = useCallback(async (scan: SensorScanSummary) => {
    setBusyId(scan.id);
    try {
      const buffer = await sensorScansApi.downloadScan(scan.id);
      downloadBlob(new Blob([buffer], { type: 'application/octet-stream' }), `${scan.sensorName}-${scan.id.slice(0, 8)}.pcd`);
    } catch (error) {
      console.error('Failed to download scan:', error);
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleDelete = useCallback(
    async (scan: SensorScanSummary) => {
      setBusyId(scan.id);
      try {
        await sensorScansApi.deleteScan(scan.id);
        if (selected?.scan.id === scan.id) setSelected(null);
        await fetchSensorScans(robotId);
      } catch (error) {
        console.error('Failed to delete scan:', error);
      } finally {
        setBusyId(null);
      }
    },
    [robotId, selected, fetchSensorScans],
  );

  if (scans.length === 0) {
    return (
      <p className="text-sm text-theme-tertiary py-6 text-center">
        No recorded scans yet. Capture one from the live view above.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {selected && (
        <div className="relative h-[280px] rounded-lg overflow-hidden border border-[rgba(255,255,255,0.08)]">
          <PointCloudViewer frame={selected.frame} showRobotModel={false} colorMode="height" />
          <button
            onClick={() => setSelected(null)}
            className="absolute top-2 right-2 z-10 flex items-center justify-center w-7 h-7 rounded-lg bg-surface-900/80 text-theme-secondary hover:text-theme-primary"
            aria-label="Close preview"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {scans.map((scan) => (
          <li
            key={scan.id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg glass-subtle"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-theme-primary truncate">{scan.sensorName}</span>
                <Badge variant="cobalt" size="sm">
                  {scan.sensorType === 'lidar' ? 'LiDAR' : 'Depth'}
                </Badge>
              </div>
              <p className="text-xs text-theme-tertiary">
                {scan.pointCount.toLocaleString()} pts · {formatBytes(scan.fileSize)} ·{' '}
                {new Date(scan.capturedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleView(scan)}
                isLoading={loadingId === scan.id}
              >
                View
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDownload(scan)} disabled={busyId === scan.id}>
                Download
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(scan)} disabled={busyId === scan.id}>
                {busyId === scan.id ? <Spinner size="sm" /> : 'Delete'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
