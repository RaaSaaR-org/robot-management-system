/**
 * @file DeploymentsSection.tsx
 * @description The Deployments tab: Toolbar (search, Active/History/All) and the deployments DataTable
 * @feature deployment
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpCircle, ExternalLink, Plus, Rocket, Search, Undo2, XCircle } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  StatusTag,
  Toolbar,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import type { Deployment } from '../types';
import {
  canCancel,
  canPromote,
  canRollBack,
  deploymentName,
  deployToneFor,
  inScope,
  isMoving,
  strategyLabel,
  type DeploymentScope,
} from './deploymentHelpers';
import type { DeploymentActs } from './useDeploymentActs';

export interface DeploymentsSectionProps {
  deployments: Deployment[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
  acts: DeploymentActs;
}

const SCOPES: { value: DeploymentScope; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'history', label: 'History' },
  { value: 'all', label: 'All' },
];

const icon = 'h-4 w-4';

export function DeploymentsSection({ deployments, isLoading, error, onRetry, onCreate, acts }: DeploymentsSectionProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<DeploymentScope>('active');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deployments.filter((d) => {
      if (!inScope(d, scope)) return false;
      if (!q) return true;
      const hay = `${deploymentName(d)} ${d.modelVersion?.version ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [deployments, query, scope]);

  const columns: DataTableColumn<Deployment>[] = [
    {
      key: 'model',
      header: 'Model',
      sortable: true,
      sortValue: (d) => deploymentName(d).toLowerCase(),
      cell: (d) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-primary">{deploymentName(d)}</div>
          <div className="truncate text-[13px] text-ink-tertiary">
            {d.modelVersion ? `v${d.modelVersion.version}` : `#${d.id.slice(0, 6)}`}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (d) => d.status,
      cell: (d) => <StatusTag status={d.status} tone={deployToneFor(d.status)} dot pulse={isMoving(d.status)} />,
    },
    { key: 'strategy', header: 'Strategy', hideBelow: 'sm', cell: (d) => strategyLabel(d.strategy) },
    {
      key: 'traffic',
      header: 'Traffic',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      sortValue: (d) => d.trafficPercentage,
      cell: (d) => (
        <div className="ml-auto flex w-32 items-center gap-2">
          <ProgressBar value={d.trafficPercentage} size="sm" showValue={false} className="flex-1" />
          <span className="w-10 text-right tabular-nums">{d.trafficPercentage}%</span>
        </div>
      ),
    },
    {
      key: 'robots',
      header: 'Robots',
      align: 'right',
      hideBelow: 'md',
      cell: (d) => (
        <span className="tabular-nums">
          {d.deployedRobotIds.length}
          {d.failedRobotIds.length > 0 && (
            <span className="text-signal-stopped"> · {d.failedRobotIds.length} failed</span>
          )}
        </span>
      ),
    },
    {
      key: 'started',
      header: 'Started',
      align: 'right',
      sortable: true,
      hideBelow: 'md',
      sortValue: (d) => new Date(d.startedAt ?? d.createdAt),
      cell: (d) => (d.startedAt ? formatTimeAgo(d.startedAt) : <span className="text-ink-tertiary">Not started</span>),
    },
  ];

  const rowActions = (d: Deployment): RowActionItem[] => {
    const items: RowActionItem[] = [
      { label: 'Open', icon: <ExternalLink className={icon} />, onSelect: () => navigate(`/deployments/${d.id}`) },
    ];
    if (canPromote(d)) items.push({ label: 'Promote', icon: <ArrowUpCircle className={icon} />, onSelect: () => void acts.promote(d) });
    if (canRollBack(d)) items.push({ label: 'Roll back', icon: <Undo2 className={icon} />, onSelect: () => acts.openRollback(d) });
    if (canCancel(d))
      items.push({
        label: 'Cancel deployment',
        icon: <XCircle className={icon} />,
        tone: 'danger',
        separatorBefore: true,
        onSelect: () => void acts.cancel(d),
      });
    return items;
  };

  const hasQuery = query.trim().length > 0;
  const empty = hasQuery ? (
    <EmptyState
      icon={<Search />}
      title="No deployments match"
      description="Try another model name, or clear the search."
      action={<Button variant="secondary" onClick={() => setQuery('')}>Clear filters</Button>}
    />
  ) : scope === 'history' ? (
    <EmptyState icon={<Rocket />} title="No finished deployments yet" description="Promoted, failed and rolled-back rollouts land here." />
  ) : (
    <EmptyState
      icon={<Rocket />}
      title={scope === 'active' ? 'No active deployments' : 'No deployments yet'}
      description="A deployment rolls a staged model out to robots, canary first."
      action={<Button leftIcon={<Plus className={icon} />} onClick={onCreate}>New deployment</Button>}
    />
  );

  return (
    <>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search deployments" />}
        actions={<SegmentedControl label="Show" options={SCOPES} value={scope} onChange={setScope} />}
      />
      <Panel padding="none">
        <DataTable
          caption="Deployments"
          columns={columns}
          rows={filtered}
          getRowId={(d) => d.id}
          defaultSort={{ key: 'started', direction: 'desc' }}
          onRowClick={(d) => navigate(`/deployments/${d.id}`)}
          rowActions={rowActions}
          rowActionsLabel={(d) => `Actions for ${deploymentName(d)}`}
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load deployments"
          onRetry={onRetry}
          empty={empty}
        />
      </Panel>
    </>
  );
}
