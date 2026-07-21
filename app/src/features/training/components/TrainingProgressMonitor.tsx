/**
 * @file TrainingProgressMonitor.tsx
 * @description Real-time training progress display with WebSocket updates
 * @feature training
 */

import { Card, ProgressBar, Badge, Spinner } from '@/shared/components/ui';
import { LossCurveChart } from './LossCurveChart';
import type { TrainingJob, TrainingJobStatus } from '../types';
import { simRlTrainerLabel } from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface TrainingProgressMonitorProps {
  job: TrainingJob;
  onCancel?: () => void;
  showLossCurve?: boolean;
}

const statusConfig: Record<
  TrainingJobStatus,
  { label: string; variant: 'default' | 'info' | 'warning' | 'success' | 'error'; animate?: boolean }
> = {
  pending: { label: 'Pending', variant: 'default' },
  queued: { label: 'Queued', variant: 'info' },
  running: { label: 'Running', variant: 'warning', animate: true },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'default' },
};

// Proper-cased fine-tune labels (was raw .toUpperCase() → "LORA").
const fineTuneLabels: Record<string, string> = {
  lora: 'LoRA',
  full: 'Full',
  frozen_backbone: 'Frozen Backbone',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function calculateETA(job: TrainingJob): string | null {
  if (job.status !== 'running' || !job.startedAt || !job.progress || job.progress === 0) {
    return null;
  }

  const elapsed = Date.now() - new Date(job.startedAt).getTime();
  const estimatedTotal = (elapsed / job.progress) * 100;
  const remaining = estimatedTotal - elapsed;

  if (remaining <= 0) return 'Almost done';
  return formatDuration(remaining);
}

function getLastElement<T>(arr: T[] | undefined): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[arr.length - 1];
}

/**
 * Real-time training progress monitor
 */
