/**
 * @file GpuAvailabilityPanel.tsx
 * @description Panel showing GPU pool availability status
 * @feature training
 */

import { Card, Spinner } from '@/shared/components/ui';
import type { GpuAvailability } from '../types';

export interface GpuAvailabilityPanelProps {
  availability: GpuAvailability | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

/**
 * Panel displaying GPU pool availability
 */
export function GpuAvailabilityPanel({
  availability,
  isLoading,
  onRefresh,
}: GpuAvailabilityPanelProps) {
  if (isLoading) {
    return (
      <Card>
        <Card.Body className="flex items-center justify-center py-8">
          <Spinner size="md" label="Loading GPU status..." />
        </Card.Body>
      </Card>
    );
  }

  if (!availability) {
    return (
      <Card>
        <Card.Body className="text-center py-8">
          <p className="text-theme-secondary">GPU information unavailable</p>
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

  const utilizationPercent = Math.round(
    ((availability.total_gpus - availability.available_gpus) / availability.total_gpus) * 100
  );

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-theme-primary">GPU Availability</h3>
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
        {/* Overall status */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-theme-secondary">Utilization</span>
              <span className="font-medium text-theme-primary">{utilizationPercent}%</span>
            </div>
            <div className="h-2 bg-theme-secondary/20 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  utilizationPercent >= 90
                    ? 'bg-red-500'
                    : utilizationPercent >= 70
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${utilizationPercent}%` }}
              />
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-theme-primary">
              {availability.available_gpus}
            </p>
            <p className="text-xs text-theme-tertiary">
              of {availability.total_gpus} available
            </p>
          </div>
        </div>

        {/* GPU types breakdown */}
        {availability.gpu_types && (
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(availability.gpu_types).map(([type, count]) => (
              <GpuTypeCard key={type} type={type} count={count} />
            ))}
          </div>
        )}

        {/* Queue info */}
        <div className="pt-3 border-t border-theme-secondary/20">
          <div className="flex justify-between text-sm">
            <span className="text-theme-secondary">Jobs in Queue</span>
            <span className="font-medium text-theme-primary">{availability.queued_jobs}</span>
          </div>
          {availability.estimated_wait_time && (
            <div className="flex justify-between text-sm mt-1">
              <span className="text-theme-secondary">Est. Wait Time</span>
              <span className="font-medium text-theme-primary">
                {formatWaitTime(availability.estimated_wait_time)}
              </span>
            </div>
          )}
        </div>

        {/* Status indicator */}
        <div
          className={`p-2 rounded text-center text-sm ${
            availability.available_gpus > 0
              ? 'bg-green-100 text-green-800'
              : availability.queued_jobs < 5
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-red-100 text-red-800'
          }`}
        >
          {availability.available_gpus > 0
            ? 'GPUs available - jobs will start immediately'
            : availability.queued_jobs < 5
              ? 'Short queue - jobs will start soon'
              : 'High demand - expect longer wait times'}
        </div>
      </Card.Body>
    </Card>
  );
}

interface GpuTypeCardProps {
  type: string;
  count: number;
}

function GpuTypeCard({ type, count }: GpuTypeCardProps) {
  const gpuInfo: Record<string, { name: string; memory: string }> = {
    a100: { name: 'NVIDIA A100', memory: '80GB' },
    h100: { name: 'NVIDIA H100', memory: '80GB' },
    a10g: { name: 'NVIDIA A10G', memory: '24GB' },
    t4: { name: 'NVIDIA T4', memory: '16GB' },
  };

  const info = gpuInfo[type] || { name: type.toUpperCase(), memory: 'Unknown' };

  return (
    <div className="p-3 bg-theme-secondary/10 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="font-medium text-theme-primary">{info.name}</span>
        <span
          className={`text-lg font-bold ${count > 0 ? 'text-green-600' : 'text-theme-tertiary'}`}
        >
          {count}
        </span>
      </div>
      <p className="text-xs text-theme-tertiary">{info.memory} VRAM</p>
    </div>
  );
}

function formatWaitTime(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `~${hours}h ${mins}m`;
}
