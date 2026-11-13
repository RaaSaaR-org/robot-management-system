/**
 * @file DatasetProvenance.tsx
 * @description Where a dataset came from, said as provenance (TASK-493):
 *              "Imported from Hugging Face: owner/repo at revision 37cb1d6e",
 *              the repo a link to the exact commit. The bare `owner/repo@commit`
 *              under a dataset's title read like a second name for it.
 * @feature training
 */

import { ExternalLink } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from '@/shared/components/ui/styles';
import type { Dataset } from '../../types';
import { shortRevision } from './importFormat';

/**
 * The Hub page of the dataset at the revision it was imported from, so the
 * link shows the files this instance actually holds, not whatever `main` has
 * become since. Each path segment is encoded — a revision can be `refs/pr/3`.
 */
export function hubDatasetUrl(repoId: string, revision?: string | null): string {
  const repo = repoId.split('/').map(encodeURIComponent).join('/');
  const base = `https://huggingface.co/datasets/${repo}`;
  return revision ? `${base}/tree/${encodeURIComponent(revision)}` : base;
}

export interface DatasetProvenanceProps {
  dataset: Pick<Dataset, 'huggingFaceRepoId' | 'sourceRevision'>;
  className?: string;
}

/** Nothing for a dataset that was not imported from the Hub. */
export function DatasetProvenance({ dataset, className }: DatasetProvenanceProps) {
  const repoId = dataset.huggingFaceRepoId;
  if (!repoId) return null;
  const revision = dataset.sourceRevision ?? null;
  const short = shortRevision(revision);
  return (
    <span
      className={cn('inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs text-ink-tertiary', className)}
      data-testid="dataset-source"
    >
      <span>Imported from Hugging Face:</span>
      <a
        href={hubDatasetUrl(repoId, revision)}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          'inline-flex min-w-0 items-baseline gap-1 break-all rounded-tag font-medium text-ink-secondary underline decoration-line-strong underline-offset-2 hover:text-ink-primary',
          focusRing,
        )}
      >
        {repoId}
        <ExternalLink className="h-3 w-3 shrink-0 self-center" strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">(opens huggingface.co in a new tab)</span>
      </a>
      {short && (
        // The whole commit on hover: eight characters name it, forty identify it.
        <span title={revision ?? undefined}>
          at revision <span className="font-mono">{short}</span>
        </span>
      )}
    </span>
  );
}
