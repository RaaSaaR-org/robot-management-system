/**
 * @file DataTable.tsx
 * @description The list of records, identical on every page: column defs with
 *              cell renderers, alignment, width, client-side sort (aria-sort),
 *              clickable rows (Enter works), a RowActions kebab per row, and
 *              built-in loading / error / empty states. Lives inside
 *              <Panel padding="none">; scrolls sideways inside it on narrow
 *              screens so the page never does.
 * @feature shared
 */

import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { RowActions, type RowActionItem } from './DropdownMenu';
import { Skeleton } from './Skeleton';
import { focusRing, focusRingInset } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | Date | boolean | null | undefined;

export interface DataTableSort {
  key: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  /** Unique column key; also the default field read when `cell` is omitted */
  key: string;
  header: ReactNode;
  /** Cell renderer (default: row[key] when it is a string or number) */
  cell?: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** CSS width ("30%", 120) */
  width?: string | number;
  sortable?: boolean;
  /** Value to sort by (default: row[key]) */
  sortValue?: (row: T) => SortValue;
  /** Hide the column below this breakpoint */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Extra classes for this column's cells */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Makes rows clickable and focusable (Enter activates) */
  onRowClick?: (row: T) => void;
  /** Adds a trailing kebab menu per row */
  rowActions?: (row: T) => RowActionItem[];
  /** Accessible name for a row's kebab (default "Actions") */
  rowActionsLabel?: (row: T) => string;
  /** Shows skeleton rows while there are no rows yet (rows already loaded stay visible) */
  isLoading?: boolean;
  /** Replaces the table with an ErrorState */
  error?: string | null;
  errorTitle?: string;
  onRetry?: () => void;
  /** Shown when there are no rows (default: a small "Nothing here yet") */
  empty?: ReactNode;
  /** Tighter rows */
  dense?: boolean;
  /** Accessible caption (visually hidden) */
  caption?: string;
  /** Initial sort (uncontrolled) */
  defaultSort?: DataTableSort;
  /** Controlled sort */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  /** Number of skeleton rows (default 5) */
  skeletonRows?: number;
  /** Extra classes per row */
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const HIDE_BELOW: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const JUSTIFY: Record<'left' | 'right' | 'center', string> = {
  left: 'justify-start',
  right: 'justify-end',
  center: 'justify-center',
};

function readField<T>(row: T, key: string): unknown {
  return row !== null && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined;
}

function toComparable(value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

function compare(a: unknown, b: unknown): number {
  const x = toComparable(a);
  const y = toComparable(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1; // empties last in both directions
  if (y === null) return -1;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="menuitem"], [role="switch"], [data-row-click-ignore]';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <Panel padding="none">
 *   <DataTable
 *     caption="Patrol routes"
 *     rows={filtered}
 *     getRowId={(r) => r.id}
 *     columns={[
 *       { key: 'name', header: 'Name', sortable: true },
 *       { key: 'status', header: 'Status', cell: (r) => <StatusTag status={r.status} /> },
 *       { key: 'stops', header: 'Stops', align: 'right', sortable: true, hideBelow: 'sm' },
 *     ]}
 *     onRowClick={(r) => navigate(`/patrol/routes/${r.id}`)}
 *     rowActions={(r) => [{ label: 'Edit', onSelect: () => edit(r) }, { label: 'Delete', tone: 'danger', separatorBefore: true, onSelect: () => askDelete(r) }]}
 *     isLoading={loading}
 *     error={error}
 *     onRetry={refetch}
 *     empty={<EmptyState title="No routes yet" action={<Button>New route</Button>} />}
 *   />
 * </Panel>
 * ```
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  rowActions,
  rowActionsLabel,
  isLoading = false,
  error,
  errorTitle,
  onRetry,
  empty,
  dense = false,
  caption,
  defaultSort,
  sort: controlledSort,
  onSortChange,
  skeletonRows = 5,
  rowClassName,
  className,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<DataTableSort | null>(defaultSort ?? null);
  const sort = controlledSort !== undefined ? controlledSort : internalSort;

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    const valueOf = column.sortValue ?? ((row: T) => readField(row, column.key) as SortValue);
    const factor = sort.direction === 'asc' ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index, value: valueOf(row) }))
      .sort((a, b) => {
        const empties = toComparable(a.value) === null || toComparable(b.value) === null;
        const result = compare(a.value, b.value);
        // Keep empties last regardless of direction; stable on ties.
        return (empties ? result : result * factor) || a.index - b.index;
      })
      .map((entry) => entry.row);
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    const next: DataTableSort =
      sort?.key === key ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' };
    if (controlledSort === undefined) setInternalSort(next);
    onSortChange?.(next);
  };

  if (error) {
    return <ErrorState title={errorTitle} message={error} onRetry={onRetry} size="sm" className={className} />;
  }

  const showSkeleton = isLoading && rows.length === 0;

  if (!showSkeleton && rows.length === 0) {
    return <div className={className}>{empty ?? <EmptyState size="sm" title="Nothing here yet" />}</div>;
  }

  const cellPad = dense ? 'px-4 py-2' : 'px-4 py-3';
  const hasActions = Boolean(rowActions);

  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, row: T) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest(INTERACTIVE);
    if (interactive && interactive !== event.currentTarget && event.currentTarget.contains(interactive)) return;
    onRowClick?.(row);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  };

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left" aria-busy={showSkeleton || undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-inset">
          <tr>
            {columns.map((column) => {
              const align = column.align ?? 'left';
              const active = sort?.key === column.key;
              const SortIcon = active ? (sort?.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width !== undefined ? { width: column.width } : undefined}
                  aria-sort={
                    column.sortable ? (active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined
                  }
                  className={cn(
                    'h-9 whitespace-nowrap border-b border-line-subtle px-4 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary',
                    ALIGN[align],
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-tag uppercase tracking-[0.12em] transition-colors hover:text-ink-primary',
                        active && 'text-ink-primary',
                        JUSTIFY[align],
                        focusRing,
                      )}
                    >
                      {column.header}
                      <SortIcon
                        aria-hidden="true"
                        strokeWidth={2}
                        className={cn('h-3 w-3 shrink-0', active ? 'text-primary' : 'text-ink-muted')}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
            {hasActions && (
              <th scope="col" className="h-9 w-12 border-b border-line-subtle px-2">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {showSkeleton
            ? Array.from({ length: skeletonRows }, (_, r) => (
                <tr key={`skeleton-${r}`} aria-hidden="true" className="border-b border-line-subtle last:border-b-0">
                  {columns.map((column, c) => (
                    <td key={column.key} className={cn(cellPad, column.hideBelow && HIDE_BELOW[column.hideBelow])}>
                      <Skeleton className={cn('h-3.5', ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'][(r + c) % 4])} />
                    </td>
                  ))}
                  {hasActions && <td className="px-2" />}
                </tr>
              ))
            : sortedRows.map((row, index) => {
                const id = getRowId(row);
                const clickable = Boolean(onRowClick);
                return (
                  <tr
                    key={id}
                    data-row-id={id}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? (event) => handleRowClick(event, row) : undefined}
                    onKeyDown={clickable ? (event) => handleRowKeyDown(event, row) : undefined}
                    className={cn(
                      'border-b border-line-subtle transition-colors duration-100 last:border-b-0',
                      'hover:bg-ink-primary/[0.035]',
                      clickable && cn('cursor-pointer', focusRingInset),
                      rowClassName?.(row),
                    )}
                  >
                    {columns.map((column, c) => {
                      const content = column.cell ? column.cell(row, index) : (readField(row, column.key) as ReactNode);
                      const isEmpty = content === null || content === undefined || content === '';
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            cellPad,
                            'align-middle text-[13px]',
                            c === 0 ? 'font-medium text-ink-primary' : 'text-ink-secondary',
                            ALIGN[column.align ?? 'left'],
                            column.align === 'right' && 'tabular-nums',
                            column.hideBelow && HIDE_BELOW[column.hideBelow],
                            column.className,
                          )}
                        >
                          {isEmpty ? <span className="text-ink-muted">—</span> : content}
                        </td>
                      );
                    })}
                    {hasActions && rowActions && (
                      <td className="w-12 px-2 py-1 text-right align-middle">
                        <RowActions items={rowActions(row)} label={rowActionsLabel?.(row) ?? 'Actions'} />
                      </td>
                    )}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {showSkeleton && (
        <p role="status" className="sr-only">
          Loading
        </p>
      )}
    </div>
  );
}
