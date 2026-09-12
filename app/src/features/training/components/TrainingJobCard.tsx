/**
 * @file TrainingJobCard.tsx
 * @description Compact card for one training job: name, status, datasets, progress, export
 * @feature training
 */

import { Download } from 'lucide-react';
import { Button, Panel, ProgressBar, StatusTag } from '@/shared/components/ui';
import type { TrainingJob } from '../types';
import { JobMixture } from './jobs/JobMixture';
import { RunExportNotice } from './jobs/RunExportNotice';
import { useRunExport } from './jobs/useRunExport';
import { formatRelative, isActiveJob, jobDisplayName, methodLabel, progressLabel, shortId } from './jobs/jobFormat';

export interface TrainingJobCardProps {
  job: TrainingJob;
  onClick?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  selected?: boolean;
  className?: string;
}

/**
 * Card view of a training job. The Jobs tab lists jobs in a table; this card
 * is the compact form for other surfaces (and keeps the export flow).
 */
export function TrainingJobCard({ job, onClick, onCancel, onRetry, selected, className }: TrainingJobCardProps) {
  const active = isActiveJob(job);
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const { isExporting, warnings, error, exportRun } = useRunExport(job.id);
  const step = progressLabel(job);

  return (
    <Panel
      interactive={!!onClick}
      onClick={onClick}
      padding="sm"
      className={['flex flex-col gap-3', selected ? 'border-primary' : '', className ?? ''].join(' ')}
    >
      <div className="flex items-start justify-between gap-2" data-testid="training-job-header">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-primary">{jobDisplayName(job)}</div>
          <div className="flex items-center gap-2 text-[13px] text-ink-tertiary">
            {job.kind === 'sim_rl' && (
              <StatusTag tone="sim" data-testid="job-kind-badge">Sim-RL</StatusTag>
            )}
            <span>{methodLabel(job)}</span>
            <span className="font-mono text-xs" title={job.id}>{shortId(job.id)}</span>
          </div>
        </div>
        <StatusTag status={job.status} dot pulse={job.status === 'running'} />
      </div>

      <JobMixture members={job.datasets ?? []} />

      {active && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-ink-secondary">
            <span>{step ?? ''}</span>
            <span>{job.progress}%</span>
          </div>
          <ProgressBar value={job.progress} size="sm" showValue={false} />
        </div>
      )}

      {job.status === 'failed' && job.errorMessage && (
        <p className="line-clamp-2 text-sm text-signal-stopped">{job.errorMessage}</p>
      )}

      <RunExportNotice warnings={warnings} error={error} />

      <div className="flex items-center justify-between gap-2 border-t border-line-subtle pt-3">
        <span className="text-xs text-ink-tertiary">
          {job.startedAt ? `Started ${formatRelative(job.startedAt)}` : `Created ${formatRelative(job.createdAt)}`}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            isLoading={isExporting}
            leftIcon={<Download className="h-4 w-4" strokeWidth={1.75} />}
            onClick={(e) => {
              e.stopPropagation();
              void exportRun();
            }}
          >
            Export run
          </Button>
          {active && onCancel && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onCancel(); }}>
              Cancel
            </Button>
          )}
          {canRetry && onRetry && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRetry(); }}>
              Retry
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
