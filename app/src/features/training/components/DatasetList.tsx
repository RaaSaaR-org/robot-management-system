/**
 * @file DatasetList.tsx
 * @description Dataset table: search, status and synthetic filters, row actions and the four list states
 * @feature training
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Database, Search } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  SearchInput,
  Select,
  StatusTag,
  ToggleChip,
  Toolbar,
  Tooltip,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { datasetShape } from '../types';
import type { Dataset, DatasetStatus, RobotType } from '../types';
import { DatasetNameCell } from './datasets/DatasetNameCell';
import { formatCount, formatDuration, formatRelative } from './datasets/datasetFormat';

export interface DatasetListProps {
  datasets: Dataset[];
  isLoading?: boolean;
  /** The list failed to load. */
  error?: string | null;
  onRetry?: () => void;
  /** Robot types by id, to name the robot-type column. */
  robotTypes?: RobotType[];
  /** Opens a row. Only ready rows open. */
  onSelect?: (dataset: Dataset) => void;
  /** The actions of one row, in menu order. */
  rowActions?: (dataset: Dataset) => RowActionItem[];
  /** Extra filters from the page (robot type), placed after the status filter. */
  extraFilters?: ReactNode;
  /**
   * A filter outside this component narrows `datasets`. Without it an empty
   * list is indistinguishable from an empty database.
   */
  filtersActive?: boolean;
  /** Clears the page's own filters as part of "Clear filters". */
  onClearFilters?: () => void;
  /** The primary action shown in the first-run empty state. */
  emptyAction?: ReactNode;
}

const STATUS_ORDER: DatasetStatus[] = ['ready', 'importing', 'validating', 'uploading', 'failed'];
const STATUS_LABEL: Record<DatasetStatus, string> = {
  ready: 'Ready',
  importing: 'Importing',
  validating: 'Validating',
  uploading: 'Uploading',
  failed: 'Failed',
};

export function DatasetList({
  datasets,
  isLoading,
  error,
  onRetry,
  robotTypes = [],
  onSelect,
  rowActions,
  extraFilters,
  filtersActive = false,
  onClearFilters,
  emptyAction,
}: DatasetListProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DatasetStatus | ''>('');
  const [syntheticOnly, setSyntheticOnly] = useState(false);

  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);
  const typeName = useMemo(() => new Map(robotTypes.map((t) => [t.id, t.name])), [robotTypes]);
  const hasSynthetic = datasets.some((d) => d.infoJson?._synthetic);

  const statusOptions = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({
        value: s,
        label: `${STATUS_LABEL[s]} (${datasets.filter((d) => d.status === s).length})`,
      })),
    [datasets],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return datasets.filter(
      (d) =>
        (!status || d.status === status) &&
        (!syntheticOnly || d.infoJson?._synthetic) &&
        (!q || d.name.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q)),
    );
  }, [datasets, search, status, syntheticOnly]);

  const parentOf = (d: Dataset) => {
    const p = d.parentDatasetId ? byId.get(d.parentDatasetId) : undefined;
    return p ? { id: p.id, name: p.name, demonstrationCount: p.demonstrationCount } : null;
  };

  const robotLabel = (d: Dataset) =>
    d.robotType?.name ?? typeName.get(d.robotTypeId) ?? datasetShape(d).robotType ?? '—';

  const columns: DataTableColumn<Dataset>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (d) => d.name.toLowerCase(),
      cell: (d) => <DatasetNameCell dataset={d} parent={parentOf(d)} />,
    },
    { key: 'robot', header: 'Robot type', hideBelow: 'md', sortable: true, sortValue: robotLabel, cell: robotLabel },
    {
      key: 'demonstrationCount',
      header: 'Episodes',
      align: 'right',
      sortable: true,
      cell: (d) => formatCount(d.demonstrationCount),
    },
    {
      key: 'totalDuration',
      header: 'Duration',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      cell: (d) => formatDuration(d.totalDuration),
    },
    {
      key: 'totalFrames',
      header: 'Frames',
      align: 'right',
      sortable: true,
      hideBelow: 'lg',
      cell: (d) => formatCount(d.totalFrames),
    },
    { key: 'status', header: 'Status', sortable: true, cell: (d) => <DatasetStatusCell dataset={d} /> },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      sortable: true,
      hideBelow: 'md',
      sortValue: (d) => new Date(d.updatedAt),
      cell: (d) => <span className="whitespace-nowrap">{formatRelative(d.updatedAt)}</span>,
    },
  ];

  const narrowed = filtersActive || Boolean(search || status || syntheticOnly);
  const clearAll = () => {
    setSearch('');
    setStatus('');
    setSyntheticOnly(false);
    onClearFilters?.();
  };

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search datasets" />}
        filters={
          <>
            <Select
              aria-label="Status"
              fullWidth={false}
              className="w-40"
              placeholder="All statuses"
              options={statusOptions}
              value={status}
              onChange={(e) => setStatus(e.target.value as DatasetStatus | '')}
            />
            {extraFilters}
            {(hasSynthetic || syntheticOnly) && (
              <ToggleChip active={syntheticOnly} onClick={() => setSyntheticOnly((v) => !v)}>
                Synthetic only
              </ToggleChip>
            )}
          </>
        }
      />
      <Panel padding="none">
        <DataTable
          caption="Datasets"
          columns={columns}
          rows={filtered}
          getRowId={(d) => d.id}
          defaultSort={{ key: 'updatedAt', direction: 'desc' }}
          onRowClick={onSelect ? (d) => { if (d.status === 'ready') onSelect(d); } : undefined}
          rowClassName={(d) => (d.status === 'ready' ? undefined : 'cursor-default')}
          rowActions={rowActions}
          rowActionsLabel={(d) => `Actions for ${d.name}`}
          isLoading={isLoading}
          error={error ?? null}
          errorTitle="Couldn't load datasets"
          onRetry={onRetry}
          empty={
            narrowed ? (
              <EmptyState
                icon={<Search />}
                title="No datasets match"
                description="Try another name, or clear the filters."
                action={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<Database />}
                title="No datasets yet"
                description="Upload LeRobot files, import one from Hugging Face, or package a recording session."
                action={emptyAction}
              />
            )
          }
        />
      </Panel>
    </div>
  );
}

/** Status tag; an import in flight shows its bar, a failed one says why on hover. */
function DatasetStatusCell({ dataset }: { dataset: Dataset }) {
  if (dataset.status === 'importing' || dataset.status === 'uploading') {
    return <StatusTag status={dataset.status} dot pulse />;
  }
  const err = dataset.importError;
  if (dataset.status === 'failed' && err) {
    return (
      <Tooltip content={`Import failed during ${err.phase}: ${err.error}`}>
        <span data-testid="dataset-import-error" className="inline-flex">
          <StatusTag status="failed" dot />
        </span>
      </Tooltip>
    );
  }
  return <StatusTag status={dataset.status} dot />;
}
