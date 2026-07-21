/**
 * @file DatasetList.tsx
 * @description Grid list of datasets with filters
 * @feature training
 */

import { useState } from 'react';
import { Input, Spinner, EmptyState } from '@/shared/components/ui';
import { DatasetCard } from './DatasetCard';
import type { Dataset, DatasetStatus } from '../types';

export interface DatasetListProps {
  datasets: Dataset[];
  isLoading?: boolean;
  selectedId?: string;
  onSelect?: (dataset: Dataset) => void;
  onViewEpisodes?: (dataset: Dataset) => void;
  onDelete?: (dataset: Dataset) => void;
  showFilters?: boolean;
}

const statusOptions: { value: DatasetStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'ready', label: 'Ready' },
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
  showFilters = true,
}: DatasetListProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DatasetStatus | 'all'>('all');

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
        datasets.length === 0 ? (
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
        ) : (
          <EmptyState title="No datasets match your filters." />
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDatasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              selected={dataset.id === selectedId}
              onClick={() => onSelect?.(dataset)}
              onViewEpisodes={onViewEpisodes ? () => onViewEpisodes(dataset) : undefined}
              onDelete={onDelete ? () => onDelete(dataset) : undefined}
            />
          ))}
        </div>
      )}

      {showFilters && datasets.length > 0 && (
        <div className="text-sm text-theme-tertiary">
          Showing {filteredDatasets.length} of {datasets.length} datasets
        </div>
      )}
    </div>
  );
}
