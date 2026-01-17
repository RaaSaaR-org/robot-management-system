/**
 * @file DatasetCard.tsx
 * @description Card component displaying dataset summary
 * @feature training
 */

import { Card, Badge } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { Dataset, DatasetStatus } from '../types';

export interface DatasetCardProps {
  dataset: Dataset;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

const statusColors: Record<DatasetStatus, string> = {
  uploading: 'bg-blue-100 text-blue-800',
  validating: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const statusLabels: Record<DatasetStatus, string> = {
  uploading: 'Uploading',
  validating: 'Validating',
  ready: 'Ready',
  failed: 'Failed',
};

/**
 * Card component for displaying dataset summary
 */
export function DatasetCard({ dataset, onClick, selected, className }: DatasetCardProps) {
  const qualityPercent = dataset.qualityScore
    ? Math.round(dataset.qualityScore * 100)
    : null;

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      className={cn(
        'cursor-pointer transition-all',
        selected && 'ring-2 ring-primary-500',
        className
      )}
    >
      <Card.Body>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-theme-primary truncate">{dataset.name}</h3>
            {dataset.description && (
              <p className="text-sm text-theme-secondary mt-1 line-clamp-2">
                {dataset.description}
              </p>
            )}
          </div>
          <Badge className={statusColors[dataset.status]}>
            {statusLabels[dataset.status]}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-theme-tertiary">Frames</span>
            <p className="font-medium text-theme-primary">
              {dataset.totalFrames.toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-theme-tertiary">Duration</span>
            <p className="font-medium text-theme-primary">
              {formatDuration(dataset.totalDuration)}
            </p>
          </div>
          <div>
            <span className="text-theme-tertiary">Demonstrations</span>
            <p className="font-medium text-theme-primary">{dataset.demonstrationCount}</p>
          </div>
          <div>
            <span className="text-theme-tertiary">FPS</span>
            <p className="font-medium text-theme-primary">{dataset.fps}</p>
          </div>
        </div>

        {qualityPercent !== null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-theme-tertiary">Quality Score</span>
              <span
                className={cn(
                  'font-medium',
                  qualityPercent >= 80
                    ? 'text-green-600'
                    : qualityPercent >= 60
                      ? 'text-yellow-600'
                      : 'text-red-600'
                )}
              >
                {qualityPercent}%
              </span>
            </div>
            <div className="w-full h-2 bg-theme-secondary/20 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  qualityPercent >= 80
                    ? 'bg-green-500'
                    : qualityPercent >= 60
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                )}
                style={{ width: `${qualityPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-theme-secondary/20 text-xs text-theme-tertiary">
          LeRobot v{dataset.lerobotVersion} &bull; Created{' '}
          {new Date(dataset.createdAt).toLocaleDateString()}
        </div>
      </Card.Body>
    </Card>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
