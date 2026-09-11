/**
 * @file JobsSection.tsx
 * @description The Jobs tab of /training: compute state, filters, the job table, workers and queue
 * @feature training
 */

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Brain, CheckCircle2, Clock, FlaskConical, Plus, Search, Server } from 'lucide-react';
import {
  Button,
  EmptyState,
  NextStepBanner,
  Panel,
  SearchInput,
  Select,
  StatRow,
  StatTile,
  Toolbar,
  confirm,
  toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import {
  useQueueStatsAutoFetch,
  useTrainingJobsAutoFetch,
  useTrainingProgress,
  useWorkersAutoFetch,
} from '../../hooks';
import type { TrainingJob } from '../../types';
import { TrainingJobList } from '../TrainingJobList';
import { WorkerStatusPanel } from '../WorkerStatusPanel';
import { QueueStatsDisplay } from '../QueueStatsDisplay';
import { JobDetailModal } from './JobDetailModal';
import { isActiveJob, jobDisplayName, methodLabel } from './jobFormat';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const KIND_OPTIONS = [
  { value: 'supervised', label: 'Supervised' },
  { value: 'sim_rl', label: 'Sim-RL' },
];

export interface JobsSectionProps {
  /** Opens the New training job wizard (the header's primary action). */
  onNew: () => void;
}

export function JobsSection({ onNew }: JobsSectionProps) {
  const [params, setParams] = useSearchParams();
  const { jobs, isLoading, error, fetchJobs, cancelJob, retryJob } = useTrainingJobsAutoFetch();
  const { workers, isLoading: workersLoading, refresh: refreshWorkers } = useWorkersAutoFetch(10000);
  const { queueStats, isLoading: queueLoading } = useQueueStatsAutoFetch(30000);
  useTrainingProgress(); // live progress over WebSocket

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (status === 'active' ? !isActiveJob(j) : status && j.status !== status) return false;
      if (kind && (j.kind ?? 'supervised') !== kind) return false;
      if (!q) return true;
      const hay = [jobDisplayName(j), methodLabel(j), j.id, ...(j.datasets ?? []).map((d) => d.name)].join(' ');
      return hay.toLowerCase().includes(q);
    });
  }, [jobs, query, status, kind]);

  const jobId = params.get('job');
  const openJob = jobs.find((j) => j.id === jobId) ?? null;
  const setOpen = useCallback(
    (id: string | null) =>
      setParams((p) => {
        if (id) p.set('job', id);
        else p.delete('job');
        return p;
      }),
    [setParams]
  );

  const askCancel = async (job: TrainingJob) => {
    const name = jobDisplayName(job);
    const ok = await confirm({
      title: `Cancel ${name}?`,
      description: 'The run stops and frees its worker. Checkpoints saved so far are kept.',
      confirmLabel: 'Cancel job',
      cancelLabel: 'Keep running',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await cancelJob(job.id);
      toast.success('Training job cancelled', { description: name });
    } catch (err) {
      toast.error("Couldn't cancel the training job", { description: getErrorMessage(err, 'Unknown error') });
    }
  };

  const retry = async (job: TrainingJob) => {
    try {
      await retryJob(job.id);
      toast.success('Training job restarted', { description: jobDisplayName(job) });
    } catch (err) {
      toast.error("Couldn't restart the training job", { description: getErrorMessage(err, 'Unknown error') });
    }
  };

  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  const online = workers?.workers.filter((w) => w.status !== 'stale').length ?? 0;
  const hasFilters = Boolean(query || status || kind);
  const clear = () => { setQuery(''); setStatus(''); setKind(''); };
  const hasCompleted = jobs.some((j) => j.status === 'completed');

  return (
    <div className="flex flex-col gap-6">
      <StatRow columns={4}>
        <StatTile label="Running" value={count('running')} icon={<Activity />} tone={count('running') ? 'live' : undefined} isLoading={isLoading && jobs.length === 0} />
        <StatTile label="Queued" value={count('queued') + count('pending')} icon={<Clock />} isLoading={isLoading && jobs.length === 0} />
        <StatTile label="Completed" value={count('completed')} icon={<CheckCircle2 />} isLoading={isLoading && jobs.length === 0} />
        <StatTile
          label="Workers online"
          value={online}
          icon={<Server />}
          tone={online > 0 ? 'live' : 'gated'}
          hint={online > 0 ? 'Measured just now' : 'Queued jobs wait for a worker'}
          isLoading={workersLoading && !workers}
        />
      </StatRow>

      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search by model or dataset" />}
        filters={
          <>
            <Select aria-label="Status" fullWidth={false} className="w-40" placeholder="All statuses" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
            <Select aria-label="Kind" fullWidth={false} className="w-40" placeholder="All kinds" options={KIND_OPTIONS} value={kind} onChange={(e) => setKind(e.target.value)} />
          </>
        }
      />

      <Panel padding="none">
        <TrainingJobList
          jobs={filtered}
          isLoading={isLoading}
          error={jobs.length === 0 ? error : null}
          onRetryLoad={() => void fetchJobs()}
          onSelect={(j) => setOpen(j.id)}
          onCancel={(id) => { const j = jobs.find((x) => x.id === id); if (j) void askCancel(j); }}
          onRetry={(id) => { const j = jobs.find((x) => x.id === id); if (j) void retry(j); }}
          empty={
            hasFilters ? (
              <EmptyState icon={<Search />} title="No training jobs match" description="Try another model or dataset name, or clear the filters." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={<Brain />} title="No training jobs yet" description="A training job fine-tunes a policy on one or more of your datasets." action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={onNew}>New training job</Button>} />
            )
          }
        />
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <WorkerStatusPanel workers={workers} isLoading={workersLoading} onRefresh={refreshWorkers} />
        <QueueStatsDisplay stats={queueStats} isLoading={queueLoading} />
      </div>

      {hasCompleted && (
        <NextStepBanner
          variant="subtle"
          title="Evaluate in simulation"
          description="Run a trained policy against a physics scene before it touches a robot."
          ctaLabel="Open simulation"
          ctaHref="/training?tab=simulation"
          icon={<FlaskConical className="h-4 w-4" />}
        />
      )}

      <JobDetailModal job={openJob} onClose={() => setOpen(null)} onCancel={(j) => void askCancel(j)} onRetry={(j) => void retry(j)} />
    </div>
  );
}
