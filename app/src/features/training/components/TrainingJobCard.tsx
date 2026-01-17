/**
 * @file TrainingJobCard.tsx
 * @description Card component displaying training job summary
 * @feature training
 */

import { Card, Badge, ProgressBar, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { TrainingJob, TrainingJobStatus } from '../types';

export interface TrainingJobCardProps {
  job: TrainingJob;
  onClick?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  selected?: boolean;
  className?: string;
}

const statusColors: Record<TrainingJobStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  queued: 'bg-blue-100 text-blue-800',
  running: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
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

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      className={cn(
        'transition-all',
        selected && 'ring-2 ring-primary-500',
        className
      )}
    >
      <Card.Body>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-theme-primary">
                {job.baseModel.toUpperCase()}
              </span>
              <span className="text-theme-tertiary">&bull;</span>
              <span className="text-sm text-theme-secondary">
                {job.fineTuneMethod.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-theme-tertiary mt-1 font-mono truncate">
              {job.id}
            </p>
          </div>
          <Badge className={statusColors[job.status]}>{statusLabels[job.status]}</Badge>
        </div>

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

        {/* Metrics for completed jobs */}
        {job.status === 'completed' && job.metrics.final_loss !== undefined && (
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
          <div className="mt-4 p-2 bg-red-50 rounded text-sm text-red-700 line-clamp-2">
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
            Epochs: {job.hyperparameters.epochs}
          </span>
          {job.hyperparameters.lora_rank && (
            <span className="px-2 py-0.5 bg-theme-secondary/10 rounded">
              LoRA: {job.hyperparameters.lora_rank}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 pt-3 border-t border-theme-secondary/20 flex items-center justify-between">
          <span className="text-xs text-theme-tertiary">
            {job.startedAt
              ? `Started ${new Date(job.startedAt).toLocaleString()}`
              : `Created ${new Date(job.createdAt).toLocaleString()}`}
          </span>
          <div className="flex gap-2">
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
