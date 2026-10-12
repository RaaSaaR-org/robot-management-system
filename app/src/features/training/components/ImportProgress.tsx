/**
 * @file ImportProgress.tsx
 * @description The progress bar of one Hugging Face import (#370): which phase
 *              it is in, a bar measured in bytes where the Hub sized every
 *              file and in files where it did not, the counts beside it — and
 *              an indeterminate bar, never a made-up 0 % or 100 %, where
 *              nothing can be measured (reading metadata, validating).
 * @feature training
 */

import { ProgressBar } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { ImportJob } from '../store/importJobsStore';
import { formatBytes } from './datasets/datasetFormat';

export interface ImportProgressView {
  /** "Reading metadata", "Downloading", "Validating", … */
  phase: string;
  /** 0–100 of the CURRENT phase; null when it cannot be measured */
  percent: number | null;
  /** "1.2 GB / 3.4 GB · 12 / 40 files" */
  counts: string | null;
}

/**
 * What the bar shows for a job. The percent is the download's own, not the
 * server's 10–90 band of the whole import: "Downloading 50 %" means half the
 * bytes are here, and a phase that has nothing to count says so.
 */
export function importProgressView(job: ImportJob): ImportProgressView {
  const files = job.totalFiles ? `${job.completedFiles ?? 0} / ${job.totalFiles} files` : null;
  const bytesKnown = (job.totalBytes ?? 0) > 0;
  const bytes = bytesKnown ? `${formatBytes(job.downloadedBytes ?? 0)} / ${formatBytes(job.totalBytes!)}` : null;
  const counts = [bytes, files].filter(Boolean).join(' · ') || null;
  const scope = job.importMode === 'metadata' ? ' (no videos)' : '';

  if (job.state === 'failed') {
    const where = job.phase ? ` while ${PHASE_LABEL[job.phase].toLowerCase()}` : '';
    return { phase: `Stopped${where}`, percent: downloadPercent(job), counts };
  }
  if (job.state === 'succeeded') return { phase: 'Imported', percent: 100, counts };
  if (job.state === 'cancelled') return { phase: 'Cancelled — its files were removed', percent: 0, counts: null };

  switch (job.phase) {
    case 'downloading':
    case 'storing':
      return { phase: `${PHASE_LABEL[job.phase]}${scope}`, percent: downloadPercent(job), counts };
    case 'validating':
      // Downloaded is not valid: the bar runs until the verdict comes.
      return { phase: 'Validating', percent: null, counts: files ? `${files} downloaded` : null };
    case 'metadata':
      return { phase: PHASE_LABEL.metadata, percent: null, counts: null };
    default:
      return { phase: 'Starting', percent: null, counts: null };
  }
}

const PHASE_LABEL: Record<NonNullable<ImportJob['phase']>, string> = {
  metadata: 'Reading metadata',
  downloading: 'Downloading',
  storing: 'Storing',
  validating: 'Validating',
};

function downloadPercent(job: ImportJob): number | null {
  if ((job.totalBytes ?? 0) > 0) return Math.min(100, ((job.downloadedBytes ?? 0) / job.totalBytes!) * 100);
  if (job.totalFiles) return Math.min(100, ((job.completedFiles ?? 0) / job.totalFiles) * 100);
  return null;
}

export interface ImportProgressProps {
  job: ImportJob;
  /** One line under the bar instead of a label above it — for a table cell */
  compact?: boolean;
  className?: string;
}

export function ImportProgress({ job, compact = false, className }: ImportProgressProps) {
  const view = importProgressView(job);
  const failed = job.state === 'failed';
  // A cancelled import is not still working on something: no moving bar.
  const indeterminate = view.percent === null && !failed && job.state !== 'cancelled';
  const percentText = view.percent === null ? null : `${Math.floor(view.percent)}%`;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)} data-testid={`import-progress-${job.datasetId}`}>
      {!compact && (
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-ink-secondary">{view.phase}</span>
          {percentText && <span className="font-medium tabular-nums text-ink-primary">{percentText}</span>}
        </div>
      )}
      <ProgressBar
        size="sm"
        showValue={false}
        // A failed import's bar stays where it stopped, in red, and stops moving.
        value={view.percent ?? 0}
        variant={failed ? 'error' : 'default'}
        indeterminate={indeterminate}
      />
      {compact ? (
        <span className="truncate text-[11px] tabular-nums text-ink-tertiary" title={view.counts ?? view.phase}>
          {view.phase}
          {percentText && !indeterminate ? ` ${percentText}` : ''}
          {view.counts ? ` · ${view.counts}` : ''}
        </span>
      ) : (
        view.counts && <span className="text-[11px] tabular-nums text-ink-tertiary">{view.counts}</span>
      )}
    </div>
  );
}
