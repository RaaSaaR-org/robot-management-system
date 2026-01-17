/**
 * @file DeploymentsPage.tsx
 * @description Main deployments page with list and detail views
 * @feature deployment
 */

import { useState, useEffect, useMemo } from 'react';
import { Card, Button } from '@/shared/components/ui';
import { useDeploymentStore } from '../store';
import { DeploymentCard, CanaryConfig, RollbackConfirmation } from '../components';
import type { Deployment, CreateDeploymentInput } from '../types';

type TabValue = 'active' | 'history';

export function DeploymentsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('active');
  const [showCanaryConfig, setShowCanaryConfig] = useState(false);
  const [rollbackDeployment, setRollbackDeployment] = useState<Deployment | null>(null);

  // Direct store access - simpler pattern
  const deployments = useDeploymentStore((s) => s.deployments);
  const isLoading = useDeploymentStore((s) => s.deploymentsLoading);
  const error = useDeploymentStore((s) => s.deploymentsError);
  const modelVersions = useDeploymentStore((s) => s.modelVersions);
  const modelsLoading = useDeploymentStore((s) => s.modelVersionsLoading);

  // Actions
  const fetchDeployments = useDeploymentStore((s) => s.fetchDeployments);
  const fetchModelVersions = useDeploymentStore((s) => s.fetchModelVersions);
  const createDeployment = useDeploymentStore((s) => s.createDeployment);
  const startDeployment = useDeploymentStore((s) => s.startDeployment);
  const rollback = useDeploymentStore((s) => s.rollbackDeployment);

  // Derived state
  const activeDeployments = useMemo(
    () => deployments.filter(
      (d) => d.status === 'pending' || d.status === 'deploying' || d.status === 'canary'
    ),
    [deployments]
  );

  const completedDeployments = useMemo(
    () => deployments.filter(
      (d) => d.status === 'production' || d.status === 'failed'
    ),
    [deployments]
  );

  // Fetch data on mount
  useEffect(() => {
    fetchDeployments();
    fetchModelVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateDeployment = async (input: CreateDeploymentInput) => {
    const deployment = await createDeployment(input);
    if (deployment) {
      await startDeployment(deployment.id);
    }
  };

  const handleRollback = async (reason: string) => {
    if (rollbackDeployment) {
      await rollback(rollbackDeployment.id, reason);
      setRollbackDeployment(null);
    }
  };

  const displayDeployments = activeTab === 'active' ? activeDeployments : completedDeployments;

  // Stats
  const stats = {
    active: activeDeployments.length,
    pending: deployments.filter((d) => d.status === 'pending').length,
    completed: completedDeployments.length,
    failed: deployments.filter((d) => d.status === 'failed').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Deployments</h1>
          <p className="text-sm text-theme-secondary mt-1">
            Manage model deployments across your robot fleet
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCanaryConfig(true)}>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Deployment
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Active</p>
              <p className="text-2xl font-bold text-theme-primary">{stats.active}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Pending</p>
              <p className="text-2xl font-bold text-theme-primary">{stats.pending}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Completed</p>
              <p className="text-2xl font-bold text-theme-primary">{stats.completed}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Failed</p>
              <p className="text-2xl font-bold text-theme-primary">{stats.failed}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </Card>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-2 border-b border-theme pb-2">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
            activeTab === 'active'
              ? 'text-cobalt-500 border-b-2 border-cobalt-500'
              : 'text-theme-secondary hover:text-theme-primary'
          }`}
        >
          Active ({activeDeployments.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
            activeTab === 'history'
              ? 'text-cobalt-500 border-b-2 border-cobalt-500'
              : 'text-theme-secondary hover:text-theme-primary'
          }`}
        >
          History ({completedDeployments.length})
        </button>
      </div>

      {/* Error */}
      {error && (
        <Card className="p-4 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt-500" />
        </div>
      )}

      {/* Deployments list */}
      {!isLoading && displayDeployments.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {displayDeployments.map((deployment) => (
            <DeploymentCard
              key={deployment.id}
              deployment={deployment}
              onClick={() => setRollbackDeployment(deployment)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && displayDeployments.length === 0 && (
        <Card className="text-center py-12">
          <svg
            className="w-12 h-12 mx-auto text-theme-tertiary mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-theme-secondary mb-4">
            {activeTab === 'active'
              ? 'No active deployments'
              : 'No deployment history yet'}
          </p>
          {activeTab === 'active' && (
            <Button variant="primary" onClick={() => setShowCanaryConfig(true)}>
              Start your first deployment
            </Button>
          )}
        </Card>
      )}

      {/* Canary Config Modal */}
      <CanaryConfig
        isOpen={showCanaryConfig}
        onClose={() => setShowCanaryConfig(false)}
        onSubmit={handleCreateDeployment}
        modelVersions={modelVersions.filter((v: { deploymentStatus: string }) => v.deploymentStatus === 'staging')}
        isLoading={modelsLoading}
      />

      {/* Rollback Confirmation Modal */}
      {rollbackDeployment && (
        <RollbackConfirmation
          deployment={rollbackDeployment}
          isOpen={!!rollbackDeployment}
          onClose={() => setRollbackDeployment(null)}
          onConfirm={handleRollback}
        />
      )}
    </div>
  );
}
