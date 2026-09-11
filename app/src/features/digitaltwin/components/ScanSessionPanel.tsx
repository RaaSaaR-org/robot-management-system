/**
 * @file ScanSessionPanel.tsx
 * @description "Room scan" side panel of the twin viewer: status, frames,
 *   coverage estimate, points, link state, server build progress during
 *   finalize, and the acts — Start sweep (primary) / Stop & build, and Import
 *   scan from a recorded .ply/.pcd file. Results are toasted by the page.
 * @feature digitaltwin
 */

import { memo, useRef } from 'react';
import { Play, Square, Upload } from 'lucide-react';
import { Button, KeyValueList, Panel, ProgressBar, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import type { ScanStatus } from '../types/twin.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface ScanSessionPanelProps {
  robotName: string;
  status: ScanStatus;
  framesCaptured: number;
  coveragePct: number;
  pointCount: number;
  isConnected: boolean;
  /** Server build progress 0..100 (shown during finalize). */
  serverProgress?: number;
  /** Server build stage during finalize. */
  serverStage?: string | null;
  /** True once the rendered cloud is the authoritative server build. */
  isAuthoritative?: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Import a recorded .ply/.pcd file instead of sweeping. */
  onImport?: (file: File) => void;
  importing?: boolean;
}

const STATUS_TAG: Record<ScanStatus, { label: string; tone: StatusTagTone }> = {
  idle: { label: 'Not started', tone: 'neutral' },
  scanning: { label: 'Scanning', tone: 'live' },
  finalizing: { label: 'Building', tone: 'info' },
  done: { label: 'Complete', tone: 'success' },
  error: { label: 'Error', tone: 'danger' },
};

const ICON = 'h-4 w-4';

export const ScanSessionPanel = memo(function ScanSessionPanel({
  robotName, status, framesCaptured, coveragePct, pointCount, isConnected,
  serverProgress = 0, serverStage, isAuthoritative, onStart, onStop,
  onImport, importing = false,
}: ScanSessionPanelProps) {
  const scanning = status === 'scanning';
  const finalizing = status === 'finalizing';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tag = STATUS_TAG[status];
  const live = isConnected && scanning;

  return (
    <Panel data-testid="scan-session-panel">
      <Panel.Header
        title="Room scan"
        description={`Sweeping with ${robotName}`}
        actions={<StatusTag tone={tag.tone} dot pulse={scanning}>{tag.label}</StatusTag>}
      />
      <Panel.Body className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-tertiary">
          On Start the server captures pose-stamped frames while the robot walks a loop, and the LiDAR map fills in.
          {isAuthoritative && ' Showing the server-built cloud.'}
        </p>

        {finalizing ? (
          <ProgressBar value={serverProgress} size="sm" label={`Building twin${serverStage ? ` · ${serverStage}` : ''}`} />
        ) : (
          <ProgressBar value={coveragePct} size="sm" label="Coverage (estimate)" />
        )}

        <KeyValueList
          columns={2}
          items={[
            { label: 'Frames', value: <span className="tabular-nums">{framesCaptured}</span> },
            { label: 'Points', value: <span className="tabular-nums">{pointCount.toLocaleString(UI_DATE_LOCALE)}</span> },
            {
              label: 'Link',
              value: live ? <StatusTag tone="live" dot pulse>Live</StatusTag> : <StatusTag tone="neutral" dot>Idle</StatusTag>,
            },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          {!scanning ? (
            <Button leftIcon={<Play className={ICON} strokeWidth={1.75} />} onClick={onStart} disabled={finalizing || importing}>
              {status === 'done' ? 'Scan again' : 'Start sweep'}
            </Button>
          ) : (
            <Button variant="secondary" leftIcon={<Square className={ICON} strokeWidth={1.75} />} onClick={onStop}>
              Stop and build
            </Button>
          )}
          {onImport && !scanning && (
            <Button
              variant="secondary"
              leftIcon={<Upload className={ICON} strokeWidth={1.75} />}
              disabled={finalizing}
              isLoading={importing}
              loadingText="Importing…"
              onClick={() => fileInputRef.current?.click()}
              title="Import a recorded point cloud (.ply / .pcd) — e.g. a real LiDAR capture — and build the twin from it"
            >
              Import scan
            </Button>
          )}
        </div>

        {onImport && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ply,.pcd"
              className="hidden"
              data-testid="scan-import-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
            {!scanning && !finalizing && (
              <p className="text-xs text-ink-tertiary">
                Have a recorded room scan? Import scan builds the twin from a real .ply or .pcd capture — no sweep needed.
              </p>
            )}
          </>
        )}
      </Panel.Body>
    </Panel>
  );
});
