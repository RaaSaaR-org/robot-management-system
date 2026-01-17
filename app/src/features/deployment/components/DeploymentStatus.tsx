/**
 * @file DeploymentStatus.tsx
 * @description Detailed deployment status display with stage progress
 * @feature deployment
 */

import { Card, Button, Badge, ProgressBar } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type { Deployment, AggregatedDeploymentMetrics } from '../types';
import { DeploymentStatusBadge } from './DeploymentStatusBadge';

export interface DeploymentStatusProps {
  deployment: Deployment;
  metrics?: AggregatedDeploymentMetrics;
  currentStage: number;
  totalStages: number;
  nextStageTime?: string;
  onPromote?: () => void;
  onRollback?: () => void;
  onCancel?: () => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * Formats time remaining until next stage
 */
function formatTimeRemaining(nextStageTime: string | undefined): string {
  if (!nextStageTime) return '--';

  const target = new Date(nextStageTime);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return 'Ready';

  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function DeploymentStatus({
  deployment,
  metrics,
  currentStage,
  totalStages,
  nextStageTime,
  onPromote,
  onRollback,
  onCancel,
  isLoading = false,
  className,
}: DeploymentStatusProps) {
  const canPromote = deployment.status === 'canary';
  const canRollback = ['deploying', 'canary', 'production'].includes(deployment.status);
  const canCancel = ['pending', 'deploying', 'canary'].includes(deployment.status);

  return (
    <Card className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-primary">
            {deployment.modelVersion?.skill?.name || 'Deployment'}
          </h3>
          <p className="text-sm text-theme-secondary">
            Model v{deployment.modelVersion?.version}
          </p>
        </div>
        <DeploymentStatusBadge status={deployment.status} size="lg" />
      </div>

      {/* Stage Progress */}
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-theme-secondary">Stage Progress</span>
          <span className="font-medium text-theme-primary">
            {currentStage} / {totalStages}
          </span>
        </div>

        {/* Stage indicators */}
        <div className="flex gap-1">
          {deployment.canaryConfig.stages.map((stage, index) => (
            <div
              key={index}
              className={cn(
                'flex-1 h-2 rounded-full transition-colors',
                index < currentStage
                  ? 'bg-green-500'
                  : index === currentStage
                    ? 'bg-cobalt-500 animate-pulse'
                    : 'bg-gray-200 dark:bg-gray-700'
              )}
              title={`${stage.percentage}%`}
            />
          ))}
        </div>

        {/* Time remaining */}
        {deployment.status === 'canary' && (
          <div className="flex justify-between text-sm">
            <span className="text-theme-secondary">Next stage in</span>
            <span className="font-medium text-theme-primary">
              {formatTimeRemaining(nextStageTime)}
            </span>
          </div>
        )}
      </div>

      {/* Traffic */}
      <ProgressBar
        value={deployment.trafficPercentage}
        label="Traffic"
        variant={deployment.status === 'canary' ? 'warning' : 'default'}
      />

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-theme-primary">
              {(metrics.errorRate * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-theme-secondary">Error Rate</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-theme-primary">
              {metrics.latencyP99.toFixed(0)}ms
            </p>
            <p className="text-xs text-theme-secondary">P99 Latency</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-theme-primary">
              {(metrics.taskSuccessRate * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-theme-secondary">Task Success</p>
          </div>
        </div>
      )}

      {/* Robot counts */}
      <div className="flex gap-4">
        <Badge variant="success" size="lg">
          {deployment.deployedRobotIds.length} Deployed
        </Badge>
        {deployment.failedRobotIds.length > 0 && (
          <Badge variant="error" size="lg">
            {deployment.failedRobotIds.length} Failed
          </Badge>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-theme">
        {canPromote && (
          <Button
            variant="primary"
            onClick={onPromote}
            isLoading={isLoading}
            className="flex-1"
          >
            Promote to Production
          </Button>
        )}
        {canRollback && (
          <Button
            variant="destructive"
            onClick={onRollback}
            disabled={isLoading}
          >
            Rollback
          </Button>
        )}
        {canCancel && (
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}
