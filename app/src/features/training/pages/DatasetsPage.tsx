/**
 * @file DatasetsPage.tsx
 * @description Dataset hub: list, filter, import, generate, push and delete LeRobot datasets
 * @feature training
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  CloudUpload,
  Copy,
  Database,
  GitFork,
  Layers,
  Play,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  Upload,
  Download,
} from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import {
  Button,
  DropdownMenu,
  NextStepBanner,
  PageHeader,
  PipelineBreadcrumb,
  Select,
  confirm,
  toast,
  type RowActionItem,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { DatasetList } from '../components/DatasetList';
import { DatasetUploadModal } from '../components/DatasetUploadModal';
import { HFDatasetBrowserModal } from '../components/HFDatasetBrowserModal';
import { HFPushModal } from '../components/HFPushModal';
import { GenerateSyntheticModal } from '../components/GenerateSyntheticModal';
import { CreateViewModal } from '../components/CreateViewModal';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { CompatibilityModal } from '../components/datasets/CompatibilityModal';
import { datasetViewsApi, trainingApi } from '../api';
import { useDatasetsAutoFetch, useTrainingJobs } from '../hooks';
import { useTrainingStore } from '../store';
import { isDatasetView } from '../types';
import type {
  CreateDatasetViewInput,
  Dataset,
  RobotType,
  SubmitSimRlJobInput,
  SubmitTrainingJobInput,
} from '../types';

type OpenModal = 'upload' | 'hf' | 'generate' | 'compat' | null;

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
  return <DatasetsHub />;
}

function DatasetsHub() {
  const navigate = useNavigate();
  const [modal, setModal] = useState<OpenModal>(null);
  const [pushDataset, setPushDataset] = useState<Dataset | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Dataset | null>(null);
  const [wizardMixture, setWizardMixture] = useState<string[] | null>(null);
  const [robotTypeId, setRobotTypeId] = useState('');
  const [robotTypes, setRobotTypes] = useState<RobotType[]>([]);

  const { datasets, isLoading, error, fetchDatasets, deleteDataset, retryImport } = useDatasetsAutoFetch();
  const { submitJob } = useTrainingJobs();
  const setDatasetFilters = useTrainingStore((state) => state.setDatasetFilters);

  // Real robot types from the server; the list filters on their ids.
  useEffect(() => {
    let cancelled = false;
    void trainingApi
      .listRobotTypes()
      .then((types) => { if (!cancelled) setRobotTypes(types); })
      .catch(() => { /* the filter stays on "All robot types" */ });
    return () => { cancelled = true; };
  }, []);

  const readyDatasets = useMemo(() => datasets.filter((d) => d.status === 'ready'), [datasets]);
  const refresh = useCallback(() => { void fetchDatasets(robotTypeId ? { robotTypeId } : undefined); }, [fetchDatasets, robotTypeId]);

  const changeRobotType = (value: string) => {
    setRobotTypeId(value);
    const filters = { robotTypeId: value || undefined };
    setDatasetFilters(filters);
    void fetchDatasets(filters);
  };

  const askDelete = async (d: Dataset) => {
    const view = isDatasetView(d);
    const ok = await confirm({
      title: `Delete ${d.name}?`,
      description: view
        ? 'The view is removed. The dataset it selects from is kept.'
        : 'Its files and episodes are removed. Training jobs that used it keep their results.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDataset(d.id);
      toast.success(view ? 'View deleted' : 'Dataset deleted', { description: d.name });
    } catch (err) {
      toast.error(`Couldn't delete ${view ? 'view' : 'dataset'}`, { description: getErrorMessage(err, d.name) });
    }
  };

  const retry = async (d: Dataset) => {
    try {
      await retryImport(d.id);
      toast.success('Import restarted', { description: d.name });
    } catch (err) {
      toast.error("Couldn't restart the import", { description: getErrorMessage(err, d.name) });
    }
  };

  const duplicate = (view: Dataset) => {
    if (!view.parentDatasetId || !view.selection) {
      toast.error("Couldn't duplicate view", {
        description: `"${view.name}" does not carry the selection it was built from — open its parent dataset to fork it again.`,
      });
      return;
    }
    setDuplicateSource(view);
  };

  const rowActions = (d: Dataset): RowActionItem[] => {
    const ready = d.status === 'ready';
    const frozen = isDatasetView(d) && !!d.frozenAt;
    const items: RowActionItem[] = [];
    if (ready) {
      items.push(
        { label: 'Open episodes', icon: <Play />, onSelect: () => navigate(`/datasets/${d.id}/episodes`) },
        { label: 'Train a model', icon: <Layers />, onSelect: () => setWizardMixture([d.id]) },
        frozen
          ? { label: 'Duplicate view', icon: <Copy />, onSelect: () => duplicate(d) }
          : { label: 'Create view', icon: <GitFork />, onSelect: () => navigate(`/datasets/${d.id}/episodes`) },
        { label: 'Push to Hugging Face', icon: <CloudUpload />, onSelect: () => setPushDataset(d) },
      );
    }
    if (d.status === 'failed' && d.huggingFaceRepoId) {
      items.push({ label: 'Retry import', icon: <RotateCw />, onSelect: () => void retry(d) });
    }
    if (!frozen) {
      items.push({
        label: 'Delete',
        icon: <Trash2 />,
        tone: 'danger',
        separatorBefore: items.length > 0,
        onSelect: () => void askDelete(d),
      });
    }
    return items;
  };

  const submitWizard = useCallback(
    async (input: SubmitTrainingJobInput | SubmitSimRlJobInput) => {
      await submitJob(input);
      setWizardMixture(null);
      toast.success('Training job created');
      navigate('/training');
    },
    [submitJob, navigate],
  );

  const duplicateParent = useMemo(
    () => datasets.find((d) => d.id === duplicateSource?.parentDatasetId) ?? duplicateSource?.parent ?? null,
    [datasets, duplicateSource],
  );

  const createDuplicate = useCallback(
    async (input: CreateDatasetViewInput) => {
      const parentId = duplicateSource?.parentDatasetId;
      if (!parentId) throw new Error('No parent dataset to fork');
      const created = await datasetViewsApi.createView(parentId, input);
      toast.success('View created', { description: input.name });
      refresh();
      return created;
    },
    [duplicateSource, refresh],
  );

  const newMenu = (
    <DropdownMenu
      label="New dataset"
      trigger={<Button leftIcon={<Plus className="h-4 w-4" />} rightIcon={<ChevronDown className="h-4 w-4" />}>New dataset</Button>}
      items={[
        { label: 'Upload files', icon: <Upload />, onSelect: () => setModal('upload') },
        { label: 'Import from Hugging Face', icon: <Download />, onSelect: () => setModal('hf') },
        { label: 'Generate synthetic', icon: <Sparkles />, onSelect: () => setModal('generate') },
        { label: 'Check compatibility', icon: <Layers />, separatorBefore: true, onSelect: () => setModal('compat') },
      ]}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Datasets"
        description="LeRobot datasets you collected, imported or generated — the input to training."
        actions={newMenu}
      >
        <PipelineBreadcrumb stage="dataset" />
      </PageHeader>

      <DatasetList
        datasets={datasets}
        isLoading={isLoading}
        error={error}
        onRetry={refresh}
        robotTypes={robotTypes}
        onSelect={(d) => navigate(`/datasets/${d.id}/episodes`)}
        rowActions={rowActions}
        filtersActive={!!robotTypeId}
        onClearFilters={() => changeRobotType('')}
        emptyAction={newMenu}
        extraFilters={
          robotTypes.length > 0 && (
            <Select
              aria-label="Robot type"
              fullWidth={false}
              className="w-48"
              placeholder="All robot types"
              options={robotTypes.map((t) => ({ value: t.id, label: t.name }))}
              value={robotTypeId}
              onChange={(e) => changeRobotType(e.target.value)}
            />
          )
        }
      />

      {readyDatasets.length > 0 && (
        <NextStepBanner
          variant="subtle"
          title="Train a policy"
          description={`${readyDatasets.length} dataset${readyDatasets.length === 1 ? ' is' : 's are'} ready to train on.`}
          ctaLabel="Open training"
          ctaHref="/training"
        />
      )}

      <DatasetUploadModal isOpen={modal === 'upload'} onClose={() => setModal(null)} onSuccess={refresh} robotTypes={robotTypes} />
      <HFDatasetBrowserModal isOpen={modal === 'hf'} onClose={() => setModal(null)} onSuccess={refresh} existingDatasets={datasets} />
      <GenerateSyntheticModal
        isOpen={modal === 'generate'}
        onClose={() => setModal(null)}
        onSuccess={refresh}
        onViewDataset={(id) => navigate(`/datasets/${id}/episodes`)}
      />
      <CompatibilityModal
        isOpen={modal === 'compat'}
        onClose={() => setModal(null)}
        datasets={readyDatasets}
        onContinue={(ids) => { setModal(null); setWizardMixture(ids); }}
      />
      {pushDataset && (
        <HFPushModal
          isOpen
          onClose={() => setPushDataset(null)}
          onSuccess={refresh}
          datasetId={pushDataset.id}
          datasetName={pushDataset.name}
        />
      )}
      <TrainingJobWizard
        isOpen={wizardMixture !== null}
        onClose={() => setWizardMixture(null)}
        onSubmit={submitWizard}
        datasets={datasets}
        initialMixture={(wizardMixture ?? []).map((datasetId) => ({ datasetId, weight: 1 }))}
      />
      {duplicateSource?.selection && (
        <CreateViewModal
          isOpen
          onClose={() => setDuplicateSource(null)}
          parentName={duplicateParent?.name ?? 'the parent dataset'}
          parentEpisodeCount={duplicateParent?.demonstrationCount ?? duplicateSource.selection.episodes.length}
          duplicateOf={{ name: duplicateSource.name, selection: duplicateSource.selection }}
          onCreate={createDuplicate}
        />
      )}
    </div>
  );
}
