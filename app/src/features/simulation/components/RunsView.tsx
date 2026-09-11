/**
 * @file RunsView.tsx
 * @description Sim runs as a DataTable: run name, status, success rate, rollouts, backend, started
 * @feature simulation
 */

import { FlaskConical, Plus, Search } from 'lucide-react';
import { Button, DataTable, EmptyState, ProgressBar, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import type { SimJob, SimScene } from '../types';
import { backendLabel, backendModeTag, formatPct, formatRelative, runName, successTone } from './simFormat';

export interface RunsViewProps {
  jobs: SimJob[];
  scenes: SimScene[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (job: SimJob) => void;
  onNew: () => void;
  filtered: boolean;
  onClearFilters: () => void;
}

export function RunsView({ jobs, scenes, loading, error, onRetry, onOpen, onNew, filtered, onClearFilters }: RunsViewProps) {
  const columns: DataTableColumn<SimJob>[] = [
    {
      key: 'name',
      header: 'Run',
      sortable: true,
      sortValue: (j) => runName(j, scenes),
      cell: (j) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-primary">{runName(j, scenes)}</div>
          <div className="font-mono text-xs text-ink-tertiary" title={j.jobId}>{j.jobId.slice(0, 8)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (j) => j.status,
      cell: (j) =>
        j.status === 'running' ? (
          <div className="flex min-w-[110px] flex-col gap-1">
            <StatusTag status="running" dot pulse />
            <ProgressBar value={j.progress} size="sm" showValue={false} />
          </div>
        ) : (
          <StatusTag status={j.status} dot />
        ),
    },
    {
      key: 'success',
      header: 'Success',
      align: 'right',
      sortable: true,
      sortValue: (j) => j.metrics?.successRate ?? null,
      cell: (j) => (j.metrics ? <StatusTag tone={successTone(j.metrics.successRate)}>{formatPct(j.metrics.successRate)}</StatusTag> : null),
    },
    { key: 'rolloutCount', header: 'Rollouts', align: 'right', sortable: true, hideBelow: 'sm' },
    {
      key: 'backend',
      header: 'Backend',
      hideBelow: 'md',
      cell: (j) => {
        const mode = backendModeTag(j);
        return (
          <span className="inline-flex items-center gap-2">
            <span className="text-ink-secondary">{backendLabel(j.backend)}</span>
            {mode && <StatusTag tone={mode.tone} size="sm">{mode.label}</StatusTag>}
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      header: 'Started',
      align: 'right',
      hideBelow: 'md',
      sortable: true,
      sortValue: (j) => new Date(j.createdAt),
      cell: (j) => <span title={new Date(j.createdAt).toLocaleString()}>{formatRelative(j.createdAt)}</span>,
    },
  ];

  return (
    <DataTable
      caption="Sim runs"
      columns={columns}
      rows={jobs}
      getRowId={(j) => j.jobId}
      defaultSort={{ key: 'createdAt', direction: 'desc' }}
      onRowClick={onOpen}
      rowActions={(j) => [{ label: 'Open results', onSelect: () => onOpen(j) }]}
      rowActionsLabel={(j) => `Actions for ${runName(j, scenes)}`}
      isLoading={loading}
      error={error}
      errorTitle="Couldn't load sim runs"
      onRetry={onRetry}
      empty={
        filtered ? (
          <EmptyState icon={<Search />} title="No sim runs match" description="Try another model or scene, or clear the filters." action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={<FlaskConical />} title="No sim runs yet" description="A sim run tests a policy against a physics scene before it touches a robot." action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={onNew}>New sim run</Button>} />
        )
      }
    />
  );
}
