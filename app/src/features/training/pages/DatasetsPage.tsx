/**
 * @file DatasetsPage.tsx
 * @description Page for managing training datasets
 * @feature training
 */

import { useState } from 'react';
import { Button, Modal } from '@/shared/components/ui';
import { DatasetList } from '../components/DatasetList';
import { DatasetUploadModal } from '../components/DatasetUploadModal';
import { useDatasetsAutoFetch } from '../hooks';
import { useTrainingStore } from '../store';
import type { Dataset, DatasetQueryParams } from '../types';

/**
 * Main page for dataset management
 */
export function DatasetsPage() {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [datasetToDelete, setDatasetToDelete] = useState<Dataset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filters, setFilters] = useState<DatasetQueryParams>({});

  const { datasets, isLoading, error, fetchDatasets, deleteDataset } = useDatasetsAutoFetch();
  const setDatasetFilters = useTrainingStore((state) => state.setDatasetFilters);

  const handleUploadSuccess = () => {
    fetchDatasets();
  };

  const handleSelectDataset = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    // In a full implementation, this could open a detail view or drawer
  };

  const handleDeleteClick = (dataset: Dataset) => {
    setDatasetToDelete(dataset);
  };

  const handleConfirmDelete = async () => {
    if (!datasetToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDataset(datasetToDelete.id);
      setDatasetToDelete(null);
      if (selectedDataset?.id === datasetToDelete.id) {
        setSelectedDataset(null);
      }
    } catch (err) {
      console.error('Failed to delete dataset:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFilterChange = (key: keyof DatasetQueryParams, value: string) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    setDatasetFilters(newFilters);
    fetchDatasets(newFilters);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Datasets</h1>
          <p className="text-theme-secondary mt-1">
            Manage training datasets for VLA models
          </p>
        </div>
        <Button onClick={() => setIsUploadModalOpen(true)}>
          <svg
            className="w-4 h-4 mr-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Upload Dataset
        </Button>
      </header>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded-lg">
          <p>{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchDatasets()}
            className="mt-2"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.robotTypeId || ''}
          onChange={(e) => handleFilterChange('robotTypeId', e.target.value)}
          className="px-3 py-2 rounded-lg border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Robot Types</option>
          <option value="humanoid">Humanoid</option>
          <option value="mobile">Mobile Robot</option>
          <option value="arm">Robotic Arm</option>
        </select>
        <select
          value={filters.skillId || ''}
          onChange={(e) => handleFilterChange('skillId', e.target.value)}
          className="px-3 py-2 rounded-lg border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Skills</option>
          <option value="pick_and_place">Pick and Place</option>
          <option value="navigation">Navigation</option>
          <option value="manipulation">Manipulation</option>
        </select>
      </div>

      {/* Stats summary */}
      {!isLoading && datasets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Datasets"
            value={datasets.length}
          />
          <StatCard
            label="Ready"
            value={datasets.filter((d) => d.status === 'ready').length}
            color="green"
          />
          <StatCard
            label="Validating"
            value={datasets.filter((d) => d.status === 'validating').length}
            color="yellow"
          />
          <StatCard
            label="Total Frames"
            value={datasets.reduce((acc, d) => acc + d.totalFrames, 0).toLocaleString()}
          />
        </div>
      )}

      {/* Dataset list */}
      <DatasetList
        datasets={datasets}
        isLoading={isLoading}
        selectedId={selectedDataset?.id}
        onSelect={handleSelectDataset}
      />

      {/* Selected dataset actions */}
      {selectedDataset && (
        <div className="fixed bottom-6 right-6 flex gap-2">
          <Button
            variant="destructive"
            onClick={() => handleDeleteClick(selectedDataset)}
          >
            Delete Selected
          </Button>
        </div>
      )}

      {/* Upload modal */}
      <DatasetUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!datasetToDelete}
        onClose={() => setDatasetToDelete(null)}
        title="Delete Dataset"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-theme-secondary">
            Are you sure you want to delete <span className="font-semibold text-theme-primary">{datasetToDelete?.name}</span>?
          </p>
          <p className="text-sm text-theme-tertiary">
            This action cannot be undone. All associated data will be permanently removed.
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setDatasetToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} isLoading={isDeleting}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  color?: 'green' | 'yellow' | 'red' | 'blue';
}

function StatCard({ label, value, color }: StatCardProps) {
  const colorClasses = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
  };

  return (
    <div className="p-4 rounded-lg bg-theme-secondary/10">
      <p className="text-sm text-theme-secondary">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ? colorClasses[color] : 'text-theme-primary'}`}>
        {value}
      </p>
    </div>
  );
}
