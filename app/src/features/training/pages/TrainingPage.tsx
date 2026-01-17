/**
 * @file TrainingPage.tsx
 * @description Main page for VLA training management
 * @feature training
 */

import { useState, useEffect } from 'react';
import { Button, Tabs } from '@/shared/components/ui';
import { TrainingJobList } from '../components/TrainingJobList';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { TrainingProgressMonitor } from '../components/TrainingProgressMonitor';
import { GpuAvailabilityPanel } from '../components/GpuAvailabilityPanel';
import { QueueStatsDisplay } from '../components/QueueStatsDisplay';
import {
  useTrainingJobsAutoFetch,
  useDatasetsAutoFetch,
  useTrainingProgress,
  useGpuAvailabilityAutoFetch,
  useQueueStatsAutoFetch,
} from '../hooks';
import type { TrainingJob } from '../types';

type TabValue = 'active' | 'history';

/**
 * Main training management page
 */
export function TrainingPage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<TrainingJob | null>(null);
  const [activeTab, setActiveTab] = useState<TabValue>('active');

  const { jobs, isLoading: jobsLoading, submitJob, cancelJob, retryJob } = useTrainingJobsAutoFetch();
  const { datasets } = useDatasetsAutoFetch();
  const { gpuAvailability, isLoading: gpuLoading, refresh: refreshGpu } = useGpuAvailabilityAutoFetch(30000);
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
      </header>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Job list and tabs */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as TabValue)}
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

        {/* Right column: GPU status and selected job */}
        <div className="space-y-4">
          <GpuAvailabilityPanel
            availability={gpuAvailability}
            isLoading={gpuLoading}
            onRefresh={refreshGpu}
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
        gpuAvailability={gpuAvailability ?? undefined}
        isSubmitting={false}
      />
    </div>
  );
}
