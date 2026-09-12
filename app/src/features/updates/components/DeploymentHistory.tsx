/**
 * @file DeploymentHistory.tsx
 * @description Table of the update deployments of one robot
 * @feature updates
 */

import { History } from 'lucide-react';
import { DataTable, EmptyState, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import type { UpdateDeployment } from '../types/updates.types';

export interface DeploymentHistoryProps {
  deployments: UpdateDeployment[];
  isLoading?: boolean;
  /** Maps a robot id to its name. */
  robotName?: (robotId: string) => string;
  className?: string;
}

export function DeploymentHistory({ deployments, isLoading, robotName, className }: DeploymentHistoryProps) {
  const columns: DataTableColumn<UpdateDeployment>[] = [
    { key: 'status', header: 'Status', cell: (d) => <StatusTag status={d.status} dot /> },
    { key: 'robotId', header: 'Robot', cell: (d) => robotName?.(d.robotId) ?? d.robotId },
    { key: 'previousVersion', header: 'Previous', hideBelow: 'sm', cell: (d) => (d.previousVersion ? `v${d.previousVersion}` : null) },
    {
      key: 'deployedAt', header: 'Deployed', align: 'right', hideBelow: 'sm', sortable: true,
      sortValue: (d) => (d.deployedAt ? new Date(d.deployedAt) : null),
      cell: (d) => (d.deployedAt ? formatDateTime(d.deployedAt) : null),
    },
    {
      key: 'errorMessage', header: 'Error', hideBelow: 'md',
      cell: (d) => (d.errorMessage ? <span className="text-signal-stopped">{d.errorMessage}</span> : null),
    },
  ];

  return (
    <div className={className}>
      <DataTable
        caption="Deployment history"
        columns={columns}
        rows={deployments}
        getRowId={(d) => d.id}
        isLoading={isLoading}
        dense
        empty={<EmptyState size="sm" icon={<History />} title="No deployments yet"
          description="This robot has not received an update." />}
      />
    </div>
  );
}
