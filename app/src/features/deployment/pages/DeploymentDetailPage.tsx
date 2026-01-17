/**
 * @file DeploymentDetailPage.tsx
 * @description Detailed view of a single deployment
 * @feature deployment
 */

import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Badge } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import { useDeployment } from '../hooks/useDeployment';
import { useDeploymentMetrics } from '../hooks/useDeploymentMetrics';
import { useDeploymentProgress } from '../hooks/useDeploymentProgress';
import {
  DeploymentStatus,
  DeploymentProgress,
  RollbackConfirmation,
  DeploymentStatusBadge,
} from '../components';

type TabValue = 'overview' | 'robots' | 'metrics' | 'events';

export function DeploymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabValue>('overview');
  const [showRollbackModal, setShowRollbackModal] = useState(false);

  const { deployment, isLoading, error, fetchDeployment, promote, rollback, cancel } = useDeployment(
    id!
  );

  const { metrics, isLoading: metricsLoading, startPolling, stopPolling } = useDeploymentMetrics(id!);

  // Subscribe to real-time updates
  useDeploymentProgress();

  // Fetch deployment on mount
  useEffect(() => {
    if (id) {
      fetchDeployment();
    }
  }, [id, fetchDeployment]);

  // Poll metrics when deployment is active
  useEffect(() => {
    if (deployment && ['deploying', 'canary', 'production'].includes(deployment.status)) {
      startPolling();
      return () => stopPolling();
    }
  }, [deployment, startPolling, stopPolling]);

  const handleRollback = async (reason: string) => {
    await rollback(reason);
    setShowRollbackModal(false);
  };

  const handlePromote = async () => {
    await promote();
  };

  const handleCancel = async () => {
    await cancel();
    navigate('/deployments');
  };

  // Calculate current stage
  const { currentStage, nextStageTime } = useMemo(() => {
    if (!deployment || !deployment.canaryConfig) {
      return { currentStage: 0, nextStageTime: undefined };
    }

    const stages = deployment.canaryConfig.stages;
    let stage = 0;

    for (let i = 0; i < stages.length; i++) {
      if (deployment.trafficPercentage >= stages[i].percentage) {
        stage = i + 1;
      }
    }

    // Calculate next stage time (placeholder - would need backend tracking)
    const nextTime = deployment.startedAt
      ? new Date(new Date(deployment.startedAt).getTime() + 60 * 60 * 1000).toISOString()
      : undefined;

    return { currentStage: stage, nextStageTime: nextTime };
  }, [deployment]);

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt-500" />
      </div>
    );
  }

  if (error || !deployment) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center">
          <svg
            className="w-12 h-12 mx-auto text-red-500 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-red-500 mb-4">{error || 'Deployment not found'}</p>
          <Button variant="outline" onClick={() => navigate('/deployments')}>
            Back to Deployments
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/deployments')}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-theme-primary">
                {deployment.modelVersion?.skill?.name || 'Deployment'}
              </h1>
              <DeploymentStatusBadge status={deployment.status} size="lg" />
            </div>
            <p className="text-sm text-theme-secondary mt-1">
              Model v{deployment.modelVersion?.version} · Started{' '}
              {deployment.startedAt
                ? new Date(deployment.startedAt).toLocaleString()
                : 'Not started'}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {deployment.status === 'canary' && (
            <Button variant="primary" onClick={handlePromote}>
              Promote to Production
            </Button>
          )}
          {['deploying', 'canary', 'production'].includes(deployment.status) && (
            <Button variant="destructive" onClick={() => setShowRollbackModal(true)}>
              Rollback
            </Button>
          )}
          {['pending', 'deploying', 'canary'].includes(deployment.status) && (
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-2 border-b border-theme pb-2">
        {(['overview', 'robots', 'metrics', 'events'] as TabValue[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors capitalize ${
              activeTab === tab
                ? 'text-cobalt-500 border-b-2 border-cobalt-500'
                : 'text-theme-secondary hover:text-theme-primary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {activeTab === 'overview' && (
            <>
              <DeploymentStatus
                deployment={deployment}
                metrics={metrics}
                currentStage={currentStage}
                totalStages={deployment.canaryConfig?.stages.length || 0}
                nextStageTime={nextStageTime}
                onPromote={handlePromote}
                onRollback={() => setShowRollbackModal(true)}
                onCancel={handleCancel}
              />

              {/* Deployment info */}
              <Card className="p-6 space-y-4">
                <h3 className="font-semibold text-theme-primary">Deployment Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-theme-secondary">Strategy</span>
                    <p className="font-medium text-theme-primary capitalize">{deployment.strategy}</p>
                  </div>
                  <div>
                    <span className="text-theme-secondary">Created</span>
                    <p className="font-medium text-theme-primary">
                      {new Date(deployment.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {deployment.startedAt && (
                    <div>
                      <span className="text-theme-secondary">Started</span>
                      <p className="font-medium text-theme-primary">
                        {new Date(deployment.startedAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {deployment.completedAt && (
                    <div>
                      <span className="text-theme-secondary">Completed</span>
                      <p className="font-medium text-theme-primary">
                        {new Date(deployment.completedAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                {/* Rollback thresholds */}
                {deployment.rollbackThresholds && (
                  <>
                    <h4 className="font-medium text-theme-primary pt-4 border-t border-theme">
                      Rollback Thresholds
                    </h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-theme-secondary">Error Rate</span>
                        <p className="font-medium text-theme-primary">
                          {(deployment.rollbackThresholds.errorRate * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <span className="text-theme-secondary">P99 Latency</span>
                        <p className="font-medium text-theme-primary">
                          {deployment.rollbackThresholds.latencyP99}ms
                        </p>
                      </div>
                      <div>
                        <span className="text-theme-secondary">Failure Rate</span>
                        <p className="font-medium text-theme-primary">
                          {(deployment.rollbackThresholds.failureRate * 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </Card>
            </>
          )}

          {activeTab === 'robots' && <DeploymentProgress deployment={deployment} />}

          {activeTab === 'metrics' && (
            <Card className="p-6">
              <h3 className="font-semibold text-theme-primary mb-4">Performance Metrics</h3>
              {metricsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cobalt-500" />
                </div>
              ) : metrics ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold text-theme-primary">
                        {(metrics.errorRate * 100).toFixed(2)}%
                      </p>
                      <p className="text-sm text-theme-secondary">Error Rate</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold text-theme-primary">
                        {(metrics.taskSuccessRate * 100).toFixed(1)}%
                      </p>
                      <p className="text-sm text-theme-secondary">Task Success</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-theme-primary mb-2">Latency Distribution</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-theme-secondary">P50</span>
                        <span className="text-theme-primary">{metrics.latencyP50.toFixed(0)}ms</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-theme-secondary">P95</span>
                        <span className="text-theme-primary">{metrics.latencyP95.toFixed(0)}ms</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-theme-secondary">P99</span>
                        <span className="text-theme-primary">{metrics.latencyP99.toFixed(0)}ms</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-theme-tertiary text-center">
                    Sample size: {metrics.sampleSize} requests
                  </div>
                </div>
              ) : (
                <p className="text-theme-secondary text-center py-8">
                  No metrics available yet
                </p>
              )}
            </Card>
          )}

          {activeTab === 'events' && (
            <Card className="p-6">
              <h3 className="font-semibold text-theme-primary mb-4">Deployment Events</h3>
              <p className="text-theme-secondary text-center py-8">
                Event timeline will be displayed here
              </p>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick stats */}
          <Card className="p-4 space-y-4">
            <h4 className="font-medium text-theme-primary">Quick Stats</h4>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-theme-secondary">Deployed</span>
                <Badge variant="success">{deployment.deployedRobotIds.length}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-secondary">Failed</span>
                <Badge variant={deployment.failedRobotIds.length > 0 ? 'error' : 'default'}>
                  {deployment.failedRobotIds.length}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-secondary">Traffic</span>
                <span className="font-medium text-theme-primary">{deployment.trafficPercentage}%</span>
              </div>
            </div>
          </Card>

          {/* Canary stages */}
          {deployment.canaryConfig && (
            <Card className="p-4 space-y-4">
              <h4 className="font-medium text-theme-primary">Canary Stages</h4>
              <div className="space-y-2">
                {deployment.canaryConfig.stages.map((stage, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex justify-between items-center p-2 rounded',
                      index < currentStage
                        ? 'bg-green-50 dark:bg-green-900/20'
                        : index === currentStage
                          ? 'bg-cobalt-50 dark:bg-cobalt-900/20'
                          : 'bg-gray-50 dark:bg-gray-800/50'
                    )}
                  >
                    <span className="text-sm text-theme-primary">
                      Stage {index + 1}: {stage.percentage}%
                    </span>
                    {index < currentStage && (
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {index === currentStage && (
                      <div className="w-2 h-2 rounded-full bg-cobalt-500 animate-pulse" />
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Target filters */}
          {(deployment.targetRobotTypes?.length || deployment.targetZones?.length) && (
            <Card className="p-4 space-y-4">
              <h4 className="font-medium text-theme-primary">Target Filters</h4>
              {deployment.targetRobotTypes && deployment.targetRobotTypes.length > 0 && (
                <div>
                  <p className="text-xs text-theme-secondary mb-1">Robot Types</p>
                  <div className="flex flex-wrap gap-1">
                    {deployment.targetRobotTypes.map((type) => (
                      <Badge key={type} variant="default" size="sm">
                        {type}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {deployment.targetZones && deployment.targetZones.length > 0 && (
                <div>
                  <p className="text-xs text-theme-secondary mb-1">Zones</p>
                  <div className="flex flex-wrap gap-1">
                    {deployment.targetZones.map((zone) => (
                      <Badge key={zone} variant="default" size="sm">
                        {zone}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Rollback confirmation */}
      <RollbackConfirmation
        deployment={deployment}
        isOpen={showRollbackModal}
        onClose={() => setShowRollbackModal(false)}
        onConfirm={handleRollback}
      />
    </div>
  );
}
