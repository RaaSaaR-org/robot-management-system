/**
 * @file ModelVersionCard.tsx
 * @description Card component for displaying model version details
 * @feature deployment
 */

import { Card, Badge } from '@/shared/components/ui';
import { UI_DATE_LOCALE, cn } from '@/shared/utils';
import { useModelVersionFromStore } from '../hooks/useModelVersions';
import { MODEL_SOURCE_KIND_LABELS } from '../types';
import type { ModelVersion, ModelSourceKind } from '../types';

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

const sourceKindColors: Record<ModelSourceKind, 'default' | 'cobalt' | 'purple'> = {
  training: 'default',
  imported: 'cobalt',
  derived: 'purple',
};

/**
 * The card's headline. A model registered from outside carries a `name`; one
 * created by a training job usually does not, and its dataset usually has no
 * skill either — so falling through to the skill name would print "Unknown
 * Skill" on every model in the registry and read as an error. (TASK-238)
 */
function getDisplayName(version: ModelVersion): string {
  return version.name || version.skill?.name || `Model ${version.version}`;
}

export function ModelVersionCard({
  version,
  onClick,
  selected,
  compact = false,
  className,
}: ModelVersionCardProps) {
  const formattedDate = new Date(version.createdAt).toLocaleDateString(UI_DATE_LOCALE);
  const parentFromStore = useModelVersionFromStore(version.parentModelVersionId);
  const parent = version.parent ?? parentFromStore;
  const sourceKind = version.sourceKind;

  return (
    <Card
      id={`model-${version.id}`}
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
              {getDisplayName(version)}
            </h4>
            <p className="text-xs text-theme-secondary">v{version.version}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant={statusColors[version.deploymentStatus] as 'warning' | 'success' | 'default' | 'error'}
              size={compact ? 'sm' : 'md'}
            >
              {version.deploymentStatus}
            </Badge>
            {sourceKind && (
              <Badge variant={sourceKindColors[sourceKind]} size="sm">
                {MODEL_SOURCE_KIND_LABELS[sourceKind]}
              </Badge>
            )}
          </div>
        </div>

        {/* Lineage */}
        {version.parentModelVersionId && (
          <a
            href={`#model-${version.parentModelVersionId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-cobalt-500 hover:underline truncate"
          >
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            <span className="truncate">
              Derived from{' '}
              {parent
                ? getDisplayName(parent)
                : `model ${version.parentModelVersionId.slice(0, 8)}`}
            </span>
          </a>
        )}

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
