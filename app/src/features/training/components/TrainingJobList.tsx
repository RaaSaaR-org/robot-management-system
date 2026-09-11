/**
 * @file TrainingJobList.tsx
 * @description Training jobs as a DataTable: name first, short id secondary, status, progress, created
 * @feature training
 */

import type { ReactNode } from 'react';
import { Ban, ExternalLink, RotateCcw } from 'lucide-react';
import {
  DataTable,
  ProgressBar,
  StatusTag,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import type { TrainingJob } from '../types';
import { formatRelative, isActiveJob, jobDisplayName, methodLabel, progressLabel, shortId } from './jobs/jobFormat';

export interface TrainingJobListProps {
  jobs: TrainingJob[];
  isLoading?: boolean;
  error?: string | null;
  onRetryLoad?: () => void;
  selectedId?: string;
  onSelect?: (job: TrainingJob) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  /** Rendered when `jobs` is empty (the page decides: empty vs filtered-empty). */
  empty?: ReactNode;
  /** @deprecated Filtering lives in the page toolbar now; ignored. */
  showFilters?: boolean;
  /** @deprecated The page renders its own EmptyState; ignored. */
  hideEmpty?: boolean;
}

const icon = 'h-4 w-4';

/** The Jobs tab's table. Row click opens the job detail. */
export function TrainingJobList({
  jobs,
  isLoading,
  error,
  onRetryLoad,
  onSelect,
  onCancel,
  onRetry,
  empty,
}: TrainingJobListProps) {
  const columns: DataTableColumn<TrainingJob>[] = [
    {
      key: 'name',
      header: 'Job',
      sortable: true,
      sortValue: (j) => jobDisplayName(j),
      cell: (j) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-primary">{jobDisplayName(j)}</div>
          <div className="flex items-center gap-2 text-xs text-ink-tertiary">
            {j.kind === 'sim_rl' && <StatusTag tone="sim" size="sm">Sim-RL</StatusTag>}
            <span className="font-mono" title={j.id}>{shortId(j.id)}</span>
          </div>
        </div>
      ),
    },
    { key: 'method', header: 'Method', hideBelow: 'md', cell: (j) => methodLabel(j) || '—' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (j) => j.status,
      cell: (j) => <StatusTag status={j.status} dot pulse={j.status === 'running'} />,
    },
    {
      key: 'progress',
      header: 'Progress',
      hideBelow: 'sm',
      width: '180px',
      sortable: true,
      sortValue: (j) => j.progress,
      cell: (j) =>
        isActiveJob(j) || j.status === 'completed' ? (
          <div className="flex min-w-[120px] flex-col gap-1">
            <ProgressBar value={j.progress} size="sm" showValue={false} />
            <span className="text-xs text-ink-tertiary">
              {j.status === 'completed' ? 'Done' : progressLabel(j) ?? `${j.progress}%`}
            </span>
          </div>
        ) : null,
    },
    {
      key: 'createdAt',
      header: 'Created',
      align: 'right',
      hideBelow: 'md',
      sortable: true,
      sortValue: (j) => new Date(j.createdAt),
      cell: (j) => <span title={new Date(j.createdAt).toLocaleString()}>{formatRelative(j.createdAt)}</span>,
    },
  ];

  const rowActions = (j: TrainingJob): RowActionItem[] => {
    const items: RowActionItem[] = [];
    if (onSelect) items.push({ label: 'Open', icon: <ExternalLink className={icon} />, onSelect: () => onSelect(j) });
    if (onRetry && (j.status === 'failed' || j.status === 'cancelled')) {
      items.push({ label: 'Retry', icon: <RotateCcw className={icon} />, onSelect: () => onRetry(j.id) });
    }
    if (onCancel && isActiveJob(j)) {
      items.push({
        label: 'Cancel job',
        icon: <Ban className={icon} />,
        tone: 'danger',
        separatorBefore: items.length > 0,
        onSelect: () => onCancel(j.id),
      });
    }
    return items;
  };

  return (
    <DataTable
      caption="Training jobs"
      columns={columns}
      rows={jobs}
      getRowId={(j) => j.id}
      defaultSort={{ key: 'createdAt', direction: 'desc' }}
      onRowClick={onSelect}
      rowActions={rowActions}
      rowActionsLabel={(j) => `Actions for ${jobDisplayName(j)}`}
      isLoading={isLoading}
      error={error ?? null}
      errorTitle="Couldn't load training jobs"
      onRetry={onRetryLoad}
      empty={empty}
    />
  );
}
