/**
 * @file ObligationTable.tsx
 * @description One obligations view: Toolbar (search + status filter + extra
 *              filters), then a Panel holding a DataTable with the four
 *              states (loading, error, empty, filtered-empty).
 * @feature compliance
 */

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, SearchInput, Select, Toolbar,
  type DataTableColumn, type RowActionItem,
} from '@/shared/components/ui';

export interface ObligationTableProps<T> {
  /** Plural noun for copy: "risk assessments" */
  noun: string;
  /** Panel title and summary line */
  title: string;
  description?: ReactNode;
  headerActions?: ReactNode;
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  searchText: (row: T) => string;
  statusOf?: (row: T) => string;
  statusOptions?: { value: string; label: string }[];
  /** Extra filters that live outside this component (e.g. server filters) */
  extraFilters?: ReactNode;
  hasExtraFilters?: boolean;
  onClearExtraFilters?: () => void;
  toolbarActions?: ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => RowActionItem[];
  rowActionsLabel?: (row: T) => string;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyIcon: ReactElement;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
}

export function ObligationTable<T>(props: ObligationTableProps<T>) {
  const {
    noun, title, description, headerActions, rows, columns, getRowId, searchText, statusOf, statusOptions,
    extraFilters, hasExtraFilters, onClearExtraFilters, toolbarActions, onRowClick, rowActions, rowActionsLabel,
    isLoading, error, onRetry, emptyIcon, emptyTitle, emptyDescription, emptyAction, defaultSort,
  } = props;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (!status || !statusOf || statusOf(r) === status) && (!q || searchText(r).toLowerCase().includes(q)),
    );
  }, [rows, query, status, statusOf, searchText]);

  const filteredOut = Boolean(query || status || hasExtraFilters);
  const clear = () => {
    setQuery('');
    setStatus('');
    onClearExtraFilters?.();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder={`Search ${noun}`} aria-label={`Search ${noun}`} />}
        filters={
          <>
            {statusOptions && (
              <Select
                aria-label="Status"
                fullWidth={false}
                className="w-44"
                placeholder="All statuses"
                options={statusOptions}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            )}
            {extraFilters}
          </>
        }
        actions={toolbarActions}
      />
      <Panel padding="none">
        <Panel.Header title={title} description={description} actions={headerActions} />
        <DataTable
          caption={title}
          columns={columns}
          rows={filtered}
          getRowId={getRowId}
          defaultSort={defaultSort}
          onRowClick={onRowClick}
          rowActions={rowActions}
          rowActionsLabel={rowActionsLabel}
          isLoading={isLoading}
          error={rows.length === 0 ? error : null}
          errorTitle={`Couldn't load ${noun}`}
          onRetry={onRetry}
          empty={
            filteredOut && rows.length > 0 ? (
              <EmptyState
                icon={<Search />}
                title={`No ${noun} match`}
                description="Try another search, or clear the filters."
                action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
              />
            ) : filteredOut ? (
              <EmptyState
                icon={emptyIcon}
                title={`No ${noun} match`}
                description="Nothing matches these filters."
                action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
              />
            ) : (
              <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyAction} />
            )
          }
        />
      </Panel>
    </div>
  );
}
