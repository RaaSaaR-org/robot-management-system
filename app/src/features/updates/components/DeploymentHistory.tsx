/**
 * @file DeploymentHistory.tsx
 * @description Deployment history table component for a robot
 * @feature updates
 */

import { cn } from '@/shared/utils/cn';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import type { UpdateDeployment } from '../types/updates.types';
import { DEPLOYMENT_STATUS_LABELS, DEPLOYMENT_STATUS_COLORS } from '../types/updates.types';

export interface DeploymentHistoryProps {
  deployments: UpdateDeployment[];
  className?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DeploymentHistory({ deployments, className }: DeploymentHistoryProps) {
  if (deployments.length === 0) {
    return <EmptyState size="sm" className={className} title="No deployments found." />;
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-theme-tertiary border-b border-theme">
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Robot ID</th>
            <th className="pb-2 pr-4">Previous Version</th>
            <th className="pb-2 pr-4">Deployed At</th>
            <th className="pb-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d) => (
            <tr key={d.id} className="border-b border-theme/50">
              <td className={cn('py-2 pr-4 font-medium', DEPLOYMENT_STATUS_COLORS[d.status])}>
                {DEPLOYMENT_STATUS_LABELS[d.status]}
              </td>
              <td className="py-2 pr-4 text-theme-secondary font-mono text-xs">{d.robotId.slice(0, 12)}...</td>
              <td className="py-2 pr-4 text-theme-secondary">{d.previousVersion ?? '-'}</td>
              <td className="py-2 pr-4 text-theme-tertiary">{formatDate(d.deployedAt)}</td>
              <td className="py-2 text-red-400 text-xs">{d.errorMessage ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
