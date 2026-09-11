/**
 * @file jobFormat.ts
 * @description Human names and labels for training jobs — the name first, the id secondary
 * @feature training
 */

import type { BaseModel, TrainingJob } from '../../types';
import { simRlTrainerLabel } from '../../types';

export const BASE_MODEL_LABELS: Record<BaseModel, string> = {
  smolvla: 'SmolVLA',
  pi0: 'Pi0',
  pi0_6: 'Pi0.6',
  openvla: 'OpenVLA',
  groot: 'GR00T',
  groot_n1_7: 'GR00T N1.7',
};

export const FINE_TUNE_LABELS: Record<string, string> = {
  lora: 'LoRA',
  full: 'Full',
  frozen_backbone: 'Frozen backbone',
};

/** Statuses that still hold compute (can be cancelled). */
export const ACTIVE_STATUSES = ['pending', 'queued', 'running'] as const;

export function isActiveJob(job: TrainingJob): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(job.status);
}

export function baseModelLabel(model: BaseModel | null | undefined): string {
  if (!model) return 'VLA';
  return BASE_MODEL_LABELS[model] ?? model;
}

/** "LoRA" / "Full" for supervised runs, the trainer for sim-RL runs. */
export function methodLabel(job: TrainingJob): string {
  if (job.kind === 'sim_rl') return simRlTrainerLabel(job.metrics.trainer);
  const method = job.fineTuneMethod ?? '';
  return FINE_TUNE_LABELS[method] ?? method;
}

/**
 * "Pi0 on GR00T-N1.7-AppleToPlate +1" — what the run trains, on what.
 * Sim-RL runs have no dataset and are named "Sim-RL policy".
 */
export function jobDisplayName(job: TrainingJob): string {
  if (job.kind === 'sim_rl') return 'Sim-RL policy';
  const model = baseModelLabel(job.baseModel);
  const members = job.datasets ?? [];
  const first = members[0]?.name ?? job.dataset?.name;
  if (!first) return `${model} training run`;
  return members.length > 1 ? `${model} on ${first} +${members.length - 1}` : `${model} on ${first}`;
}

/** First 8 chars — the full id goes in `title`. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** "Epoch 3 of 20", "Waiting for a worker", or null when there is nothing to say. */
export function progressLabel(job: TrainingJob): string | null {
  if (job.currentEpoch !== undefined && job.totalEpochs) {
    return `${job.kind === 'sim_rl' ? 'Iteration' : 'Epoch'} ${job.currentEpoch} of ${job.totalEpochs}`;
  }
  if (job.status === 'queued' || job.status === 'pending') return 'Waiting for a worker';
  if (job.status === 'running') return 'Starting';
  return null;
}
