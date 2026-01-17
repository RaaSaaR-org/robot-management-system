/**
 * @file TrainingProgressMonitor.tsx
 * @description Real-time training progress display with WebSocket updates
 * @feature training
 */

import { Card, ProgressBar, Badge, Spinner } from '@/shared/components/ui';
import { LossCurveChart } from './LossCurveChart';
import type { TrainingJob, TrainingJobStatus } from '../types';

export interface TrainingProgressMonitorProps {
  job: TrainingJob;
  onCancel?: () => void;
  showLossCurve?: boolean;
}

const statusConfig: Record<TrainingJobStatus, { label: string; color: string; animate?: boolean }> = {
  pending: { label: 'Pending', color: 'bg-gray-100 text-gray-800' },
  queued: { label: 'Queued', color: 'bg-blue-100 text-blue-800' },
  running: { label: 'Running', color: 'bg-yellow-100 text-yellow-800', animate: true },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800' },
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
  const elapsed = job.startedAt
    ? formatDuration(Date.now() - new Date(job.startedAt).getTime())
    : null;

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-theme-primary">Training Progress</h3>
            <Badge className={status.color}>
              {status.animate && (
                <span className="mr-1.5 inline-block w-2 h-2 bg-current rounded-full animate-pulse" />
              )}
              {status.label}
            </Badge>
          </div>
          {job.status === 'running' && onCancel && (
            <button
              onClick={onCancel}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
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
            <p className="font-medium text-theme-primary">{job.baseModel.toUpperCase()}</p>
          </div>
          <div>
            <span className="text-sm text-theme-tertiary">Method</span>
            <p className="font-medium text-theme-primary">{job.fineTuneMethod.toUpperCase()}</p>
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
                  ? `Epoch ${job.currentEpoch} of ${job.totalEpochs}`
                  : job.status === 'queued'
                    ? 'Waiting for GPU...'
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

        {/* Current metrics */}
        {job.status === 'running' && (
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

        {/* Final metrics for completed */}
        {job.status === 'completed' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-green-50 rounded-lg">
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
          <div className="p-4 bg-red-50 rounded-lg">
            <h4 className="font-medium text-red-800 mb-2">Training Failed</h4>
            <p className="text-sm text-red-700">{job.errorMessage}</p>
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
              Epochs: {job.hyperparameters.epochs}
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
      <p className={`font-medium ${highlight ? 'text-green-700' : 'text-theme-primary'}`}>
        {formattedValue}
      </p>
    </div>
  );
}
