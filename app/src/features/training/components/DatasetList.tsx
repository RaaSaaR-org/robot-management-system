/**
 * @file DatasetList.tsx
 * @description Grid list of datasets with filters and mixture selection
 * @feature training
 */

import { useState } from 'react';
import { Input, Spinner, EmptyState, Button } from '@/shared/components/ui';
import { DatasetCard } from './DatasetCard';
import type { Dataset, DatasetStatus } from '../types';

export interface DatasetListProps {
  datasets: Dataset[];
  isLoading?: boolean;
  selectedId?: string;
  onSelect?: (dataset: Dataset) => void;
  onViewEpisodes?: (dataset: Dataset) => void;
  onDelete?: (dataset: Dataset) => void;
  onRetryImport?: (dataset: Dataset) => void;
  showFilters?: boolean;
  /**
   * A filter outside this component (the page's robot-type / skill selects) is
   * narrowing `datasets`. Without it an empty list is indistinguishable from an
   * empty database, and the page told people to import their first dataset when
   * they already had eleven.
   */
  filtersActive?: boolean;
  /** Ids currently picked for a training mixture. Enables the checkboxes. */
  selectedIds?: string[];
  onToggleSelection?: (dataset: Dataset) => void;
  onClearSelection?: () => void;
  onPrepareTraining?: () => void;
  /** How many datasets one comparison takes. Reached, it is said out loud. */
  maxSelection?: number;
}

const statusOptions: { value: DatasetStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'ready', label: 'Ready' },
  { value: 'importing', label: 'Importing' },
  { value: 'validating', label: 'Validating' },
  { value: 'uploading', label: 'Uploading' },
  { value: 'failed', label: 'Failed' },
];

/**
 * Grid list of datasets with search and filters
 */
export function DatasetList({
  datasets,
  isLoading,
  selectedId,
  onSelect,
  onViewEpisodes,
  onDelete,
  onRetryImport,
  showFilters = true,
  filtersActive = false,
  selectedIds,
  onToggleSelection,
  onClearSelection,
  onPrepareTraining,
  maxSelection,
}: DatasetListProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DatasetStatus | 'all'>('all');

  const selectable = !!onToggleSelection;
  const selection = selectedIds ?? [];

  const filteredDatasets = datasets.filter((dataset) => {
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      if (
        !dataset.name.toLowerCase().includes(searchLower) &&
        !dataset.description?.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }

    // Status filter
    if (statusFilter !== 'all' && dataset.status !== statusFilter) {
      return false;
    }

    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" label="Loading datasets..." />
      </div>
    );
  }

  const narrowed = filtersActive || !!search || statusFilter !== 'all';

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search datasets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setStatusFilter(option.value)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  statusFilter === option.value
                    ? 'bg-cobalt-500 text-white'
                    : 'bg-theme-secondary/20 text-theme-secondary hover:bg-theme-secondary/30'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredDatasets.length === 0 ? (
        narrowed ? (
          <EmptyState
            title="No datasets match your filters."
            description="Clear a filter to see the rest."
          />
        ) : (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M9 12h6" />
              </svg>
            }
            title="No datasets yet"
            description={
              <>
                Datasets are the fuel for training VLA models. Start by{' '}
                <strong className="text-theme-secondary">uploading your own</strong>,{' '}
                <strong className="text-theme-secondary">importing from HuggingFace</strong>, or{' '}
                <strong className="text-theme-secondary">exporting a teleoperation session</strong>.
              </>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDatasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              selected={dataset.id === selectedId}
              selectable={selectable}
              checked={selection.includes(dataset.id)}
              onToggleChecked={onToggleSelection ? () => onToggleSelection(dataset) : undefined}
              onClick={() => onSelect?.(dataset)}
              onViewEpisodes={onViewEpisodes ? () => onViewEpisodes(dataset) : undefined}
              onDelete={onDelete ? () => onDelete(dataset) : undefined}
              onRetryImport={onRetryImport ? () => onRetryImport(dataset) : undefined}
            />
          ))}
        </div>
      )}

      {showFilters && datasets.length > 0 && (
        <div className="text-sm text-theme-tertiary">
          Showing {filteredDatasets.length} of {datasets.length} datasets
        </div>
      )}

      {/* Sticky because the selection is made by scrolling through a grid: the
          action has to stay where the eye already is. */}
      {selectable && selection.length > 0 && (
        <div
          data-testid="mixture-action-bar"
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cobalt-500/40 bg-theme-card/95 px-4 py-3 shadow-lg backdrop-blur"
        >
          <span className="text-sm text-theme-primary">
            <span className="font-semibold">{selection.length} selected</span>
            {selection.length === 1 && ' — pick another to compare them'}
            {maxSelection !== undefined && selection.length >= maxSelection &&
              ` — ${maxSelection} is the most one comparison takes`}
          </span>
          <div className="flex gap-2">
            {onClearSelection && (
              <Button variant="ghost" size="sm" onClick={onClearSelection}>
                Clear
              </Button>
            )}
            {onPrepareTraining && (
              <Button size="sm" onClick={onPrepareTraining}>
                Prepare training run
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
