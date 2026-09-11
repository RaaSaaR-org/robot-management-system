/**
 * @file JobDetailModal.tsx
 * @description One training job in a large modal (opened via ?job=): progress, metrics, datasets, details
 * @feature training
 */

import { Ban, Download, RotateCcw } from 'lucide-react';
import { Button, KeyValueList, Modal, StatusTag } from '@/shared/components/ui';
import type { TrainingJob } from '../../types';
import { TrainingProgressMonitor } from '../TrainingProgressMonitor';
import { JobMixture } from './JobMixture';
import { RunExportNotice } from './RunExportNotice';
import { useRunExport } from './useRunExport';
import { baseModelLabel, isActiveJob, jobDisplayName, methodLabel } from './jobFormat';

export interface JobDetailModalProps {
  job: TrainingJob | null;
  onClose: () => void;
  onCancel: (job: TrainingJob) => void;
  onRetry: (job: TrainingJob) => void;
}

export function JobDetailModal({ job, ...rest }: JobDetailModalProps) {
  if (!job) return null;
  // Keyed by id so the export state belongs to one job.
  return <OpenJobModal key={job.id} job={job} {...rest} />;
}

function OpenJobModal({ job, onClose, onCancel, onRetry }: Omit<JobDetailModalProps, 'job'> & { job: TrainingJob }) {
  const exp = useRunExport(job.id);
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const startedFrom = job.initFromCheckpointId ?? job.initFromModelVersionId;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      title={jobDisplayName(job)}
      description={<StatusTag status={job.status} dot pulse={job.status === 'running'} />}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            isLoading={exp.isExporting}
            leftIcon={<Download className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => void exp.exportRun()}
            className="mr-auto"
          >
            Export run
          </Button>
          {isActiveJob(job) && (
            <Button variant="danger" leftIcon={<Ban className="h-4 w-4" strokeWidth={1.75} />} onClick={() => onCancel(job)}>
              Cancel job
            </Button>
          )}
          {canRetry && (
            <Button variant="secondary" leftIcon={<RotateCcw className="h-4 w-4" strokeWidth={1.75} />} onClick={() => onRetry(job)}>
              Retry
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <RunExportNotice warnings={exp.warnings} error={exp.error} />
        <TrainingProgressMonitor job={job} />
        <JobMixture members={job.datasets ?? []} />
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-primary">Details</h3>
          <KeyValueList
            columns={3}
            items={[
              { label: 'Model', value: job.kind === 'sim_rl' ? 'Sim-RL policy' : baseModelLabel(job.baseModel) },
              { label: 'Method', value: methodLabel(job) },
              { label: 'Started from', value: startedFrom ?? 'Foundation weights', mono: !!startedFrom },
              { label: 'Created', value: new Date(job.createdAt).toLocaleString() },
              { label: 'Started', value: job.startedAt ? new Date(job.startedAt).toLocaleString() : undefined },
              { label: 'Completed', value: job.completedAt ? new Date(job.completedAt).toLocaleString() : undefined },
              { label: 'Job ID', value: job.id, mono: true },
              { label: 'Model version', value: job.modelVersionId, mono: true },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}
