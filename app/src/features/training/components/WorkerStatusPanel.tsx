/**
 * @file WorkerStatusPanel.tsx
 * @description Real training worker status panel — replaces the fake GPU panel
 * @feature training
 *
 * Backed by GET /api/training/workers, which returns the in-memory worker
 * registry on the server (TASK-145). gpuUtil/memoryUtil are reported but
 * the worker doesn't yet collect real telemetry — they're shown as "n/a"
 * for cuda/mps devices and hidden for cpu.
 */

import { Card, Spinner } from '@/shared/components/ui';
import type { WorkerStatusListResponse, WorkerStatusView } from '../types';

export interface WorkerStatusPanelProps {
  workers: WorkerStatusListResponse | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export function WorkerStatusPanel({
  workers,
  isLoading,
  onRefresh,
}: WorkerStatusPanelProps) {
  if (isLoading && !workers) {
    return (
      <Card>
        <Card.Body className="flex items-center justify-center py-8">
          <Spinner size="md" label="Loading worker status..." />
        </Card.Body>
      </Card>
    );
  }

  if (!workers) {
    return (
      <Card>
        <Card.Body className="text-center py-8">
          <p className="text-theme-secondary">Worker status unavailable</p>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="mt-2 text-sm text-primary-500 hover:text-primary-600"
            >
              Retry
            </button>
          )}
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-theme-primary">Training Workers</h3>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-sm text-primary-500 hover:text-primary-600"
            >
              Refresh
            </button>
          )}
        </div>
      </Card.Header>
      <Card.Body className="space-y-4">
        {workers.workers.length === 0 ? (
          <div className="p-4 rounded text-center text-sm bg-theme-secondary/10 text-theme-secondary">
            No workers connected. Start a training worker to begin.
          </div>
        ) : (
          <div className="space-y-2">
            {workers.workers.map((w) => (
              <WorkerRow key={w.workerId} worker={w} />
            ))}
          </div>
        )}

        {/* Queue summary footer */}
        <div className="pt-3 border-t border-theme-secondary/20 grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-theme-secondary">Running</span>
            <span className="font-medium text-theme-primary">{workers.runningJobs}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-theme-secondary">Queued</span>
            <span className="font-medium text-theme-primary">{workers.queuedJobs}</span>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

function WorkerRow({ worker }: { worker: WorkerStatusView }) {
  const showGpuStats = worker.device === 'cuda' || worker.device === 'mps';
  const hasRealGpuStats = worker.gpuUtil > 0 || worker.memoryUtil > 0;

  return (
    <div className="p-3 bg-theme-secondary/10 rounded-lg space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={worker.status} />
          <span
            className="font-medium text-theme-primary text-sm truncate"
            title={worker.workerId}
          >
            {worker.workerId}
          </span>
        </div>
        <DeviceChip device={worker.device} />
      </div>

      <div className="text-xs text-theme-secondary">
        {worker.currentJob ? (
          <>
            Running{' '}
            <span className="text-theme-primary font-mono">
              {worker.currentJob.id.slice(0, 8)}
            </span>{' '}
            · {formatAge(worker.currentJob.ageSeconds)}
            {worker.currentJob.baseModel && (
              <> · {worker.currentJob.baseModel}</>
            )}
          </>
        ) : (
          <>Idle</>
        )}
      </div>

      {showGpuStats && (
        <div className="text-xs text-theme-tertiary flex gap-3">
          <span>
            GPU:{' '}
            {hasRealGpuStats ? `${Math.round(worker.gpuUtil)}%` : 'n/a'}
          </span>
          <span>
            Mem:{' '}
            {hasRealGpuStats ? `${Math.round(worker.memoryUtil)}%` : 'n/a'}
          </span>
        </div>
      )}

      <div className="text-xs text-theme-tertiary">
        Last heartbeat: {formatRelative(worker.lastHeartbeatAgeSeconds)}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: WorkerStatusView['status'] }) {
  const cls =
    status === 'busy'
      ? 'bg-green-100 text-green-800'
      : status === 'stale'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-theme-secondary/20 text-theme-secondary';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function DeviceChip({ device }: { device: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs font-mono bg-theme-secondary/20 text-theme-secondary">
      {device}
    </span>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatRelative(seconds: number): string {
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
