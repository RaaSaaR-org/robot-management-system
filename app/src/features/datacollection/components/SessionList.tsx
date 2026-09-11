/**
 * @file SessionList.tsx
 * @description Sessions tab of /data-collection: Toolbar (search, status,
 *              type) over a DataTable of teleoperation sessions, with all
 *              four list states and server-side pagination.
 * @feature datacollection
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Database, ExternalLink, Plus, Search, Video } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, SearchInput, Select, Toolbar,
  type DataTableColumn, type RowActionItem,
} from '@/shared/components/ui';
import { SessionStatusBadge } from './SessionStatusBadge';
import { TYPE_ICONS } from './SessionTypeSelector';
import type {
  TeleoperationSession, SessionFilters, SessionPagination, TeleoperationStatus, TeleoperationType,
} from '../types/datacollection.types';
import { TELEOPERATION_TYPE_LABELS, SESSION_STATUS_LABELS, formatDuration } from '../types/datacollection.types';
import { formatRelative, sessionName } from '../utils/sessionFormat';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface SessionListProps {
  sessions: TeleoperationSession[];
  filters: SessionFilters;
  pagination: SessionPagination;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onFilterChange: (filters: Partial<SessionFilters>) => void;
  onClearFilters: () => void;
  onPageChange: (page: number) => void;
  onSessionClick: (session: TeleoperationSession) => void;
  onNewSession?: () => void;
  /** Package a completed session into a dataset (opens the session). */
  onExport?: (session: TeleoperationSession) => void;
}

const STATUS_OPTIONS = (Object.keys(SESSION_STATUS_LABELS) as TeleoperationStatus[]).map((s) => ({
  value: s, label: SESSION_STATUS_LABELS[s],
}));
const TYPE_OPTIONS = (Object.keys(TELEOPERATION_TYPE_LABELS) as TeleoperationType[]).map((t) => ({
  value: t, label: TELEOPERATION_TYPE_LABELS[t],
}));

export function SessionList({
  sessions, filters, pagination, isLoading, error, onRetry, onFilterChange, onClearFilters,
  onPageChange, onSessionClick, onNewSession, onExport,
}: SessionListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [s.languageInstr, s.robot?.name, s.robotId, TELEOPERATION_TYPE_LABELS[s.type], s.id]
        .some((v) => v?.toLowerCase().includes(q)));
  }, [sessions, query]);

  const hasFilters = Boolean(query || filters.status || filters.type);
  const clearAll = () => { setQuery(''); onClearFilters(); };

  const columns: DataTableColumn<TeleoperationSession>[] = [
    {
      key: 'name', header: 'Session', sortable: true, sortValue: (s) => sessionName(s).toLowerCase(),
      cell: (s) => (
        <div className="min-w-0 max-w-md">
          <div className="truncate text-sm font-medium text-ink-primary">{sessionName(s)}</div>
          <div className="truncate text-xs text-ink-tertiary">
            {s.robot?.name ?? s.robotId}
            {' · '}
            <span className="font-mono" title={s.id}>{s.id.slice(0, 8)}</span>
          </div>
          {/* Phones hide the Status column; the status rides under the name. */}
          <div className="mt-1.5 sm:hidden"><SessionStatusBadge status={s.status} size="sm" /></div>
        </div>
      ),
    },
    {
      key: 'type', header: 'Input', hideBelow: 'sm', sortable: true, sortValue: (s) => TELEOPERATION_TYPE_LABELS[s.type],
      cell: (s) => {
        const Icon = TYPE_ICONS[s.type];
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-secondary">
            {Icon && <Icon className="h-4 w-4 text-ink-tertiary" strokeWidth={1.75} />}
            {TELEOPERATION_TYPE_LABELS[s.type]}
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', sortable: true, hideBelow: 'sm', cell: (s) => <SessionStatusBadge status={s.status} size="sm" /> },
    {
      key: 'frames', header: 'Frames', align: 'right', hideBelow: 'md', sortable: true, sortValue: (s) => s.frameCount,
      cell: (s) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-secondary">
          {s.frameCount.toLocaleString(UI_DATE_LOCALE)}
          <span className="text-ink-tertiary"> · {formatDuration(s.duration)}</span>
        </span>
      ),
    },
    {
      key: 'createdAt', header: 'Created', align: 'right', hideBelow: 'md', sortable: true,
      sortValue: (s) => new Date(s.createdAt),
      cell: (s) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatRelative(s.createdAt)}</span>,
    },
  ];

  const rowActions = (s: TeleoperationSession): RowActionItem[] => {
    const items: RowActionItem[] = [
      { label: 'Open', icon: <ExternalLink />, onSelect: () => onSessionClick(s) },
    ];
    if (s.status === 'completed' && !s.exportedDatasetId && onExport) {
      items.push({ label: 'Create dataset', icon: <Database />, onSelect: () => onExport(s) });
    }
    return items;
  };

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search task or robot" />}
        filters={
          <>
            <Select
              aria-label="Status" fullWidth={false} className="w-40" placeholder="All statuses"
              options={STATUS_OPTIONS} value={(filters.status as string) ?? ''}
              onChange={(e) => onFilterChange({ status: (e.target.value || undefined) as TeleoperationStatus | undefined })}
            />
            <Select
              aria-label="Input" fullWidth={false} className="w-44" placeholder="All inputs"
              options={TYPE_OPTIONS} value={(filters.type as string) ?? ''}
              onChange={(e) => onFilterChange({ type: (e.target.value || undefined) as TeleoperationType | undefined })}
            />
          </>
        }
      />

      <Panel padding="none">
        <DataTable
          caption="Recording sessions"
          columns={columns}
          rows={filtered}
          getRowId={(s) => s.id}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          onRowClick={onSessionClick}
          rowActions={rowActions}
          rowActionsLabel={(s) => `Actions for ${sessionName(s)}`}
          isLoading={isLoading}
          error={error ?? null}
          errorTitle="Couldn't load sessions"
          onRetry={onRetry}
          empty={
            hasFilters ? (
              <EmptyState
                icon={<Search />} title="No sessions match" description="Try another search, or clear the filters."
                action={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<Video />} title="No sessions yet"
                description="A session records camera frames, joint states and actions while you teleoperate a robot."
                action={onNewSession && (
                  <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={onNewSession}>New session</Button>
                )}
              />
            )
          }
        />
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-3">
            <p className="text-[13px] text-ink-tertiary">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} sessions
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" iconOnly aria-label="Previous page"
                disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              </Button>
              <Button variant="secondary" size="sm" iconOnly aria-label="Next page"
                disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
