/**
 * @file DatasetsPage.tsx
 * @description Page for managing training datasets
 * @feature training
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Plus, Sparkles } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, Modal, PageHeader } from '@/shared/components/ui';
import { PipelineBreadcrumb } from '@/shared/components/ui/PipelineBreadcrumb';
import { DatasetList } from '../components/DatasetList';
import { DatasetUploadModal } from '../components/DatasetUploadModal';
import { HFDatasetBrowserModal } from '../components/HFDatasetBrowserModal';
import { HFPushModal } from '../components/HFPushModal';
import { GenerateSyntheticModal } from '../components/GenerateSyntheticModal';
import { useDatasetsAutoFetch } from '../hooks';
import { useTrainingStore } from '../store';
import type { Dataset, DatasetQueryParams } from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

/**
 * Main page for dataset management
 */
export function DatasetsPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Dataset Hub"
        icon={<Database className="w-12 h-12" />}
        description="Manage and version your robot training datasets. Import from LeRobot, annotate episodes, and prepare data for training."
        capabilities={[
          'Browse and filter teleoperation episodes',
          'Import datasets from Hugging Face / LeRobot format',
          'Annotate and label robot trajectories',
          'Export datasets for training pipelines',
        ]}
        docsSlug="VLA-integration-guide"
      />
    );
  }

  const navigate = useNavigate();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isHFBrowserOpen, setIsHFBrowserOpen] = useState(false);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [pushDataset, setPushDataset] = useState<Dataset | null>(null);
  const [datasetToDelete, setDatasetToDelete] = useState<Dataset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filters, setFilters] = useState<DatasetQueryParams>({});
  const [showSyntheticOnly, setShowSyntheticOnly] = useState(false);

  const { datasets, isLoading, error, fetchDatasets, deleteDataset } = useDatasetsAutoFetch();
  const setDatasetFilters = useTrainingStore((state) => state.setDatasetFilters);

  const syntheticCount = useMemo(
    () => datasets.filter((d) => d.infoJson?._synthetic).length,
    [datasets],
  );
  const displayedDatasets = useMemo(
    () => (showSyntheticOnly ? datasets.filter((d) => d.infoJson?._synthetic) : datasets),
    [datasets, showSyntheticOnly],
  );

  const handleUploadSuccess = () => {
    fetchDatasets();
  };

  const handleSelectDataset = (dataset: Dataset) => {
    navigate(`/datasets/${dataset.id}/episodes`);
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
      <PageHeader
        title="Datasets"
        subtitle="Manage training datasets for VLA models"
        actions={
          <>
            <PipelineBreadcrumb stage="dataset" />
            <Button variant="ghost" onClick={() => setIsHFBrowserOpen(true)}>
              Import from Hub
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsGenerateOpen(true)}
              leftIcon={<Sparkles className="h-4 w-4" />}
            >
              Generate Synthetic
            </Button>
            <Button onClick={() => setIsUploadModalOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Upload Dataset
            </Button>
          </>
        }
      />

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
          className="px-3 py-2 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-cobalt-500"
        >
          <option value="">All Robot Types</option>
          <option value="humanoid">Humanoid</option>
          <option value="mobile">Mobile Robot</option>
          <option value="arm">Robotic Arm</option>
        </select>
        <select
          value={filters.skillId || ''}
          onChange={(e) => handleFilterChange('skillId', e.target.value)}
          className="px-3 py-2 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-cobalt-500"
        >
          <option value="">All Skills</option>
          <option value="pick_and_place">Pick and Place</option>
          <option value="navigation">Navigation</option>
          <option value="manipulation">Manipulation</option>
        </select>
        {(syntheticCount > 0 || showSyntheticOnly) && (
          <button
            onClick={() => setShowSyntheticOnly((v) => !v)}
            className={`flex items-center gap-1.5 rounded-brand border px-3 py-2 text-sm transition-colors ${
              showSyntheticOnly
                ? 'border-purple-500/50 bg-purple-500/10 text-purple-300'
                : 'border-theme-secondary/30 text-theme-secondary hover:border-purple-500/40'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Synthetic only
          </button>
        )}
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
            label="Synthetic"
            value={syntheticCount}
            color="purple"
          />
          <StatCard
            label="Total Frames"
            value={datasets.reduce((acc, d) => acc + d.totalFrames, 0).toLocaleString(UI_DATE_LOCALE)}
          />
        </div>
      )}

      {/* Dataset list */}
      <DatasetList
        datasets={displayedDatasets}
        isLoading={isLoading}
        onSelect={handleSelectDataset}
        onViewEpisodes={(dataset) => navigate(`/datasets/${dataset.id}/episodes`)}
        onDelete={handleDeleteClick}
      />

      {/* Upload modal */}
      <DatasetUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* HuggingFace import modal */}
      <HFDatasetBrowserModal
        isOpen={isHFBrowserOpen}
        onClose={() => setIsHFBrowserOpen(false)}
        onSuccess={handleUploadSuccess}
        existingDatasets={datasets}
      />

      {/* Cosmos 3 synthetic generation wizard */}
      <GenerateSyntheticModal
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        onSuccess={() => fetchDatasets()}
        onViewDataset={(datasetId) => navigate(`/datasets/${datasetId}/episodes`)}
      />

      {/* HuggingFace push modal */}
      {pushDataset && (
        <HFPushModal
          isOpen={!!pushDataset}
          onClose={() => setPushDataset(null)}
          onSuccess={() => fetchDatasets()}
          datasetId={pushDataset.id}
          datasetName={pushDataset.name}
        />
      )}

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
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'purple';
}

function StatCard({ label, value, color }: StatCardProps) {
  const colorClasses = {
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    purple: 'text-purple-400',
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
