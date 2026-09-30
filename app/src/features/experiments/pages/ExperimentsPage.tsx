/**
 * @file ExperimentsPage.tsx
 * @description `/experiments` — every experiment by status; a proposed one
 *   offers Approve with its budget and arm diff spelled out (TASK-242).
 * @feature experiments
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorState, PageHeader, Panel, SegmentedControl, Spinner, StatusTag, toast, errorMessage } from '@/shared/components/ui';
import { useExperiments } from '../hooks/useExperiments';
import { experimentsApi } from '../api/experimentsApi';
import { ApproveExperimentDialog } from '../components/ApproveExperimentDialog';
import type { Experiment, ExperimentStatus } from '../types/experiment.types';

type Filter = 'all' | ExperimentStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
];

export function ExperimentsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const { experiments, loading, error, reload } = useExperiments(filter === 'all' ? {} : { status: filter });
  const [reviewing, setReviewing] = useState<Experiment | null>(null);

  const decide = (fn: (id: string) => Promise<Experiment>, verb: string) => async () => {
    try {
      await fn(reviewing!.id);
      toast.success(`Experiment ${verb}`);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Experiments"
        description="One hypothesis, several arms: an agent proposes, a person approves, the platform trains, evaluates and rates."
      />
      <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} label="Filter by status" />
      <Panel>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorState title="Couldn't load experiments" message={error} onRetry={() => void reload()} />
        ) : experiments.length === 0 ? (
          <EmptyState title="No experiments" description="An agent proposes experiments through POST /api/experiments; they appear here for approval." />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle" data-testid="experiment-list">
            {experiments.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/experiments/${encodeURIComponent(e.id)}`} className="font-medium text-ink-primary hover:underline">
                    {e.title}
                  </Link>
                  <div className="truncate text-[13px] text-ink-secondary">{e.hypothesis}</div>
                  <div className="text-[12px] text-ink-tertiary">
                    {e.arms.length} arms · proposed by {e.displayName} ({e.actorType})
                  </div>
                </div>
                <StatusTag status={e.status} dot />
                {e.status === 'proposed' && (
                  <Button size="sm" onClick={() => setReviewing(e)}>
                    Review
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ApproveExperimentDialog
        experiment={reviewing}
        onClose={() => setReviewing(null)}
        onApprove={decide(experimentsApi.approve, 'approved')}
        onReject={decide((id) => experimentsApi.reject(id), 'rejected')}
      />
    </div>
  );
}
