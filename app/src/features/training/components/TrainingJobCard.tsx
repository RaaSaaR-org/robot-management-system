/**
 * @file TrainingJobCard.tsx
 * @description Card component displaying training job summary
 * @feature training
 */

import { useCallback, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { Card, Badge, ProgressBar, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api';
import type { TrainingJob, TrainingJobStatus } from '../types';
import { simRlTrainerLabel } from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface TrainingJobCardProps {
  job: TrainingJob;
  onClick?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  selected?: boolean;
  className?: string;
}

// Dark-first glass badges via the Badge variant API (was light-mode bg-*-100).
const statusVariant: Record<
  TrainingJobStatus,
  'default' | 'info' | 'warning' | 'success' | 'error'
> = {
  pending: 'default',
  queued: 'info',
  running: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// Proper-cased fine-tune labels (was raw .toUpperCase() → "LORA").
const fineTuneLabels: Record<string, string> = {
  lora: 'LoRA',
  full: 'Full',
  frozen_backbone: 'Frozen Backbone',
};

/**
 * Card component for displaying training job summary
 */
export function TrainingJobCard({
  job,
  onClick,
  onCancel,
  onRetry,
  selected,
  className,
}: TrainingJobCardProps) {
  const isRunning = job.status === 'running' || job.status === 'queued';
  const canRetry = job.status === 'failed' || job.status === 'cancelled';

  const [isExporting, setIsExporting] = useState(false);
  const [exportWarnings, setExportWarnings] = useState<string[] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const members = job.datasets ?? [];
  const weightTotal = members.reduce((sum, m) => sum + (m.weight || 0), 0);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const manifest = await trainingApi.exportTrainingRun(job.id);
      // Shown on the card, not only inside the file: "this dataset lives on
      // one laptop and the cluster cannot reach it" is exactly the thing
      // nobody discovers by opening a downloaded JSON.
      setExportWarnings(manifest.warnings ?? []);
      downloadJson(manifest, `neodem-run-${job.id}.json`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export this run');
    } finally {
      setIsExporting(false);
    }
  }, [job.id]);

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      className={cn(
        'transition-all',
        selected && 'ring-2 ring-cobalt-500',
        className
      )}
    >
      <Card.Body>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2" data-testid="training-job-header">
              {job.kind === 'sim_rl' ? (
                <>
                  <Badge variant="purple" data-testid="job-kind-badge">
                    SIM-RL
                  </Badge>
                  <span className="text-sm text-theme-secondary">
                    {simRlTrainerLabel(job.metrics.trainer)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium text-theme-primary">
                    {(job.baseModel ?? 'vla').toUpperCase()}
                  </span>
                  <span className="text-theme-tertiary">&bull;</span>
                  <span className="text-sm text-theme-secondary">
                    {fineTuneLabels[job.fineTuneMethod ?? ''] ??
                      (job.fineTuneMethod ?? '').toUpperCase()}
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-theme-tertiary mt-1 font-mono truncate">
              {job.id}
            </p>
          </div>
          <Badge
            variant={statusVariant[job.status]}
            dot={job.status === 'running'}
            dotPulse={job.status === 'running'}
          >
            {statusLabels[job.status]}
          </Badge>
        </div>

        {/* What the run is actually trained on. A mixture's weights are the
            difference between "both datasets" and "mostly one of them". */}
        {members.length > 0 && (
          <div data-testid="job-mixture" className="mt-3 text-sm">
            <span className="text-theme-tertiary">
              {members.length > 1 ? `Mixture · ${members.length} datasets` : 'Dataset'}
            </span>
            <ul className="mt-1 space-y-0.5">
              {members.map((member) => (
                <li key={member.datasetId} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-theme-primary">{member.name}</span>
                  {members.length > 1 && (
                    <span className="shrink-0 text-xs text-theme-secondary">
                      weight {member.weight}
                      {weightTotal > 0 && ` · ${Math.round((member.weight / weightTotal) * 100)}%`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Progress bar for running jobs */}
        {isRunning && (
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-theme-secondary">
                {job.currentEpoch !== undefined && job.totalEpochs
                  ? `Epoch ${job.currentEpoch}/${job.totalEpochs}`
                  : 'Starting...'}
              </span>
              <span className="font-medium text-theme-primary">{job.progress}%</span>
            </div>
            <ProgressBar value={job.progress} />
          </div>
        )}

        {/* Metrics for completed sim-RL jobs — reward/success, not loss */}
        {job.status === 'completed' && job.kind === 'sim_rl' && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-theme-tertiary">Success Rate</span>
              <p className="font-medium text-green-400">
                {job.metrics.success_rate !== undefined
                  ? `${(job.metrics.success_rate * 100).toFixed(0)}%`
                  : '—'}
              </p>
            </div>
            <div>
              <span className="text-theme-tertiary">Mean Reward</span>
              <p className="font-medium text-theme-primary">
                {job.metrics.mean_reward !== undefined
                  ? job.metrics.mean_reward.toFixed(2)
                  : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Metrics for completed supervised jobs */}
        {job.status === 'completed' &&
          job.kind !== 'sim_rl' &&
          job.metrics.final_loss !== undefined && (
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-theme-tertiary">Final Loss</span>
                <p className="font-medium text-theme-primary">
                  {job.metrics.final_loss.toFixed(4)}
                </p>
              </div>
              {job.metrics.best_epoch !== undefined && (
                <div>
                  <span className="text-theme-tertiary">Best Epoch</span>
                  <p className="font-medium text-theme-primary">{job.metrics.best_epoch}</p>
                </div>
              )}
            </div>
          )}

        {/* Error message for failed jobs */}
        {job.status === 'failed' && job.errorMessage && (
          <div
            role="alert"
            className="mt-4 p-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400 line-clamp-2"
          >
            {job.errorMessage}
          </div>
        )}

        {/* Hyperparameters summary */}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-0.5 bg-theme-secondary/10 rounded">
            LR: {job.hyperparameters.learning_rate}
          </span>
          <span className="px-2 py-0.5 bg-theme-secondary/10 rounded">
            Batch: {job.hyperparameters.batch_size}
          </span>
          <span className="px-2 py-0.5 bg-theme-secondary/10 rounded">
            {job.kind === 'sim_rl' ? 'Iterations' : 'Epochs'}: {job.hyperparameters.epochs}
          </span>
          {job.hyperparameters.lora_rank && (
            <span className="px-2 py-0.5 bg-theme-secondary/10 rounded">
              LoRA: {job.hyperparameters.lora_rank}
            </span>
          )}
        </div>

        {/* Why the exported manifest may not reproduce elsewhere. */}
        {exportWarnings && exportWarnings.length > 0 && (
          <div
            data-testid="export-warnings"
            role="alert"
            className="mt-4 rounded-md bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <ul className="min-w-0 space-y-1">
                {exportWarnings.map((warning) => (
                  <li key={warning} className="break-words">{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {exportWarnings && exportWarnings.length === 0 && (
          <p data-testid="export-clean" className="mt-4 text-sm text-theme-tertiary">
            Exported — every dataset in this run is reachable from another machine.
          </p>
        )}

        {exportError && (
          <div role="alert" className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {exportError}
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 pt-3 border-t border-theme-secondary/20 flex items-center justify-between">
          <span className="text-xs text-theme-tertiary">
            {job.startedAt
              ? `Started ${new Date(job.startedAt).toLocaleString(UI_DATE_LOCALE)}`
              : `Created ${new Date(job.createdAt).toLocaleString(UI_DATE_LOCALE)}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              isLoading={isExporting}
              onClick={(e) => {
                e.stopPropagation();
                void handleExport();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export run
            </Button>
            {isRunning && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
              >
                Cancel
              </Button>
            )}
            {canRetry && onRetry && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
              >
                Retry
              </Button>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

/**
 * Hand the manifest to the browser as a file.
 *
 * The warnings are put on the card before this runs, so a browser that refuses
 * the download costs the file and not what the file had to say. The revoke is
 * in a `finally` because an object URL otherwise lives as long as the document.
 */
function downloadJson(payload: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  );
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
