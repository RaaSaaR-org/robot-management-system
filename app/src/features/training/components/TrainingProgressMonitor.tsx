/**
 * @file TrainingProgressMonitor.tsx
 * @description Live state of one training run: progress, metrics, loss curve and hyperparameters
 * @feature training
 */

import { KeyValueList, ProgressBar, StatTile, StatRow } from '@/shared/components/ui';
import { LossCurveChart } from './LossCurveChart';
import type { TrainingJob } from '../types';
import { formatDuration, isActiveJob, progressLabel } from './jobs/jobFormat';

export interface TrainingProgressMonitorProps {
  job: TrainingJob;
  /** @deprecated Cancelling lives in the job detail footer now; ignored. */
  onCancel?: () => void;
  showLossCurve?: boolean;
}

function last<T>(arr: T[] | undefined): T | undefined {
  return arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
}

const fmt = {
  loss: (v?: number) => (v === undefined ? '—' : v.toFixed(4)),
  pct: (v?: number) => (v === undefined ? '—' : `${(v * 100).toFixed(0)}`),
};

function eta(job: TrainingJob): string {
  if (job.status !== 'running' || !job.startedAt || !job.progress) return '—';
  const elapsed = Date.now() - new Date(job.startedAt).getTime();
  const remaining = (elapsed / job.progress) * 100 - elapsed;
  return remaining <= 0 ? 'Almost done' : formatDuration(remaining);
}

/** Section content for the job detail: no card of its own, the modal is the surface. */
export function TrainingProgressMonitor({ job, showLossCurve = true }: TrainingProgressMonitorProps) {
  const active = isActiveJob(job);
  const terminal = !active;
  // A finished job's elapsed time is its run duration, not time since start.
  const end = terminal ? new Date(job.completedAt ?? job.updatedAt).getTime() : Date.now();
  const elapsed = job.startedAt ? formatDuration(Math.max(0, end - new Date(job.startedAt).getTime())) : '—';
  const simRl = job.kind === 'sim_rl';
  const hp = job.hyperparameters;

  return (
    <div className="flex flex-col gap-5">
      {active && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-ink-secondary">{progressLabel(job) ?? ''}</span>
            <span className="font-medium text-ink-primary">{job.progress}%</span>
          </div>
          <ProgressBar value={job.progress} showValue={false} />
          {job.currentStep && <p className="text-[13px] text-ink-tertiary">Current step: {job.currentStep}</p>}
        </div>
      )}

      {job.status === 'failed' && job.errorMessage && (
        <div role="alert" className="rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-4 py-3">
          <div className="text-sm font-semibold text-ink-primary">Training failed</div>
          <p className="mt-1 break-words text-sm text-ink-secondary">{job.errorMessage}</p>
        </div>
      )}

      <StatRow columns={4}>
        {simRl ? (
          <>
            <StatTile label="Success rate" value={fmt.pct(job.metrics.success_rate)} unit="%" tone="sim" />
            <StatTile label="Mean reward" value={job.metrics.mean_reward?.toFixed(2) ?? '—'} />
          </>
        ) : job.status === 'completed' ? (
          <>
            <StatTile label="Final loss" value={fmt.loss(job.metrics.final_loss)} tone="success" />
            <StatTile label="Best epoch" value={job.metrics.best_epoch ?? '—'} />
          </>
        ) : (
          <>
            <StatTile label="Training loss" value={fmt.loss(last(job.metrics.training_loss))} />
            <StatTile label="Validation loss" value={fmt.loss(last(job.metrics.validation_loss))} />
          </>
        )}
        <StatTile label="Elapsed" value={elapsed} />
        <StatTile label={terminal ? 'Finished' : 'Time left'} value={terminal ? (job.completedAt ? 'Yes' : '—') : eta(job)} />
      </StatRow>

      {showLossCurve && (job.metrics.training_loss?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-primary">Loss</h3>
          <LossCurveChart metrics={job.metrics} showLearningRate bestEpoch={job.metrics.best_epoch} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink-primary">Hyperparameters</h3>
        <KeyValueList
          columns={3}
          items={[
            { label: 'Learning rate', value: hp.learning_rate },
            { label: 'Batch size', value: hp.batch_size },
            { label: simRl ? 'Iterations' : 'Epochs', value: hp.epochs },
            { label: 'Warmup steps', value: hp.warmup_steps },
            { label: 'LoRA rank', value: hp.lora_rank },
            { label: 'Weight decay', value: hp.weight_decay },
          ]}
        />
      </div>
    </div>
  );
}
