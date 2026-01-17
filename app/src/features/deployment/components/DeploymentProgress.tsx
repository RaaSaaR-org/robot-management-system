/**
 * @file DeploymentProgress.tsx
 * @description Per-robot deployment status grid
 * @feature deployment
 */

import { Card, Badge } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type { Deployment } from '../types';

export interface DeploymentProgressProps {
  deployment: Deployment;
  onRobotClick?: (robotId: string) => void;
  className?: string;
}

type RobotDeployStatus = 'deployed' | 'pending' | 'failed';

interface RobotStatusInfo {
  id: string;
  status: RobotDeployStatus;
}

const statusColors: Record<RobotDeployStatus, string> = {
  deployed: 'bg-green-500',
  pending: 'bg-gray-300 dark:bg-gray-600',
  failed: 'bg-red-500',
};

const statusLabels: Record<RobotDeployStatus, string> = {
  deployed: 'Deployed',
  pending: 'Pending',
  failed: 'Failed',
};

export function DeploymentProgress({
  deployment,
  onRobotClick,
  className,
}: DeploymentProgressProps) {
  // Combine robot IDs and determine status
  const allRobotIds = new Set([
    ...deployment.deployedRobotIds,
    ...deployment.failedRobotIds,
  ]);

  const robots: RobotStatusInfo[] = Array.from(allRobotIds).map((id) => ({
    id,
    status: deployment.failedRobotIds.includes(id)
      ? 'failed'
      : deployment.deployedRobotIds.includes(id)
        ? 'deployed'
        : 'pending',
  }));

  // Sort: failed first, then deployed, then pending
  robots.sort((a, b) => {
    const order = { failed: 0, pending: 1, deployed: 2 };
    return order[a.status] - order[b.status];
  });

  const deployedCount = deployment.deployedRobotIds.length;
  const failedCount = deployment.failedRobotIds.length;
  const totalCount = robots.length;

  return (
    <Card className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-theme-primary">Robot Deployment Status</h4>
        <div className="flex gap-2">
          <Badge variant="success" size="sm">
            {deployedCount} deployed
          </Badge>
          {failedCount > 0 && (
            <Badge variant="error" size="sm">
              {failedCount} failed
            </Badge>
          )}
        </div>
      </div>

      {/* Status legend */}
      <div className="flex gap-4 text-xs text-theme-secondary">
        <div className="flex items-center gap-1">
          <span className={cn('w-2 h-2 rounded-full', statusColors.deployed)} />
          <span>Deployed</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('w-2 h-2 rounded-full', statusColors.pending)} />
          <span>Pending</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('w-2 h-2 rounded-full', statusColors.failed)} />
          <span>Failed</span>
        </div>
      </div>

      {/* Robot grid */}
      {robots.length > 0 ? (
        <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 md:grid-cols-12">
          {robots.map((robot) => (
            <button
              key={robot.id}
              onClick={() => onRobotClick?.(robot.id)}
              className={cn(
                'w-6 h-6 rounded-sm transition-all',
                statusColors[robot.status],
                onRobotClick && 'hover:ring-2 hover:ring-cobalt-500 cursor-pointer',
                !onRobotClick && 'cursor-default'
              )}
              title={`${robot.id}: ${statusLabels[robot.status]}`}
              aria-label={`Robot ${robot.id}: ${statusLabels[robot.status]}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-theme-secondary text-center py-4">
          No robots in this deployment yet
        </p>
      )}

      {/* Summary */}
      {totalCount > 0 && (
        <p className="text-sm text-theme-secondary">
          {deployedCount} of {totalCount} robots ({((deployedCount / totalCount) * 100).toFixed(0)}%)
        </p>
      )}
    </Card>
  );
}
