/**
 * @file ModelUploadsPanel.tsx
 * @description Model uploads that are not registered models yet — running,
 *              being finished, or failed — so a checkpoint on its way is
 *              visible before it appears in the registry (TASK-498)
 * @feature deployment
 */

import { useEffect, useRef, useState } from 'react';
import { Badge, Panel } from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { deploymentApi } from '../../api';
import type { ModelUploadSummary } from '../../types';
import { formatArtifactSize, getBaseModelLabel, getVersionLabel } from './modelDisplay';

export interface ModelUploadsPanelProps {
  /** Called when an upload that was open is no longer listed: it became a model, or was cancelled. */
  onSettled?: () => void;
  /** How often the list is re-read while an upload is open. */
  pollMs?: number;
}

const STATE_LABELS: Record<ModelUploadSummary['state'], string> = {
  uploading: 'Uploading',
  processing: 'Verifying',
  completed: 'Registered',
  failed: 'Failed',
  cancelling: 'Cancelling',
};

/**
 * Renders nothing while no upload is open — the usual state of the page.
 */
export function ModelUploadsPanel({ onSettled, pollMs = 5000 }: ModelUploadsPanelProps) {
  const [uploads, setUploads] = useState<ModelUploadSummary[]>([]);
  const known = useRef<Set<string>>(new Set());
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async (): Promise<void> => {
      // A server without the upload API, or a failed read, shows no panel.
      const next = await deploymentApi.listModelUploads().catch(() => [] as ModelUploadSummary[]);
      if (cancelled) return;
      const ids = new Set(next.map((u) => u.uploadId));
      const gone = [...known.current].some((id) => !ids.has(id));
      known.current = ids;
      setUploads(next);
      if (gone) settled.current?.();
      // Only an open upload is worth asking about again.
      if (next.length > 0) timer = setTimeout(() => void read(), pollMs);
    };

    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  if (uploads.length === 0) return null;

  return (
    <Panel as="section" aria-label="Model uploads in progress">
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-primary">Uploads in progress</div>
          <p className="text-[13px] text-ink-tertiary">
            A checkpoint appears in the registry once every file is stored and verified.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-line">
          {uploads.map((upload) => (
            <li key={upload.uploadId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink-primary">{upload.name}</div>
                <div className="truncate text-[13px] text-ink-tertiary">
                  {getVersionLabel(upload.version)}
                  {getBaseModelLabel(upload) ? ` · ${getBaseModelLabel(upload)}` : ''}
                  {` · ${formatArtifactSize(upload.totalBytes)} in ${upload.totalFiles} files`}
                  {` · started ${formatTimeAgo(upload.createdAt)}`}
                </div>
                {upload.state === 'failed' && upload.error && (
                  <div className="text-[13px] text-signal-stopped">{upload.error}</div>
                )}
              </div>
              <Badge variant={upload.state === 'failed' ? 'danger' : 'neutral'} size="sm">
                {STATE_LABELS[upload.state] ?? upload.state}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
