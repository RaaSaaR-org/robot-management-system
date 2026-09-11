/**
 * @file DeploymentProgress.tsx
 * @description Robots tab of a deployment: which robots run the new model and which failed
 * @feature deployment
 */

import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { DataTable, EmptyState, Panel, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import type { Deployment } from '../types';

export interface DeploymentProgressProps {
  deployment: Deployment;
  /** Robot display names by id; unknown ids show the id itself. */
  robotNames?: Record<string, string>;
  onRobotClick?: (robotId: string) => void;
  className?: string;
}

interface RobotRow {
  id: string;
  status: 'failed' | 'deployed';
}

export function DeploymentProgress({ deployment, robotNames = {}, onRobotClick, className }: DeploymentProgressProps) {
  const rows = useMemo<RobotRow[]>(() => {
    const failed = new Set(deployment.failedRobotIds);
    const ids = Array.from(new Set([...deployment.failedRobotIds, ...deployment.deployedRobotIds]));
    return ids.map((id) => ({ id, status: failed.has(id) ? 'failed' : 'deployed' }));
  }, [deployment.deployedRobotIds, deployment.failedRobotIds]);

  const columns: DataTableColumn<RobotRow>[] = [
    {
      key: 'robot',
      header: 'Robot',
      sortable: true,
      sortValue: (r) => (robotNames[r.id] ?? r.id).toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-primary">{robotNames[r.id] ?? r.id}</div>
          {robotNames[r.id] && <div className="truncate text-[13px] text-ink-tertiary">#{r.id.slice(0, 8)}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.status,
      cell: (r) => <StatusTag status={r.status} tone={r.status === 'failed' ? 'danger' : 'success'} dot />,
    },
  ];

  return (
    <Panel padding="none" className={className}>
      <DataTable
        caption="Robots in this deployment"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        defaultSort={{ key: 'status', direction: 'desc' }}
        onRowClick={onRobotClick ? (r) => onRobotClick(r.id) : undefined}
        empty={
          <EmptyState icon={<Bot />} title="No robots updated yet" description="Robots join when the rollout starts." />
        }
      />
    </Panel>
  );
}
