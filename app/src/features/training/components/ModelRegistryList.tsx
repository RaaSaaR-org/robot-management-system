/**
 * @file ModelRegistryList.tsx
 * @description List of registered models in the model registry
 * @feature training
 */

import { useState } from 'react';
import { Card, Badge, Spinner, Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { RegisteredModel } from '../types';

export interface ModelRegistryListProps {
  models: RegisteredModel[];
  isLoading?: boolean;
  selectedName?: string;
  onSelect?: (model: RegisteredModel) => void;
}

/**
 * List of registered models with search and filtering
 */
export function ModelRegistryList({
  models,
  isLoading,
  selectedName,
  onSelect,
}: ModelRegistryListProps) {
  const [search, setSearch] = useState('');

  const filteredModels = models.filter(
    (model) =>
      model.name.toLowerCase().includes(search.toLowerCase()) ||
      model.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" label="Loading models..." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <Input
        placeholder="Search models..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {/* Model grid */}
      {filteredModels.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-theme-secondary">
            {models.length === 0
              ? 'No models registered yet. Complete a training job to register a model.'
              : 'No models match your search.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModels.map((model) => (
            <ModelCard
              key={model.name}
              model={model}
              selected={model.name === selectedName}
              onClick={() => onSelect?.(model)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ModelCardProps {
  model: RegisteredModel;
  selected?: boolean;
  onClick?: () => void;
}

function ModelCard({ model, selected, onClick }: ModelCardProps) {
  const latestVersion = model.latest_versions?.[0];
  const productionVersion = model.latest_versions?.find((v) => v.current_stage === 'Production');

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      className={cn('transition-all', selected && 'ring-2 ring-primary-500')}
    >
      <Card.Body>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-theme-primary truncate">{model.name}</h3>
            {model.description && (
              <p className="text-sm text-theme-secondary mt-1 line-clamp-2">
                {model.description}
              </p>
            )}
          </div>
          {productionVersion && (
            <Badge className="bg-green-100 text-green-800">Production</Badge>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {/* Version count */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-theme-tertiary">Versions</span>
            <span className="font-medium text-theme-primary">
              {model.latest_versions?.length ?? 0}
            </span>
          </div>

          {/* Latest version info */}
          {latestVersion && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-theme-tertiary">Latest</span>
                <span className="font-medium text-theme-primary">v{latestVersion.version}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-theme-tertiary">Stage</span>
                <StageBadge stage={latestVersion.current_stage} />
              </div>
            </>
          )}

          {/* Tags */}
          {model.tags && Object.keys(model.tags).length > 0 && (
            <div className="pt-2 border-t border-theme-secondary/20">
              <div className="flex flex-wrap gap-1">
                {Object.entries(model.tags)
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="px-2 py-0.5 bg-theme-secondary/10 rounded text-xs text-theme-secondary"
                    >
                      {key}: {value}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Last updated */}
        <div className="mt-3 pt-3 border-t border-theme-secondary/20 text-xs text-theme-tertiary">
          Last updated{' '}
          {latestVersion?.last_updated_timestamp
            ? new Date(latestVersion.last_updated_timestamp).toLocaleDateString()
            : 'Unknown'}
        </div>
      </Card.Body>
    </Card>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const stageColors: Record<string, string> = {
    Production: 'bg-green-100 text-green-800',
    Staging: 'bg-yellow-100 text-yellow-800',
    Archived: 'bg-gray-100 text-gray-800',
    None: 'bg-blue-100 text-blue-800',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs ${stageColors[stage] || stageColors.None}`}>
      {stage}
    </span>
  );
}
