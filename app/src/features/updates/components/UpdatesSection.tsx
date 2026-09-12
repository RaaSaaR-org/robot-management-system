/**
 * @file UpdatesSection.tsx
 * @description Secure OTA updates, embedded as the "Updates" tab of
 *   SettingsPage (which owns the page header): the signed package list with its
 *   search and status filter, and the create / approve / deploy-to-robot /
 *   roll-back modals. Updates stopped being a sidebar row in TASK-279 — they
 *   are a system setting, not a place you navigate to.
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, PackageSearch, Plus, Rocket, Search, Undo2 } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, SearchInput, Select, StatusTag, Toolbar,
  type DataTableColumn, type RowActionItem,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { useUpdatesStore, selectPackages, selectIsLoading } from '../store/updatesStore';
import { UPDATE_STATUS_LABELS, type UpdatePackage, type UpdatePackageStatus } from '../types/updates.types';
import { ApproveUpdateModal } from './ApproveUpdateModal';
import { DeployUpdateModal } from './DeployUpdateModal';
import { RollbackModal } from './RollbackModal';
import { NewPackageModal } from './NewPackageModal';
import { UpdateDetailsModal } from './UpdateDetailsModal';
import { firstLine, formatBytes } from './updateActs';

const STATUS_OPTIONS = (Object.keys(UPDATE_STATUS_LABELS) as UpdatePackageStatus[]).map((s) => ({
  value: s,
  label: UPDATE_STATUS_LABELS[s],
}));

export interface UpdatesSectionProps {
  /** Additional class names */
  className?: string;
  /**
   * Whether the "New package" modal is open. The parent owns the flag because
   * the button that opens it sits in SettingsPage's header, above this
   * component; the section only offers it a second time from its empty state.
   */
  newPackageOpen: boolean;
  onNewPackageOpenChange: (open: boolean) => void;
}

/** The package table with its four act modals. No PageHeader: SettingsPage renders it. */
export function UpdatesSection({ className, newPackageOpen, onNewPackageOpenChange }: UpdatesSectionProps) {
  const packages = useUpdatesStore(selectPackages);
  const isLoading = useUpdatesStore(selectIsLoading);
  const fetchPackages = useUpdatesStore((s) => s.fetchPackages);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [approving, setApproving] = useState<UpdatePackage | null>(null);
  const [deploying, setDeploying] = useState<UpdatePackage | null>(null);
  const [rollingBack, setRollingBack] = useState<UpdatePackage | null>(null);

  // The store keeps one error field for loads and acts; only a failed load
  // belongs in the table, acts report through their modals.
  const load = useCallback(async () => {
    await fetchPackages();
    const error = useUpdatesStore.getState().error;
    setLoadError(error);
    if (error) useUpdatesStore.setState({ error: null });
  }, [fetchPackages]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packages.filter(
      (p) => (!status || p.status === status)
        && (!q || `${p.version} ${p.changelog}`.toLowerCase().includes(q)),
    );
  }, [packages, query, status]);

  const hasFilters = Boolean(query || status);
  const details = packages.find((p) => p.id === detailsId) ?? null;

  const columns: DataTableColumn<UpdatePackage>[] = [
    {
      key: 'version', header: 'Version', sortable: true,
      sortValue: (p) => p.version.split('.').map((n) => n.padStart(6, '0')).join('.'),
      cell: (p) => (
        // 5.5rem keeps Version + a "Pending approval" tag + the row menu inside a 390px screen.
        <div className="min-w-0 max-w-[5.5rem] sm:max-w-md">
          <div className="font-medium text-ink-primary">v{p.version}</div>
          <div className="truncate text-[13px] text-ink-tertiary">{firstLine(p.changelog)}</div>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', sortable: true,
      cell: (p) => <StatusTag status={p.status} dot>{UPDATE_STATUS_LABELS[p.status]}</StatusTag>,
    },
    { key: 'fileSize', header: 'Size', align: 'right', sortable: true, hideBelow: 'sm', cell: (p) => formatBytes(p.fileSize) },
    { key: 'approvedBy', header: 'Approved by', hideBelow: 'md' },
    {
      key: 'createdAt', header: 'Created', align: 'right', sortable: true, hideBelow: 'md',
      sortValue: (p) => new Date(p.createdAt),
      cell: (p) => <span className="text-ink-secondary">{formatTimeAgo(p.createdAt)}</span>,
    },
  ];

  const rowActions = (p: UpdatePackage): RowActionItem[] => [
    { label: 'Open', icon: <Eye />, onSelect: () => setDetailsId(p.id) },
    ...(p.status === 'pending'
      ? [{ label: 'Approve', icon: <CheckCircle2 />, onSelect: () => setApproving(p) }] : []),
    ...(p.status === 'approved' || p.status === 'deployed'
      ? [{ label: 'Deploy to robot', icon: <Rocket />, onSelect: () => setDeploying(p) }] : []),
    ...(p.status === 'deployed'
      ? [{ label: 'Roll back', icon: <Undo2 />, tone: 'danger' as const, separatorBefore: true, onSelect: () => setRollingBack(p) }]
      : []),
  ];

  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search packages" />}
        filters={
          <Select aria-label="Status" fullWidth={false} className="w-44" placeholder="All statuses"
            options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
        }
      />

      <Panel padding="none">
        <DataTable
          caption="Update packages"
          columns={columns}
          rows={filtered}
          getRowId={(p) => p.id}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          onRowClick={(p) => setDetailsId(p.id)}
          rowActions={rowActions}
          rowActionsLabel={(p) => `Actions for v${p.version}`}
          isLoading={isLoading}
          error={loadError}
          errorTitle="Couldn't load update packages"
          onRetry={() => void load()}
          empty={hasFilters ? (
            <EmptyState icon={<Search />} title="No packages match" description="Try another version, or clear the filters."
              action={<Button variant="secondary" onClick={() => { setQuery(''); setStatus(''); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<PackageSearch />} title="No update packages yet"
              description="Packages appear here once they are created and signed. Approve one before it can reach a robot."
              action={
                <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => onNewPackageOpenChange(true)}>
                  New package
                </Button>
              } />
          )}
        />
      </Panel>

      <NewPackageModal isOpen={newPackageOpen} onClose={() => onNewPackageOpenChange(false)} />
      <UpdateDetailsModal pkg={details} onClose={() => setDetailsId(null)} />
      <ApproveUpdateModal pkg={approving} onClose={() => setApproving(null)} />
      <DeployUpdateModal pkg={deploying} onClose={() => setDeploying(null)} />
      <RollbackModal pkg={rollingBack} onClose={() => setRollingBack(null)} />
    </div>
  );
}
