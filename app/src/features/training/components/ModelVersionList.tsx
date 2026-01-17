/**
 * @file ModelVersionList.tsx
 * @description List of model versions with stage management
 * @feature training
 */

import { Card, Badge, Button, Spinner } from '@/shared/components/ui';
import type { ModelVersion } from '../types';

export interface ModelVersionListProps {
  versions: ModelVersion[];
  modelName: string;
  isLoading?: boolean;
  onPromote?: (version: ModelVersion, stage: string) => void;
  onCompare?: (versions: ModelVersion[]) => void;
  selectedVersions?: string[];
  onSelectVersion?: (version: ModelVersion, selected: boolean) => void;
}

const stages = ['None', 'Staging', 'Production', 'Archived'] as const;

/**
 * List of model versions with stage badges and actions
 */
export function ModelVersionList({
  versions,
  modelName,
  isLoading,
  onPromote,
  onCompare,
  selectedVersions = [],
  onSelectVersion,
}: ModelVersionListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" label="Loading versions..." />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-theme-secondary">No versions found for {modelName}</p>
      </div>
    );
  }

  const sortedVersions = [...versions].sort(
    (a, b) => parseInt(b.version) - parseInt(a.version)
  );

  return (
    <div className="space-y-4">
      {/* Compare button */}
      {onCompare && selectedVersions.length >= 2 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              const selected = versions.filter((v) => selectedVersions.includes(v.version));
              onCompare(selected);
            }}
          >
            Compare Selected ({selectedVersions.length})
          </Button>
        </div>
      )}

      {/* Version list */}
      <div className="space-y-3">
        {sortedVersions.map((version) => (
          <VersionRow
            key={version.version}
            version={version}
            onPromote={onPromote}
            isSelected={selectedVersions.includes(version.version)}
            onSelect={onSelectVersion ? (selected) => onSelectVersion(version, selected) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

interface VersionRowProps {
  version: ModelVersion;
  onPromote?: (version: ModelVersion, stage: string) => void;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
}

function VersionRow({ version, onPromote, isSelected, onSelect }: VersionRowProps) {
  const stageColors: Record<string, string> = {
    Production: 'bg-green-100 text-green-800',
    Staging: 'bg-yellow-100 text-yellow-800',
    Archived: 'bg-gray-100 text-gray-800',
    None: 'bg-blue-100 text-blue-800',
  };

  return (
    <Card className={isSelected ? 'ring-2 ring-primary-500' : ''}>
      <Card.Body>
        <div className="flex items-center gap-4">
          {/* Selection checkbox */}
          {onSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelect(e.target.checked)}
              className="w-4 h-4 text-primary-500 rounded focus:ring-primary-500"
            />
          )}

          {/* Version info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold text-theme-primary">
                v{version.version}
              </span>
              <Badge className={stageColors[version.current_stage] || stageColors.None}>
                {version.current_stage}
              </Badge>
              {version.status && version.status !== 'READY' && (
                <Badge className="bg-orange-100 text-orange-800">{version.status}</Badge>
              )}
            </div>

            {version.description && (
              <p className="text-sm text-theme-secondary mt-1">{version.description}</p>
            )}

            {/* Metrics preview */}
            {version.metrics && Object.keys(version.metrics).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(version.metrics)
                  .slice(0, 4)
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="px-2 py-0.5 bg-theme-secondary/10 rounded text-xs"
                    >
                      {formatMetricName(key)}: {formatMetricValue(value)}
                    </span>
                  ))}
              </div>
            )}

            {/* Timestamps */}
            <div className="mt-2 text-xs text-theme-tertiary">
              Created {new Date(version.creation_timestamp).toLocaleString()}
              {version.last_updated_timestamp &&
                version.last_updated_timestamp !== version.creation_timestamp && (
                  <> · Updated {new Date(version.last_updated_timestamp).toLocaleString()}</>
                )}
            </div>
          </div>

          {/* Stage actions */}
          {onPromote && (
            <div className="flex items-center gap-2">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onPromote(version, e.target.value);
                    e.target.value = '';
                  }
                }}
                className="px-2 py-1 text-sm rounded border border-theme-secondary/30 bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Move to...</option>
                {stages
                  .filter((s) => s !== version.current_stage)
                  .map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>

        {/* Run info */}
        {version.run_id && (
          <div className="mt-3 pt-3 border-t border-theme-secondary/20 flex items-center gap-4 text-sm">
            <div>
              <span className="text-theme-tertiary">Run ID:</span>
              <span className="ml-1 font-mono text-theme-secondary">{version.run_id.slice(0, 8)}</span>
            </div>
            {version.source && (
              <div>
                <span className="text-theme-tertiary">Source:</span>
                <span className="ml-1 text-theme-secondary">{version.source}</span>
              </div>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function formatMetricName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Loss', 'Loss')
    .replace('Lr', 'LR');
}

function formatMetricValue(value: number | string): string {
  if (typeof value === 'string') return value;
  if (Math.abs(value) < 0.001) return value.toExponential(2);
  if (Math.abs(value) < 1) return value.toFixed(4);
  if (Math.abs(value) < 100) return value.toFixed(2);
  return value.toLocaleString();
}
