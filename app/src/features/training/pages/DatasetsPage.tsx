/**
 * @file DatasetsPage.tsx
 * @description Page for managing training datasets
 * @feature training
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { DatasetCompatibilityPanel } from '../components/DatasetCompatibilityPanel';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { trainingApi } from '../api';
import { useDatasetsAutoFetch, useTrainingJobs } from '../hooks';
import { useTrainingStore } from '../store';
import type {
  CompatibilityReport,
  Dataset,
  DatasetQueryParams,
  RobotType,
  SubmitSimRlJobInput,
  SubmitTrainingJobInput,
} from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { getErrorMessage } from '@/shared/utils';

/** What POST /api/datasets/compatibility accepts in one request. */
const MAX_MIXTURE_MEMBERS = 8;

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
  // Why the last delete or retry did not happen. Both used to go to
  // console.error only: the operator clicked Delete, nothing moved, and the
  // reason — including the 409 that names the training jobs still holding the
  // dataset — was visible only with devtools open.
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DatasetQueryParams>({});
  const [showSyntheticOnly, setShowSyntheticOnly] = useState(false);
  const [robotTypes, setRobotTypes] = useState<RobotType[]>([]);

  // Mixture selection: ids picked in the list, the report they produced, and
  // the wizard they hand over to.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCompatibilityOpen, setIsCompatibilityOpen] = useState(false);
  const [report, setReport] = useState<CompatibilityReport | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const { datasets, isLoading, error, fetchDatasets, deleteDataset, retryImport } =
    useDatasetsAutoFetch();
  const { submitJob } = useTrainingJobs();
  const setDatasetFilters = useTrainingStore((state) => state.setDatasetFilters);

  // The robot-type filter used to offer "humanoid" / "mobile" / "arm" against a
  // UUID column, so every option matched nothing and the list then said "No
  // datasets yet" — a filter that looked like an empty database.
  useEffect(() => {
    let cancelled = false;
    void trainingApi
      .listRobotTypes()
      .then((types) => { if (!cancelled) setRobotTypes(types); })
      .catch(() => { /* the filter stays on "All robot types" */ });
    return () => { cancelled = true; };
  }, []);

  const syntheticCount = useMemo(
    () => datasets.filter((d) => d.infoJson?._synthetic).length,
    [datasets],
  );
  const readyDatasets = useMemo(
    () => datasets.filter((d) => d.status === 'ready'),
    [datasets],
  );
  const failedCount = useMemo(
    () => datasets.filter((d) => d.status === 'failed').length,
    [datasets],
  );
  const displayedDatasets = useMemo(
    () => (showSyntheticOnly ? datasets.filter((d) => d.infoJson?._synthetic) : datasets),
    [datasets, showSyntheticOnly],
  );

  // Only the skills some dataset actually carries. The three hardcoded options
  // this replaces were slugs matched against a UUID column.
  const skillIds = useMemo(() => {
    const seen = new Set<string>();
    for (const dataset of datasets) {
      if (dataset.skillId) seen.add(dataset.skillId);
    }
    return [...seen];
  }, [datasets]);

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
    setActionError(null);
    try {
      await deleteDataset(datasetToDelete.id);
      setDatasetToDelete(null);
    } catch (err) {
      console.error('Failed to delete dataset:', err);
      setActionError(getErrorMessage(err, 'Could not delete this dataset'));
      setDatasetToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRetryImport = useCallback(
    async (dataset: Dataset) => {
      setActionError(null);
      try {
        await retryImport(dataset.id);
      } catch (err) {
        console.error('Failed to retry import:', err);
        setActionError(
          getErrorMessage(err, `Could not restart the import of "${dataset.name}"`),
        );
      }
    },
    [retryImport],
  );

  const toggleSelection = useCallback((dataset: Dataset) => {
    setSelectedIds((prev) => {
      if (prev.includes(dataset.id)) return prev.filter((id) => id !== dataset.id);
      // The compatibility endpoint takes at most eight. Refusing the ninth here
      // is better than letting the report come back a 400.
      if (prev.length >= MAX_MIXTURE_MEMBERS) return prev;
      return [...prev, dataset.id];
    });
  }, []);

  const handleSubmitJob = useCallback(
    async (input: SubmitTrainingJobInput | SubmitSimRlJobInput) => {
      await submitJob(input);
      setSelectedIds([]);
      navigate('/training');
    },
    [submitJob, navigate],
  );

  const handleFilterChange = (key: keyof DatasetQueryParams, value: string) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    setDatasetFilters(newFilters);
    fetchDatasets(newFilters);
  };

  const filtersActive = !!filters.robotTypeId || !!filters.skillId || showSyntheticOnly;

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

      {/* An action the operator took that did not happen, and why. Separate
          from `error` (which is the list failing to load) because this one is
          answered by reading it, not by retrying the fetch. */}
      {actionError && (
        <div
          className="p-4 bg-red-100 text-red-700 rounded-lg flex items-start justify-between gap-4"
          data-testid="dataset-action-error"
          role="alert"
        >
          <p className="text-sm">{actionError}</p>
          <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
            Dismiss
          </Button>
        </div>
      )}

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
          aria-label="Filter by robot type"
          className="px-3 py-2 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-cobalt-500"
        >
          <option value="">All Robot Types</option>
          {robotTypes.map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
        {skillIds.length > 0 && (
          <select
            value={filters.skillId || ''}
            onChange={(e) => handleFilterChange('skillId', e.target.value)}
            aria-label="Filter by skill"
            className="px-3 py-2 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm focus:outline-none focus:ring-2 focus:ring-cobalt-500"
          >
            <option value="">All Skills</option>
            {skillIds.map((skillId) => (
              <option key={skillId} value={skillId}>{skillId}</option>
            ))}
          </select>
        )}
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            label="Total Datasets"
            value={datasets.length}
          />
          <StatCard
            label="Ready"
            value={readyDatasets.length}
            color="green"
          />
          <StatCard
            label="Failed"
            value={failedCount}
            color={failedCount > 0 ? 'red' : undefined}
          />
          <StatCard
            label="Synthetic"
            value={syntheticCount}
            color="purple"
          />
          {/* Ready datasets only. A failed import keeps the frame count it read
              out of the Hub's info.json while having downloaded nothing, and
              171,625 of those frames do not exist on this disk. */}
          <StatCard
            label="Total Frames"
            value={readyDatasets
              .reduce((acc, d) => acc + d.totalFrames, 0)
              .toLocaleString(UI_DATE_LOCALE)}
          />
        </div>
      )}

      {/* Dataset list */}
      <DatasetList
        datasets={displayedDatasets}
        isLoading={isLoading}
        filtersActive={filtersActive}
        onSelect={handleSelectDataset}
        onViewEpisodes={(dataset) => navigate(`/datasets/${dataset.id}/episodes`)}
        onDelete={handleDeleteClick}
        onRetryImport={handleRetryImport}
        selectedIds={selectedIds}
        onToggleSelection={toggleSelection}
        onClearSelection={() => setSelectedIds([])}
        onPrepareTraining={() => setIsCompatibilityOpen(true)}
        maxSelection={MAX_MIXTURE_MEMBERS}
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

      {/* Compatibility report for the current selection */}
      <Modal
        isOpen={isCompatibilityOpen}
        onClose={() => setIsCompatibilityOpen(false)}
        title="Can these be trained together?"
        size="full"
      >
        <div className="space-y-4">
          {isCompatibilityOpen && (
            <DatasetCompatibilityPanel datasetIds={selectedIds} onReport={setReport} />
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setIsCompatibilityOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!report || report.verdict === 'incompatible'}
              onClick={() => { setIsCompatibilityOpen(false); setIsWizardOpen(true); }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>

      {/* Training wizard, pre-filled with the selection */}
      <TrainingJobWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onSubmit={handleSubmitJob}
        datasets={datasets}
        initialMixture={selectedIds.map((datasetId) => ({ datasetId, weight: 1 }))}
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
      <p
        data-testid={`stat-${label}`}
        className={`text-2xl font-bold mt-1 ${color ? colorClasses[color] : 'text-theme-primary'}`}
      >
        {value}
      </p>
    </div>
  );
}
