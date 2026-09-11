/**
 * @file ExportPanel.tsx
 * @description Export panel for a built twin: download the Nav2 keep-out
 *   costmap filter (.pgm + .yaml), the VDA5050 graph (.json) and the robot's
 *   place graph (places/_index.json, TASK-200). Fetches each artifact as a
 *   blob via the API client (so auth headers ride along), triggers a browser
 *   download, and toasts the result.
 * @feature digitaltwin
 */

import { memo, useCallback, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Panel, toast } from '@/shared/components/ui';
import { downloadBlob } from '@/features/robots/utils/pointcloud';
import { twinApi } from '../api/twinApi';

export interface ExportPanelProps {
  twinId: string;
  /** Base filename (defaults to the twin id). */
  baseName?: string;
  /** Disable the grid-based exports until the twin has a built occupancy grid. */
  disabled?: boolean;
  /** Number of keep-out zones masked into the Nav2 export. */
  keepoutCount?: number;
  /** Total authored zones (context line). */
  zoneCount?: number;
  /** Occupancy grid size in px (context line). */
  gridSize?: { w: number; h: number } | null;
}

type ExportKind = 'nav2' | 'vda5050' | 'places';

export const ExportPanel = memo(function ExportPanel({
  twinId, baseName, disabled, keepoutCount = 0, zoneCount = 0, gridSize,
}: ExportPanelProps) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const name = baseName || twinId;

  const run = useCallback(async (kind: ExportKind, label: string, work: () => Promise<void>) => {
    setBusy(kind);
    try {
      await work();
      toast.success(`${label} exported`, { description: name });
    } catch (e) {
      toast.error(`Couldn't export ${label}`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }, [name]);

  const exports: { kind: ExportKind; label: string; hint: string; gated: boolean; work: () => Promise<void> }[] = [
    {
      kind: 'nav2',
      label: 'Nav2 keep-out',
      hint: 'Costmap filter mask (.pgm + .yaml) with every keep-out zone.',
      gated: true,
      work: async () => {
        const [pgm, yaml] = await Promise.all([twinApi.downloadKeepoutPgm(twinId), twinApi.downloadKeepoutYaml(twinId)]);
        downloadBlob(pgm, `${name}-nav2-keepout.pgm`);
        downloadBlob(yaml, `${name}-nav2-keepout.yaml`);
      },
    },
    {
      kind: 'vda5050',
      label: 'VDA5050 graph',
      hint: 'Nodes and edges for a fleet manager (.json).',
      gated: true,
      work: async () => downloadBlob(await twinApi.downloadVda5050(twinId), `${name}-vda5050.json`),
    },
    {
      // Not gated on the occupancy grid: places come from the authored zones
      // alone, and a site can have a usable place graph before it has a map.
      kind: 'places',
      label: 'Robot place graph',
      hint: 'The rooms and keep-outs the robot names out loud (.json).',
      gated: false,
      work: async () => downloadBlob(await twinApi.downloadPlaceGraph(twinId), `${name}-places.json`),
    },
  ];

  return (
    <Panel>
      <Panel.Header
        title="Export"
        description={
          disabled
            ? 'Grid exports unlock once the occupancy grid is built.'
            : `${keepoutCount} keep-out${keepoutCount === 1 ? '' : 's'}${zoneCount > keepoutCount ? ` · ${zoneCount} zones total` : ''}${gridSize ? ` · grid ${gridSize.w} × ${gridSize.h}` : ''}`
        }
      />
      <Panel.Body>
        <ul className="flex flex-col divide-y divide-line-subtle">
          {exports.map((x) => (
            <li key={x.kind} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink-primary">{x.label}</div>
                <div className="text-xs text-ink-tertiary">{x.hint}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Download className="h-4 w-4" strokeWidth={1.75} />}
                disabled={(x.gated && disabled) || (busy !== null && busy !== x.kind)}
                isLoading={busy === x.kind}
                aria-label={`Download ${x.label}`}
                onClick={() => void run(x.kind, x.label, x.work)}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      </Panel.Body>
    </Panel>
  );
});
