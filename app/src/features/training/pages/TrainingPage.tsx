/**
 * @file TrainingPage.tsx
 * @description Main page for VLA training management
 * @feature training
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Brain, BarChart3, FlaskConical, Wrench } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, Tabs } from '@/shared/components/ui';
import { PipelineBreadcrumb } from '@/shared/components/ui/PipelineBreadcrumb';
import { TrainingJobList } from '../components/TrainingJobList';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { TrainingProgressMonitor } from '../components/TrainingProgressMonitor';
import { WorkerStatusPanel } from '../components/WorkerStatusPanel';
import { QueueStatsDisplay } from '../components/QueueStatsDisplay';
import {
  useTrainingJobsAutoFetch,
  useDatasetsAutoFetch,
  useTrainingProgress,
  useWorkersAutoFetch,
  useQueueStatsAutoFetch,
} from '../hooks';
import type { TrainingJob } from '../types';
import { SimulationPage } from '@/features/simulation/pages/SimulationPage';
import { EvaluationDashboardPage } from '@/features/evaluation/pages/EvaluationDashboardPage';

type OuterTab = 'jobs' | 'simulation' | 'evaluation';
type InnerTab = 'active' | 'history';

/**
 * Main training management page
 */
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

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<TrainingJob | null>(null);
  const [activeTab, setActiveTab] = useState<InnerTab>('active');

  // Outer tab state — Jobs / Simulation / Evaluation. Persist via ?tab=
  // so deep links and the legacy /simulation /evaluation redirects in
  // App.tsx land users on the right tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const outerTab: OuterTab =
    tabParam === 'simulation' || tabParam === 'evaluation' ? tabParam : 'jobs';
  const setOuterTab = (id: OuterTab) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'jobs') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  const { jobs, isLoading: jobsLoading, submitJob, cancelJob, retryJob } = useTrainingJobsAutoFetch();
  const { datasets } = useDatasetsAutoFetch();
  const { workers, isLoading: workersLoading, refresh: refreshWorkers } = useWorkersAutoFetch(10000);
  const { queueStats, isLoading: queueLoading } = useQueueStatsAutoFetch(30000);

  // Connect to WebSocket for real-time progress
  useTrainingProgress();

  // Separate active and completed jobs
  const activeJobs = jobs.filter((j) => ['pending', 'queued', 'running'].includes(j.status));
  const historyJobs = jobs.filter((j) => ['completed', 'failed', 'cancelled'].includes(j.status));

  const handleSelectJob = (job: TrainingJob) => {
    setSelectedJob(job);
  };

  const handleCancelJob = async (id: string) => {
    await cancelJob(id);
    if (selectedJob?.id === id) {
      setSelectedJob(null);
    }
  };

  const handleRetryJob = async (id: string) => {
    await retryJob(id);
  };

  const handleSubmitJob = async (input: Parameters<typeof submitJob>[0]) => {
    const job = await submitJob(input);
    setSelectedJob(job);
    setActiveTab('active');
  };

  // Auto-select first active job if none selected
  useEffect(() => {
    if (!selectedJob && activeJobs.length > 0) {
      setSelectedJob(activeJobs[0]);
    }
  }, [selectedJob, activeJobs]);

  // Update selected job when jobs refresh
  useEffect(() => {
    if (selectedJob) {
      const updated = jobs.find((j) => j.id === selectedJob.id);
      if (updated) {
        setSelectedJob(updated);
      }
    }
  }, [jobs, selectedJob]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Training</h1>
          <p className="text-theme-secondary mt-1">
            Fine-tune VLA models on your robot datasets
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PipelineBreadcrumb stage="train" />
          {outerTab === 'jobs' && (
            <Button onClick={() => setIsWizardOpen(true)}>
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
              New Training Job
            </Button>
          )}
        </div>
      </header>

      <Tabs
        activeTab={outerTab}
        onTabChange={(id) => setOuterTab(id as OuterTab)}
        tabs={[
          {
            id: 'jobs',
            label: 'Jobs',
            icon: <Wrench className="w-4 h-4" />,
            content: renderJobsTab(),
          },
          {
            id: 'simulation',
            label: 'Simulation',
            icon: <FlaskConical className="w-4 h-4" />,
            content: <SimulationPage />,
          },
          {
            id: 'evaluation',
            label: 'Evaluation',
            icon: <BarChart3 className="w-4 h-4" />,
            content: <EvaluationDashboardPage />,
          },
        ]}
      />
    </div>
  );

  // Jobs tab body — extracted so the outer Tabs config above stays
  // short. Holds the original 2-column grid + Active/History sub-tabs.
  function renderJobsTab() {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Job list and tabs */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as InnerTab)}
            tabs={[
              {
                id: 'active',
                label: `Active (${activeJobs.length})`,
                content: (
                  <TrainingJobList
                    jobs={activeJobs}
                    isLoading={jobsLoading}
                    selectedId={selectedJob?.id}
                    onSelect={handleSelectJob}
                    onCancel={handleCancelJob}
                    showFilters={false}
                  />
                ),
              },
              {
                id: 'history',
                label: `History (${historyJobs.length})`,
                content: (
                  <TrainingJobList
                    jobs={historyJobs}
                    isLoading={jobsLoading}
                    selectedId={selectedJob?.id}
                    onSelect={handleSelectJob}
                    onRetry={handleRetryJob}
                    showFilters={true}
                  />
                ),
              },
            ]}
          />

          {activeJobs.length === 0 && activeTab === 'active' && !jobsLoading && (
            <div className="text-center py-12 bg-theme-secondary/10 rounded-lg">
              <svg
                className="w-12 h-12 mx-auto text-theme-tertiary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-theme-primary">
                No Active Training Jobs
              </h3>
              <p className="mt-2 text-theme-secondary">
                Start a new training job to fine-tune a VLA model on your dataset.
              </p>
              <Button className="mt-4" onClick={() => setIsWizardOpen(true)}>
                Start Training
              </Button>
            </div>
          )}
        </div>

        {/* Right column: worker status and queue stats */}
        <div className="space-y-4">
          <WorkerStatusPanel
            workers={workers}
            isLoading={workersLoading}
            onRefresh={refreshWorkers}
          />

          <QueueStatsDisplay stats={queueStats} isLoading={queueLoading} />
        </div>
      </div>

      {/* Selected job detail */}
      {selectedJob && (
        <div className="mt-6">
          <TrainingProgressMonitor
            job={selectedJob}
            onCancel={
              ['running', 'queued'].includes(selectedJob.status)
                ? () => handleCancelJob(selectedJob.id)
                : undefined
            }
            showLossCurve={true}
          />
        </div>
      )}

        {/* Training job wizard */}
        <TrainingJobWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onSubmit={handleSubmitJob}
          datasets={datasets}
          isSubmitting={false}
        />
      </div>
    );
  }
}
