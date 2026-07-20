/**
 * @file ModelVersionCard.tsx
 * @description Card component for displaying model version details
 * @feature deployment
 */

import { Card, Badge } from '@/shared/components/ui';
import { UI_DATE_LOCALE, cn } from '@/shared/utils';
import type { ModelVersion } from '../types';

export interface ModelVersionCardProps {
  version: ModelVersion;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
  className?: string;
}

const statusColors: Record<string, string> = {
  staging: 'warning',
  production: 'success',
  archived: 'default',
  deprecated: 'error',
};

export function ModelVersionCard({
  version,
  onClick,
  selected,
  compact = false,
  className,
}: ModelVersionCardProps) {
  const formattedDate = new Date(version.createdAt).toLocaleDateString(UI_DATE_LOCALE);

  return (
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className={cn(
        'transition-all',
        onClick && 'cursor-pointer',
        selected && 'ring-2 ring-cobalt-500',
        compact && 'p-3',
        className
      )}
    >
      <div className={cn('space-y-3', compact && 'space-y-2')}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4
              className={cn(
                'font-semibold text-theme-primary truncate',
                compact ? 'text-sm' : 'text-base'
              )}
            >
              {version.skill?.name || 'Unknown Skill'}
            </h4>
            <p className="text-xs text-theme-secondary">v{version.version}</p>
          </div>
          <Badge
            variant={statusColors[version.deploymentStatus] as 'warning' | 'success' | 'default' | 'error'}
            size={compact ? 'sm' : 'md'}
          >
            {version.deploymentStatus}
          </Badge>
        </div>

        {/* Metrics preview */}
        {!compact && version.metrics && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {version.metrics.accuracy !== undefined && (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-2">
                <p className="text-sm font-semibold text-theme-primary">
                  {(version.metrics.accuracy * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-theme-secondary">Accuracy</p>
              </div>
            )}
            {version.metrics.latencyP50 !== undefined && (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-2">
                <p className="text-sm font-semibold text-theme-primary">
                  {version.metrics.latencyP50}ms
                </p>
                <p className="text-xs text-theme-secondary">P50 Latency</p>
              </div>
            )}
            {version.metrics.successRate !== undefined && (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-2">
                <p className="text-sm font-semibold text-theme-primary">
                  {(version.metrics.successRate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-theme-secondary">Success</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-theme-tertiary">
          <span>Created {formattedDate}</span>
          {version.deploymentStatus === 'staging' && (
            <span className="text-amber-600 dark:text-amber-400">Ready for deployment</span>
          )}
        </div>
      </div>
    </Card>
  );
}
