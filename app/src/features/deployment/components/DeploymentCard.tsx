/**
 * @file DeploymentCard.tsx
 * @description Card component for displaying deployment summary
 * @feature deployment
 */

import { Card } from '@/shared/components/ui';
import { ProgressBar } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type { Deployment } from '../types';
import { DeploymentStatusBadge } from './DeploymentStatusBadge';

export interface DeploymentCardProps {
  deployment: Deployment;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

/**
 * Calculates the progress percentage for a deployment based on traffic percentage
 */
function getDeploymentProgress(deployment: Deployment): number {
  return deployment.trafficPercentage;
}

/**
 * Formats relative time from a date string
 */
function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) return 'Not started';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function DeploymentCard({
  deployment,
  onClick,
  selected,
  className,
}: DeploymentCardProps) {
  const isActive = ['pending', 'deploying', 'canary'].includes(deployment.status);
  const progress = getDeploymentProgress(deployment);

  return (
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className={cn(
        'transition-all cursor-pointer',
        selected && 'ring-2 ring-cobalt-500',
        className
      )}
    >
      <div className="space-y-4">
        {/* Header with status */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-theme-primary truncate">
              {deployment.modelVersion?.skill?.name || 'Deployment'}
            </h3>
            <p className="text-sm text-theme-secondary">
              v{deployment.modelVersion?.version || 'Unknown'}
            </p>
          </div>
          <DeploymentStatusBadge status={deployment.status} />
        </div>

        {/* Progress bar for active deployments */}
        {isActive && (
          <ProgressBar
            value={progress}
            label="Traffic"
            variant={deployment.status === 'canary' ? 'warning' : 'default'}
          />
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-theme-secondary">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{deployment.deployedRobotIds.length} deployed</span>
          </div>
          {deployment.failedRobotIds.length > 0 && (
            <div className="flex items-center gap-1 text-red-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{deployment.failedRobotIds.length} failed</span>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="text-xs text-theme-tertiary">
          {formatRelativeTime(deployment.startedAt || deployment.createdAt)}
        </div>
      </div>
    </Card>
  );
}
