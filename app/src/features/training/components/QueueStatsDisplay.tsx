/**
 * @file QueueStatsDisplay.tsx
 * @description Display for training queue statistics
 * @feature training
 */

import { Card, Spinner } from '@/shared/components/ui';
import type { QueueStats } from '../types';

export interface QueueStatsDisplayProps {
  stats: QueueStats | null;
  isLoading?: boolean;
}

/**
 * Display training queue statistics
 */
export function QueueStatsDisplay({ stats, isLoading }: QueueStatsDisplayProps) {
  if (isLoading) {
    return (
      <Card>
        <Card.Body className="flex items-center justify-center py-6">
          <Spinner size="sm" label="Loading stats..." />
        </Card.Body>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card>
        <Card.Body className="text-center py-6">
          <p className="text-theme-secondary text-sm">Queue stats unavailable</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header>
        <h3 className="font-semibold text-theme-primary">Queue Statistics</h3>
      </Card.Header>
      <Card.Body className="space-y-4">
        {/* Job counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatItem label="Pending" value={stats.pending} color="gray" />
          <StatItem label="Queued" value={stats.queued} color="blue" />
          <StatItem label="Running" value={stats.running} color="yellow" />
          <StatItem label="Completed (24h)" value={stats.completed_24h} color="green" />
        </div>

        {/* Breakdown by model */}
        {stats.by_model && Object.keys(stats.by_model).length > 0 && (
          <div className="pt-3 border-t border-theme-secondary/20">
            <h4 className="text-sm font-medium text-theme-primary mb-2">By Model</h4>
            <div className="space-y-2">
              {Object.entries(stats.by_model).map(([model, counts]) => (
                <div key={model} className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-theme-primary w-20">{model.toUpperCase()}</span>
                  <div className="flex-1 flex items-center gap-1">
                    <CountBadge count={counts.running} color="yellow" label="running" />
                    <CountBadge count={counts.queued} color="blue" label="queued" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Priority breakdown */}
        {stats.by_priority && (
          <div className="pt-3 border-t border-theme-secondary/20">
            <h4 className="text-sm font-medium text-theme-primary mb-2">By Priority</h4>
            <div className="flex gap-4">
              <PriorityItem label="High" count={stats.by_priority.high} color="red" />
              <PriorityItem label="Normal" count={stats.by_priority.normal} color="blue" />
              <PriorityItem label="Low" count={stats.by_priority.low} color="gray" />
            </div>
          </div>
        )}

        {/* Average wait times */}
        {stats.avg_wait_time_minutes !== undefined && (
          <div className="pt-3 border-t border-theme-secondary/20">
            <div className="flex justify-between text-sm">
              <span className="text-theme-secondary">Average Wait Time</span>
              <span className="font-medium text-theme-primary">
                {formatMinutes(stats.avg_wait_time_minutes)}
              </span>
            </div>
            {stats.avg_training_time_minutes !== undefined && (
              <div className="flex justify-between text-sm mt-1">
                <span className="text-theme-secondary">Average Training Time</span>
                <span className="font-medium text-theme-primary">
                  {formatMinutes(stats.avg_training_time_minutes)}
                </span>
              </div>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

interface StatItemProps {
  label: string;
  value: number;
  color: 'gray' | 'blue' | 'yellow' | 'green' | 'red';
}

function StatItem({ label, value, color }: StatItemProps) {
  const colorClasses: Record<string, string> = {
    gray: 'text-gray-600',
    blue: 'text-blue-600',
    yellow: 'text-yellow-600',
    green: 'text-green-600',
    red: 'text-red-600',
  };

  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
      <p className="text-xs text-theme-tertiary">{label}</p>
    </div>
  );
}

interface CountBadgeProps {
  count: number;
  color: 'yellow' | 'blue' | 'green' | 'gray';
  label: string;
}

function CountBadge({ count, color, label }: CountBadgeProps) {
  if (count === 0) return null;

  const bgClasses: Record<string, string> = {
    yellow: 'bg-yellow-100 text-yellow-800',
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    gray: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs ${bgClasses[color]}`}>
      {count} {label}
    </span>
  );
}

interface PriorityItemProps {
  label: string;
  count: number;
  color: 'red' | 'blue' | 'gray';
}

function PriorityItem({ label, count, color }: PriorityItemProps) {
  const bgClasses: Record<string, string> = {
    red: 'bg-red-50',
    blue: 'bg-blue-50',
    gray: 'bg-gray-50',
  };

  const textClasses: Record<string, string> = {
    red: 'text-red-700',
    blue: 'text-blue-700',
    gray: 'text-gray-700',
  };

  return (
    <div className={`flex-1 p-2 rounded ${bgClasses[color]} text-center`}>
      <p className={`text-lg font-bold ${textClasses[color]}`}>{count}</p>
      <p className="text-xs text-theme-tertiary">{label}</p>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
