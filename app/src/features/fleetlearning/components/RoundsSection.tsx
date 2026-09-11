/**
 * @file RoundsSection.tsx
 * @description Rounds tab of fleet learning: search, status filter, the
 *              rounds table with start / cancel acts and server pagination
 * @feature fleetlearning
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, Network, Play, Search } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, SearchInput, Select, StatusTag, Toolbar, confirm, toast,
  type DataTableColumn, type RowActionItem,
} from '@/shared/components/ui';
import { formatTimeAgo, getErrorMessage } from '@/shared/utils';
import { useFederatedRounds } from '../hooks/fleetlearning';
import { useFleetLearningStore } from '../store/fleetlearningStore';
import {
  AGGREGATION_METHOD_LABELS, canStartRound, isRoundActive,
  type FederatedRound, type FederatedRoundStatus,
} from '../types/fleetlearning.types';

const STATUSES: FederatedRoundStatus[] = [
  'created', 'selecting', 'distributing', 'training', 'collecting', 'aggregating', 'completed', 'failed', 'cancelled',
];
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));

/** Short, readable round id: a hash sign and the first six characters of the id. */
export const shortRoundId = (id: string) => `#${id.slice(0, 6)}`;

export interface RoundsSectionProps {
  /** Primary action for the empty state ("New round"). */
  newAction: ReactNode;
}

export function RoundsSection({ newAction }: RoundsSectionProps) {
  const navigate = useNavigate();
  const { rounds, pagination, filters, isLoading, error, fetchRounds, setFilters, clearFilters, setPage } = useFederatedRounds();
  const startRound = useFleetLearningStore((s) => s.startRound);
  const [query, setQuery] = useState('');
  const status = filters.status ?? '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rounds.filter((r) => `${r.id} ${r.globalModelVersion}`.toLowerCase().includes(q)) : rounds;
  }, [rounds, query]);

  const start = async (r: FederatedRound) => {
    const ok = await confirm({
      title: `Start round ${shortRoundId(r.id)}?`,
      description: `Up to ${r.config.maxParticipants} robots are selected and train ${r.globalModelVersion} for ${r.config.localEpochs} local epoch(s).`,
      confirmLabel: 'Start round',
    });
    if (!ok) return;
    try {
      await startRound(r.id);
      toast.success('Round started', { description: shortRoundId(r.id) });
    } catch (err) {
      toast.error("Couldn't start the round", { description: getErrorMessage(err) });
    }
    void fetchRounds();
  };

  const columns: DataTableColumn<FederatedRound>[] = [
    {
      key: 'id', header: 'Round',
      cell: (r) => (
        <div className="min-w-0 max-w-[14rem] sm:max-w-sm">
          <div className="truncate font-medium text-ink-primary">{r.globalModelVersion}</div>
          <div className="text-[13px] text-ink-tertiary">Round {shortRoundId(r.id)}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag status={r.status} dot pulse={isRoundActive(r)} /> },
    {
      key: 'participants', header: 'Participants', align: 'right', hideBelow: 'sm', sortable: true,
      sortValue: (r) => r.participantCount, cell: (r) => `${r.participantCount} / ${r.config.maxParticipants}`,
    },
    { key: 'aggregation', header: 'Aggregation', hideBelow: 'md', cell: (r) => AGGREGATION_METHOD_LABELS[r.config.aggregationMethod] },
    {
      key: 'createdAt', header: 'Created', align: 'right', hideBelow: 'sm', sortable: true,
      sortValue: (r) => new Date(r.createdAt), cell: (r) => <span className="text-ink-secondary">{formatTimeAgo(r.createdAt)}</span>,
    },
  ];

  // No Cancel: the server has no route to cancel a round, so the menu offers only what it accepts.
  const rowActions = (r: FederatedRound): RowActionItem[] => [
    { label: 'Open', icon: <Eye />, onSelect: () => navigate(`/fleet-learning/rounds/${r.id}`) },
    ...(canStartRound(r) ? [{ label: 'Start round', icon: <Play />, onSelect: () => void start(r) }] : []),
  ];

  const hasFilters = Boolean(query || status);
  const resetFilters = () => { setQuery(''); clearFilters(); };
  const from = pagination.offset + 1;
  const to = Math.min(pagination.offset + pagination.limit, pagination.total);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search rounds" />}
        filters={
          <Select aria-label="Status" fullWidth={false} className="w-44" placeholder="All statuses" options={STATUS_OPTIONS}
            value={status} onChange={(e) => (e.target.value ? setFilters({ status: e.target.value as FederatedRoundStatus }) : clearFilters())} />
        }
      />
      <Panel padding="none">
        <DataTable
          caption="Federated rounds"
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          onRowClick={(r) => navigate(`/fleet-learning/rounds/${r.id}`)}
          rowActions={rowActions}
          rowActionsLabel={(r) => `Actions for round ${shortRoundId(r.id)}`}
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load rounds"
          onRetry={() => void fetchRounds()}
          empty={hasFilters ? (
            <EmptyState icon={<Search />} title="No rounds match" description="Try another id or model, or clear the filters."
              action={<Button variant="secondary" onClick={resetFilters}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<Network />} title="No rounds yet"
              description="A round trains the global model on selected robots and merges the updates." action={newAction} />
          )}
        />
        {pagination.total > pagination.limit && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2 text-[13px] text-ink-tertiary">
            <span>Showing {from}–{to} of {pagination.total}</span>
            <Button variant="ghost" size="sm" iconOnly aria-label="Previous page" disabled={pagination.offset === 0}
              onClick={() => setPage(Math.max(0, pagination.offset - pagination.limit))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" iconOnly aria-label="Next page" disabled={to >= pagination.total}
              onClick={() => setPage(pagination.offset + pagination.limit)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
