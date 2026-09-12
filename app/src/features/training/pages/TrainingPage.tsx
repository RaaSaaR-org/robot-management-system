/**
 * @file TrainingPage.tsx
 * @description Training studio: train policies on datasets (Jobs), then evaluate them in simulation and on hardware
 * @feature training
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Brain, Play, Plus } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, PageHeader, PipelineBreadcrumb, Tabs } from '@/shared/components/ui';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { JobsSection } from '../components/jobs/JobsSection';
import { useDatasetsAutoFetch, useTrainingJobs } from '../hooks';
import { SimulationPage } from '@/features/simulation/pages/SimulationPage';
import { EvaluationDashboardPage } from '@/features/evaluation/pages/EvaluationDashboardPage';

const TABS = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'evaluation', label: 'Evaluation' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function TrainingPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Training Studio"
        icon={<Brain className="w-12 h-12" />}
        description="End-to-end ML training pipeline for robot behavior models. Collect teleoperation data, train VLA models, and deploy to your fleet."
        capabilities={[
          'Record teleoperation episodes with your robot',
          'Train SmolVLA / GR00T models on custom data',
          'Monitor training progress with live metrics',
          'Manage training jobs across GPU clusters',
        ]}
        docsSlug="VLA-integration-guide"
      />
    );
  }
  return <TrainingStudio />;
}

function TrainingStudio() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'jobs';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams();
        if (id !== 'jobs') next.set('tab', id);
        // Section-local params (?job, ?view, ?run) do not survive a tab switch.
        void p;
        return next;
      },
      { replace: true }
    );

  const [wizardOpen, setWizardOpen] = useState(false);
  const [simLaunchOpen, setSimLaunchOpen] = useState(false);
  const [hwTestOpen, setHwTestOpen] = useState(false);
  const { datasets } = useDatasetsAutoFetch();
  const { jobs, submitJob, fetchJobs } = useTrainingJobs();
  const running = jobs.filter((j) => j.status === 'running').length;

  const primary =
    tab === 'jobs' ? (
      <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>New training job</Button>
    ) : tab === 'simulation' ? (
      <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setSimLaunchOpen(true)}>New sim run</Button>
    ) : (
      <Button leftIcon={<Play className="h-4 w-4" />} onClick={() => setHwTestOpen(true)}>Run hardware test</Button>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Training"
        description="Train policies on your datasets, then evaluate them in simulation and on hardware."
        actions={primary}
      >
        <PipelineBreadcrumb stage={tab === 'jobs' ? 'train' : 'evaluate'} />
      </PageHeader>

      <Tabs
        tabs={TABS.map(({ id, label }) => ({ id, label, count: id === 'jobs' && running > 0 ? running : undefined }))}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'jobs' && <JobsSection onNew={() => setWizardOpen(true)} />}
      {tab === 'simulation' && <SimulationPage launchOpen={simLaunchOpen} onLaunchOpenChange={setSimLaunchOpen} />}
      {tab === 'evaluation' && <EvaluationDashboardPage testOpen={hwTestOpen} onTestOpenChange={setHwTestOpen} />}

      <TrainingJobWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSubmit={async (input) => {
          const job = await submitJob(input);
          setParams((p) => { p.delete('tab'); p.set('job', job.id); return p; });
          // The create response carries no dataset names; the list does.
          void fetchJobs();
        }}
        datasets={datasets}
      />
    </div>
  );
}
