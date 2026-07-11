/**
 * @file ExportPanel.tsx
 * @description Export controls for a built twin: download the Nav2 keep-out
 *   costmap filter (.pgm + .yaml) and the VDA5050 graph (.json). Fetches each
 *   artifact as a blob via the API client (so auth headers ride along) and
 *   triggers a browser download.
 * @feature digitaltwin
 */

import { memo, useCallback, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { downloadBlob } from '@/features/robots/utils/pointcloud';
import { twinApi } from '../api/twinApi';

export interface ExportPanelProps {
  twinId: string;
  /** Base filename (defaults to the twin id). */
  baseName?: string;
  /** Disable exports until the twin has a built occupancy grid. */
  disabled?: boolean;
  /** Number of keep-out zones masked into the Nav2 export. */
  keepoutCount?: number;
  /** Total authored zones (context line). */
  zoneCount?: number;
  /** Occupancy grid size in px (context line). */
  gridSize?: { w: number; h: number } | null;
}

export const ExportPanel = memo(function ExportPanel({
  twinId, baseName, disabled, keepoutCount = 0, zoneCount = 0, gridSize,
}: ExportPanelProps) {
  const [busy, setBusy] = useState<'nav2' | 'vda5050' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = baseName || twinId;

  const exportNav2 = useCallback(async () => {
    setBusy('nav2');
    setError(null);
    try {
      const [pgm, yaml] = await Promise.all([
        twinApi.downloadKeepoutPgm(twinId),
        twinApi.downloadKeepoutYaml(twinId),
      ]);
      downloadBlob(pgm, `${name}-nav2-keepout.pgm`);
      downloadBlob(yaml, `${name}-nav2-keepout.yaml`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nav2 export failed');
    } finally {
      setBusy(null);
    }
  }, [twinId, name]);

  const exportVda5050 = useCallback(async () => {
    setBusy('vda5050');
    setError(null);
    try {
      const json = await twinApi.downloadVda5050(twinId);
      downloadBlob(json, `${name}-vda5050.json`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'VDA5050 export failed');
    } finally {
      setBusy(null);
    }
  }, [twinId, name]);

  return (
    <div className="rounded-lg border border-theme bg-theme-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-theme-primary">Export</h3>
      <p className="text-xs text-theme-tertiary">
        Generate deployment artifacts from this twin&apos;s occupancy grid and zones.
      </p>
      {!disabled && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-theme-tertiary font-mono">
          <span>{keepoutCount} keep-out{keepoutCount === 1 ? '' : 's'}</span>
          {zoneCount > keepoutCount && <span>· {zoneCount} zones total</span>}
          {gridSize && <span>· grid {gridSize.w}×{gridSize.h}</span>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Button variant="secondary" size="sm" onClick={() => void exportNav2()} disabled={disabled || busy !== null}>
          {busy === 'nav2' ? 'Exporting…' : 'Nav2 keep-out (.pgm + .yaml)'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void exportVda5050()} disabled={disabled || busy !== null}>
          {busy === 'vda5050' ? 'Exporting…' : 'VDA5050 graph (.json)'}
        </Button>
      </div>
      {disabled && (
        <p className="text-xs text-theme-tertiary">Exports unlock once the occupancy grid is built.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
});