export function TrainingProgressMonitor({
  job,
  onCancel,
  showLossCurve = true,
}: TrainingProgressMonitorProps) {
  const status = statusConfig[job.status];
  const eta = calculateETA(job);
  // For terminal jobs, "Elapsed" is the actual run duration (completedAt −
  // startedAt), not wall-clock time since start — which keeps growing forever.
  const isTerminal =
    job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  const elapsedEnd = isTerminal
    ? new Date(job.completedAt ?? job.updatedAt).getTime()
    : Date.now();
  const elapsed = job.startedAt
    ? formatDuration(Math.max(0, elapsedEnd - new Date(job.startedAt).getTime()))
    : null;

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-theme-primary">Training Progress</h3>
            <Badge variant={status.variant} dot={status.animate} dotPulse={status.animate}>
              {status.label}
            </Badge>
          </div>
          {job.status === 'running' && onCancel && (
            <button
              onClick={onCancel}
              className="text-sm text-red-400 hover:text-red-300 font-medium rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
            >
              Cancel Job
            </button>
          )}
        </div>
      </Card.Header>

      <Card.Body className="space-y-6">
        {/* Job info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-sm text-theme-tertiary">Model</span>
            <p className="font-medium text-theme-primary">
              {job.kind === 'sim_rl' ? 'Sim-RL policy' : (job.baseModel ?? 'vla').toUpperCase()}
            </p>
          </div>
          <div>
            <span className="text-sm text-theme-tertiary">Method</span>
            <p className="font-medium text-theme-primary">
              {job.kind === 'sim_rl'
                ? simRlTrainerLabel(job.metrics.trainer)
                : (fineTuneLabels[job.fineTuneMethod ?? ''] ??
                  (job.fineTuneMethod ?? '').toUpperCase())}
            </p>
          </div>
          <div>
            <span className="text-sm text-theme-tertiary">Elapsed</span>
            <p className="font-medium text-theme-primary">{elapsed || '—'}</p>
          </div>
          <div>
            <span className="text-sm text-theme-tertiary">ETA</span>
            <p className="font-medium text-theme-primary">{eta || '—'}</p>
          </div>
        </div>

        {/* Progress bar */}
        {(job.status === 'running' || job.status === 'queued') && (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-theme-secondary">
                {job.currentEpoch !== undefined && job.totalEpochs
                  ? `${job.kind === 'sim_rl' ? 'Iteration' : 'Epoch'} ${job.currentEpoch} of ${job.totalEpochs}`
                  : job.status === 'queued'
                    ? 'Waiting for a worker...'
                    : 'Initializing...'}
              </span>
              <span className="font-medium text-theme-primary">{job.progress}%</span>
            </div>
            <ProgressBar value={job.progress} />

            {job.currentStep && (
              <p className="mt-2 text-sm text-theme-secondary">
                Current step: {job.currentStep}
              </p>
            )}
          </div>
        )}

        {/* Loading state for queued */}
        {job.status === 'queued' && (
          <div className="flex items-center justify-center py-4">
            <Spinner size="md" />
            <span className="ml-3 text-theme-secondary">Waiting in queue...</span>
          </div>
        )}

        {/* Loss curve */}
        {showLossCurve &&
          job.status === 'running' &&
          job.metrics.training_loss &&
          job.metrics.training_loss.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-theme-primary mb-3">Loss Curve</h4>
              <LossCurveChart
                metrics={job.metrics}
                height={250}
                showLearningRate={true}
                bestEpoch={job.metrics.best_epoch}
              />
            </div>
          )}

        {/* Current metrics — sim-RL reports reward/success, supervised reports loss */}
        {job.status === 'running' && job.kind === 'sim_rl' && (
          <div className="grid grid-cols-3 gap-4 p-4 bg-theme-secondary/10 rounded-lg">
            <MetricDisplay
              label="Success Rate"
              value={job.metrics.success_rate}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              highlight
            />
            <MetricDisplay
              label="Mean Reward"
              value={job.metrics.mean_reward}
              format={(v) => v.toFixed(2)}
            />
            <MetricDisplay
              label="Timesteps"
              value={job.metrics.total_timesteps}
              format={(v) => v.toLocaleString(UI_DATE_LOCALE)}
            />
          </div>
        )}
        {job.status === 'running' && job.kind !== 'sim_rl' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-theme-secondary/10 rounded-lg">
            <MetricDisplay
              label="Training Loss"
              value={getLastElement(job.metrics.training_loss)}
              format={(v) => v.toFixed(4)}
            />
            <MetricDisplay
              label="Validation Loss"
              value={getLastElement(job.metrics.validation_loss)}
              format={(v) => v.toFixed(4)}
            />
            <MetricDisplay
              label="Learning Rate"
              value={getLastElement(job.metrics.learning_rate)}
              format={(v) => v.toExponential(2)}
            />
            <MetricDisplay
              label="Accuracy"
              value={getLastElement(job.metrics.accuracy)}
              format={(v) => `${(v * 100).toFixed(1)}%`}
            />
          </div>
        )}

        {/* Final metrics — sim-RL */}
        {job.status === 'completed' && job.kind === 'sim_rl' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <MetricDisplay
              label="Success Rate"
              value={job.metrics.success_rate}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              highlight
            />
            <MetricDisplay
              label="Mean Reward"
              value={job.metrics.mean_reward}
              format={(v) => v.toFixed(2)}
            />
            <MetricDisplay
              label="Timesteps"
              value={job.metrics.total_timesteps}
              format={(v) => v.toLocaleString(UI_DATE_LOCALE)}
            />
            <MetricDisplay
              label="Training Time"
              value={
                job.startedAt && job.completedAt
                  ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
                  : null
              }
              format={(v) => formatDuration(v)}
            />
          </div>
        )}

        {/* Final metrics — supervised */}
        {job.status === 'completed' && job.kind !== 'sim_rl' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
              <MetricDisplay
                label="Final Loss"
                value={job.metrics.final_loss}
                format={(v) => v.toFixed(4)}
                highlight
              />
              <MetricDisplay
                label="Best Epoch"
                value={job.metrics.best_epoch}
                format={(v) => v.toString()}
              />
              <MetricDisplay
                label="Training Time"
                value={
                  job.startedAt && job.completedAt
                    ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
                    : null
                }
                format={(v) => formatDuration(v)}
              />
              <MetricDisplay
                label="Model Version"
                value={job.modelVersionId?.slice(0, 8)}
                format={(v) => String(v)}
              />
            </div>

            {showLossCurve && job.metrics.training_loss && job.metrics.training_loss.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-theme-primary mb-3">Training History</h4>
                <LossCurveChart
                  metrics={job.metrics}
                  height={250}
                  showLearningRate={true}
                  bestEpoch={job.metrics.best_epoch}
                />
              </div>
            )}
          </div>
        )}

        {/* Error for failed */}
        {job.status === 'failed' && job.errorMessage && (
          <div role="alert" className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <h4 className="font-medium text-red-400 mb-2">Training failed</h4>
            <p className="text-sm text-red-300">{job.errorMessage}</p>
          </div>
        )}

        {/* Hyperparameters summary */}
        <div>
          <h4 className="text-sm font-medium text-theme-primary mb-2">Hyperparameters</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 bg-theme-secondary/10 rounded">
              LR: {job.hyperparameters.learning_rate}
            </span>
            <span className="px-2 py-1 bg-theme-secondary/10 rounded">
              Batch: {job.hyperparameters.batch_size}
            </span>
            <span className="px-2 py-1 bg-theme-secondary/10 rounded">
              {job.kind === 'sim_rl' ? 'Iterations' : 'Epochs'}: {job.hyperparameters.epochs}
            </span>
            {job.hyperparameters.lora_rank && (
              <span className="px-2 py-1 bg-theme-secondary/10 rounded">
                LoRA Rank: {job.hyperparameters.lora_rank}
              </span>
            )}
            {job.hyperparameters.warmup_steps && (
              <span className="px-2 py-1 bg-theme-secondary/10 rounded">
                Warmup: {job.hyperparameters.warmup_steps}
              </span>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

interface MetricDisplayProps {
  label: string;
  value: number | string | null | undefined;
  format: (value: number) => string;
  highlight?: boolean;
}

function MetricDisplay({ label, value, format, highlight }: MetricDisplayProps) {
  const formattedValue =
    value !== undefined && value !== null
      ? typeof value === 'number'
        ? format(value)
        : String(value)
      : '—';

  return (
    <div>
      <span className="text-sm text-theme-tertiary">{label}</span>
      <p className={`font-medium ${highlight ? 'text-green-400' : 'text-theme-primary'}`}>
        {formattedValue}
      </p>
    </div>
  );
}
