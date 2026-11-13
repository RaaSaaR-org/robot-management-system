/**
 * @file ModelStoredFiles.tsx
 * @description The files this instance stores for a directly uploaded model:
 *              each path with its size, and how to get them back (TASK-498)
 * @feature deployment
 */

import { SkeletonRows } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import type { ModelFileManifest } from '../../types';
import { formatArtifactSize } from './modelDisplay';

export interface ModelStoredFilesProps {
  modelVersionId: string;
  files: ModelFileManifest | null;
  /** The files were removed when the model was deleted. */
  removed: boolean;
  /** When they were removed, if the server said. */
  removedAt?: string | null;
  isLoading: boolean;
  error: string | null;
}

/** Largest first: the weights are what a reader looks for. */
function bySizeDescending(files: ModelFileManifest['files']): ModelFileManifest['files'] {
  return [...files].sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
}

export function ModelStoredFiles({ modelVersionId, files, removed, removedAt, isLoading, error }: ModelStoredFilesProps) {
  if (removed) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-ink-primary">Files</div>
        <p className="text-[13px] text-ink-secondary">
          The stored files were removed when this model was deleted
          {removedAt ? ` (${formatDateTime(removedAt)})` : ''}. The registry entry is kept because deployments,
          evaluations and lineage may point at it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-ink-primary">
          Files{files ? ` (${files.fileCount})` : ''}
        </div>
        {files && <div className="text-[13px] text-ink-tertiary">{formatArtifactSize(files.totalBytes)} in this instance&apos;s storage</div>}
      </div>

      {isLoading && <SkeletonRows rows={3} />}
      {error && <p className="text-[13px] text-signal-stopped">Couldn&apos;t load the file list: {error}</p>}

      {files && (
        <>
          <ul
            aria-label="Stored files"
            className="max-h-56 divide-y divide-line overflow-y-auto rounded-control border border-line"
          >
            {bySizeDescending(files.files).map((file) => (
              <li key={file.path} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                <span className="min-w-0 truncate font-mono text-ink-primary" title={file.path}>{file.path}</span>
                <span className="shrink-0 tabular-nums text-ink-secondary">{formatArtifactSize(file.size)}</span>
              </li>
            ))}
          </ul>
          {files.nextCursor && (
            <p className="text-[13px] text-ink-tertiary">
              Showing the first {files.files.length} of {files.fileCount} files.
            </p>
          )}
          <p className="text-[13px] text-ink-tertiary">
            Download them with{' '}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-ink-secondary">
              rmsctl models download {modelVersionId}
            </code>
          </p>
        </>
      )}
    </div>
  );
}
