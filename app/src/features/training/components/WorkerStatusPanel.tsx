/**
 * @file WorkerStatusPanel.tsx
 * @description Training workers connected to the server, each with its status, device and current job
 * @feature training
 *
 * Backed by GET /api/training/workers (TASK-145). gpuUtil/memoryUtil are
 * reported but not yet collected by the worker, so they show as "n/a" for
 * cuda/mps devices and are hidden for cpu.
 */

import { RefreshCw, Server } from 'lucide-react';
import { Button, EmptyState, ErrorState, Panel, SkeletonRows, StatusTag } from '@/shared/components/ui';
import type { WorkerStatusListResponse, WorkerStatusView } from '../types';
import { shortId } from './jobs/jobFormat';

export interface WorkerStatusPanelProps {
  workers: WorkerStatusListResponse | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

const WORKER_STATUS: Record<WorkerStatusView['status'], string> = {
  busy: 'running',
  idle: 'idle',
  stale: 'warning',
};

export function WorkerStatusPanel({ workers, isLoading, onRefresh }: WorkerStatusPanelProps) {
  return (
    <Panel>
      <Panel.Header
        title="Workers"
        description="Machines that pick up queued jobs and train them."
        actions={
          onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
              onClick={onRefresh}
            >
              Refresh
            </Button>
          )
        }
      />
      <Panel.Body>
        {isLoading && !workers ? (
          <SkeletonRows rows={2} columns={3} dense />
        ) : !workers ? (
          <ErrorState size="sm" title="Couldn't load workers" onRetry={onRefresh} />
        ) : workers.workers.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Server />}
            title="No workers connected"
            description="Queued jobs wait until a training worker connects. Start one to begin."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {workers.workers.map((w) => (
              <WorkerRow key={w.workerId} worker={w} />
            ))}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
}

function WorkerRow({ worker }: { worker: WorkerStatusView }) {
  const showGpu = worker.device === 'cuda' || worker.device === 'mps';
  const realGpu = worker.gpuUtil > 0 || worker.memoryUtil > 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusTag status={WORKER_STATUS[worker.status]} dot>
          {worker.status === 'busy' ? 'Busy' : worker.status === 'stale' ? 'Stale' : 'Idle'}
        </StatusTag>
        <span className="truncate text-sm font-medium text-ink-primary" title={worker.workerId}>
          {worker.workerId}
        </span>
        <span className="rounded-tag bg-inset px-1.5 py-0.5 text-xs text-ink-secondary">{worker.device}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-ink-tertiary">
        {worker.currentJob ? (
          <span>
            Running <span className="font-mono" title={worker.currentJob.id}>{shortId(worker.currentJob.id)}</span>
            {' · '}
            {formatAge(worker.currentJob.ageSeconds)}
          </span>
        ) : (
          <span>Idle</span>
        )}
        {showGpu && (
          <span>
            GPU {realGpu ? `${Math.round(worker.gpuUtil)}%` : 'n/a'} · Mem{' '}
            {realGpu ? `${Math.round(worker.memoryUtil)}%` : 'n/a'}
          </span>
        )}
        <span>Heartbeat {formatAgo(worker.lastHeartbeatAgeSeconds)}</span>
      </div>
    </li>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatAgo(seconds: number): string {
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
