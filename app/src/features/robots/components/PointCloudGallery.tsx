/**
 * @file PointCloudGallery.tsx
 * @description Recorded point-cloud scans as a card grid with view / download / delete.
 * @feature robots
 */

import { useState, useCallback } from 'react';
import { Download, Eye, ScanLine, Trash2, X } from 'lucide-react';
import {
  Button, EmptyState,
  Panel, RowActions,
  StatusTag, confirm,
  errorMessage, toast,
} from '@/shared/components/ui';
import { PointCloudViewer } from './visualization';
import { useRobotsStore } from '../store/robotsStore';
import { sensorScansApi } from '../api/sensorScansApi';
import { parsePcdBinary, downloadBlob } from '../utils/pointcloud';
import type { PointCloudFrame, SensorScanSummary } from '../types/robots.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface PointCloudGalleryProps {
  robotId: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function scanName(scan: SensorScanSummary): string {
  return `${scan.sensorName} scan`;
}

export function PointCloudGallery({ robotId }: PointCloudGalleryProps) {
  // The list endpoint may answer without a `scans` array (demo mocks do), so
  // guard here rather than trusting the store to hold an array.
  const storedScans = useRobotsStore((s) => s.sensorScans);
  const scans: SensorScanSummary[] = Array.isArray(storedScans) ? storedScans : [];
  const fetchSensorScans = useRobotsStore((s) => s.fetchSensorScans);

  const [selected, setSelected] = useState<{ scan: SensorScanSummary; frame: PointCloudFrame } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

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
      toast.error("Couldn't open scan", { description: errorMessage(error) });
    } finally {
      setLoadingId(null);
    }
  }, []);

  const handleDownload = useCallback(async (scan: SensorScanSummary) => {
    try {
      const buffer = await sensorScansApi.downloadScan(scan.id);
      downloadBlob(
        new Blob([buffer], { type: 'application/octet-stream' }),
        `${scan.sensorName}-${scan.id.slice(0, 8)}.pcd`,
      );
    } catch (error) {
      toast.error("Couldn't download scan", { description: errorMessage(error) });
    }
  }, []);

  const handleDelete = useCallback(
    async (scan: SensorScanSummary) => {
      const ok = await confirm({
        title: `Delete ${scanName(scan)}?`,
        description: 'The recorded point cloud is removed from the server. The live view is not affected.',
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await sensorScansApi.deleteScan(scan.id);
        if (selected?.scan.id === scan.id) setSelected(null);
        await fetchSensorScans(robotId);
        toast.success('Scan deleted', { description: scanName(scan) });
      } catch (error) {
        toast.error("Couldn't delete scan", { description: errorMessage(error) });
      }
    },
    [robotId, selected, fetchSensorScans],
  );

  if (scans.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<ScanLine />}
        title="No recorded scans yet"
        description="Capture a scan from the live point cloud above."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {selected && (
        <Panel variant="inset" padding="none" className="relative h-[280px]">
          <PointCloudViewer frame={selected.frame} showRobotModel={false} colorMode="height" />
          <div className="absolute right-2 top-2 z-10 flex items-center gap-2 rounded-control border border-line bg-panel py-1 pl-3 pr-1">
            <span className="text-xs text-ink-secondary">{scanName(selected.scan)}</span>
            <Button variant="ghost" size="sm" iconOnly aria-label="Close preview" onClick={() => setSelected(null)}>
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </Panel>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {scans.map((scan) => (
          <li key={scan.id}>
            <Panel variant="inset" padding="sm" className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-primary">{scan.sensorName}</p>
                  <p className="text-[13px] text-ink-tertiary">
                    {new Date(scan.capturedAt).toLocaleString(UI_DATE_LOCALE)}
                  </p>
                </div>
                <RowActions
                  label={`Actions for ${scanName(scan)}`}
                  items={[
                    { label: 'Download', icon: <Download />, onSelect: () => void handleDownload(scan) },
                    {
                      label: 'Delete',
                      icon: <Trash2 />,
                      tone: 'danger',
                      separatorBefore: true,
                      onSelect: () => void handleDelete(scan),
                    },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-ink-secondary">
                <StatusTag tone="neutral">{scan.sensorType === 'lidar' ? 'LiDAR' : 'Depth'}</StatusTag>
                <span>{scan.pointCount.toLocaleString(UI_DATE_LOCALE)} points</span>
                <span className="text-ink-muted">·</span>
                <span>{formatBytes(scan.fileSize)}</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-auto self-start"
                leftIcon={<Eye className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => void handleView(scan)}
                isLoading={loadingId === scan.id}
                loadingText="Opening…"
              >
                View
              </Button>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
