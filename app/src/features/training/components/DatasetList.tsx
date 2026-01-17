/**
 * @file DatasetList.tsx
 * @description Grid list of datasets with filters
 * @feature training
 */

import { useState } from 'react';
import { Input, Spinner } from '@/shared/components/ui';
import { DatasetCard } from './DatasetCard';
import type { Dataset, DatasetStatus } from '../types';

export interface DatasetListProps {
  datasets: Dataset[];
  isLoading?: boolean;
  selectedId?: string;
  onSelect?: (dataset: Dataset) => void;
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
                    ? 'bg-primary-500 text-white'
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
        <div className="text-center py-12">
          <p className="text-theme-secondary">
            {datasets.length === 0
              ? 'No datasets found. Upload a dataset to get started.'
              : 'No datasets match your filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDatasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              selected={dataset.id === selectedId}
              onClick={() => onSelect?.(dataset)}
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
