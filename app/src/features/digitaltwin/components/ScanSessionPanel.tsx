/**
 * @file ScanSessionPanel.tsx
 * @description Controls + live status for a digital-twin sweep: Start/Stop,
 *   frames captured (server-authoritative when available), coverage estimate,
 *   server build progress + stage during finalize, and a connection dot. Drive
 *   the G1 around the room while it scans and watch the room fill in.
 * @feature digitaltwin
 */

import { memo, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button, Badge } from '@/shared/components/ui';
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
  importError?: string | null;
}

const STATUS_LABEL: Record<ScanStatus, string> = {
  idle: 'Ready',
  scanning: 'Scanning…',
  finalizing: 'Building…',
  done: 'Complete',
  error: 'Error',
};

export const ScanSessionPanel = memo(function ScanSessionPanel({
  robotName, status, framesCaptured, coveragePct, pointCount, isConnected,
  serverProgress = 0, serverStage, isAuthoritative, onStart, onStop,
  onImport, importing = false, importError,
}: ScanSessionPanelProps) {
  const scanning = status === 'scanning';
  const finalizing = status === 'finalizing';
  const busy = scanning || finalizing;
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg border border-theme bg-theme-surface p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-theme-primary">Room scan</h3>
          <Badge variant={scanning ? 'turquoise' : 'default'} size="sm">{STATUS_LABEL[status]}</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-theme-tertiary">
          <span className={`inline-block w-2 h-2 rounded-full ${isConnected && scanning ? 'bg-green-400' : 'bg-surface-500'}`} />
          {isConnected && scanning ? 'Live' : 'Idle'}
        </div>
      </div>

      <p className="text-xs text-theme-tertiary">
        Sweeping with <span className="text-theme-secondary font-medium">{robotName}</span>. On Start the server
        captures pose-stamped frames while the robot walks a loop and the LiDAR map fills in.
        {isAuthoritative && <span className="text-turquoise"> Showing the server-built cloud.</span>}
      </p>

      {/* Coverage (scanning) */}
      {!finalizing && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-theme-tertiary">
            <span>Coverage (est.)</span>
            <span>{coveragePct}%</span>
          </div>
          <div className="h-2 rounded bg-theme-secondary/20 overflow-hidden">
            <div className="h-full bg-cobalt transition-all" style={{ width: `${coveragePct}%` }} />
          </div>
        </div>
      )}

      {/* Build progress (finalizing) */}
      {finalizing && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-theme-tertiary">
            <span>Building twin{serverStage ? ` · ${serverStage}` : ''}</span>
            <span>{serverProgress}%</span>
          </div>
          <div className="h-2 rounded bg-theme-secondary/20 overflow-hidden">
            <div className="h-full bg-turquoise transition-all" style={{ width: `${serverProgress}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-theme-tertiary">
        <span>Frames: <span className="text-theme-secondary font-mono">{framesCaptured}</span></span>
        <span>Points: <span className="text-theme-secondary font-mono">{pointCount.toLocaleString(UI_DATE_LOCALE)}</span></span>
      </div>

      <div className="flex gap-2">
        {!scanning ? (
          <Button variant="primary" size="sm" onClick={onStart} disabled={finalizing || importing}>
            {status === 'done' ? 'Re-scan' : 'Start sweep'}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onStop} disabled={!busy}>
            Stop &amp; build
          </Button>
        )}
        {onImport && !scanning && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Upload className="w-3.5 h-3.5" />}
            disabled={finalizing || importing}
            onClick={() => fileInputRef.current?.click()}
            title="Import a recorded point cloud (.ply / .pcd) — e.g. a real LiDAR capture — and build the twin from it"
          >
            {importing ? 'Importing…' : 'Import scan'}
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
          {importError && (
            <p className="text-xs text-red-400" role="alert">{importError}</p>
          )}
          {!scanning && !finalizing && (
            <p className="text-[11px] text-theme-tertiary">
              Have a recorded room scan? <span className="text-theme-secondary">Import scan</span> builds
              the twin from a real .ply/.pcd capture — no sweep needed.
            </p>
          )}
        </>
      )}
    </div>
  );
});
