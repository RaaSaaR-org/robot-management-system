/**
 * @file TrainingJobList.tsx
 * @description List of training jobs with filters
 * @feature training
 */

import { useState } from 'react';
import { Spinner } from '@/shared/components/ui';
import { TrainingJobCard } from './TrainingJobCard';
import type { TrainingJob, TrainingJobStatus, BaseModel } from '../types';

export interface TrainingJobListProps {
  jobs: TrainingJob[];
  isLoading?: boolean;
  selectedId?: string;
  onSelect?: (job: TrainingJob) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  showFilters?: boolean;
}

const statusOptions: { value: TrainingJobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'queued', label: 'Queued' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

/**
 * List of training jobs with filtering
 */
export function TrainingJobList({
  jobs,
  isLoading,
  selectedId,
  onSelect,
  onCancel,
  onRetry,
  showFilters = true,
}: TrainingJobListProps) {
  const [statusFilter, setStatusFilter] = useState<TrainingJobStatus | 'all'>('all');
  const [modelFilter, setModelFilter] = useState<BaseModel | 'all'>('all');

  const filteredJobs = jobs.filter((job) => {
    if (statusFilter !== 'all' && job.status !== statusFilter) {
      return false;
    }
    if (modelFilter !== 'all' && job.baseModel !== modelFilter) {
      return false;
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" label="Loading jobs..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="flex flex-wrap gap-3">
          <div className="flex gap-1">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setStatusFilter(option.value)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  statusFilter === option.value
                    ? 'bg-primary-500 text-white'
                    : 'bg-theme-secondary/20 text-theme-secondary hover:bg-theme-secondary/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {(['all', 'pi0', 'pi0_6', 'openvla', 'groot'] as const).map((model) => (
              <button
                key={model}
                onClick={() => setModelFilter(model)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  modelFilter === model
                    ? 'bg-accent-500 text-white'
                    : 'bg-theme-secondary/20 text-theme-secondary hover:bg-theme-secondary/30'
                }`}
              >
                {model === 'all' ? 'All Models' : model.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredJobs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-theme-secondary">
            {jobs.length === 0
              ? 'No training jobs found. Start a new training job to get started.'
              : 'No jobs match your filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredJobs.map((job) => (
            <TrainingJobCard
              key={job.id}
              job={job}
              selected={job.id === selectedId}
              onClick={() => onSelect?.(job)}
              onCancel={onCancel ? () => onCancel(job.id) : undefined}
              onRetry={onRetry ? () => onRetry(job.id) : undefined}
            />
          ))}
        </div>
      )}

      {showFilters && jobs.length > 0 && (
        <div className="text-sm text-theme-tertiary">
          Showing {filteredJobs.length} of {jobs.length} jobs
        </div>
      )}
    </div>
  );
}
