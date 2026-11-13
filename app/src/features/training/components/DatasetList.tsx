/**
 * @file DatasetList.tsx
 * @description Dataset table: search, status and synthetic filters, row actions and the four list states.
 *              The table always fits its panel (TASK-493): the name column takes
 *              what the others leave and wraps or truncates inside it, every
 *              other cell has a fixed width — a progress bar included — and the
 *              low-value columns fold away as the window narrows, so the status
 *              and the row actions are never pushed off the right edge.
 * @feature training
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Database, Search } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  ProgressBar,
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
import { uploadPercent, useDatasetUploadStore } from '../store/datasetUploadStore';
import { useImportJobsStore } from '../store/importJobsStore';
import { DatasetNameCell } from './datasets/DatasetNameCell';
import { ImportProgress } from './ImportProgress';
import { describeImportFailure } from './datasets/importFormat';
import { formatBytes, formatCount, formatDuration, formatRelative } from './datasets/datasetFormat';

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

  // What is on screen at each width, so that nothing has to scroll sideways
  // (TASK-493). The content area is the window minus the 224 px sidebar and
  // the page gutters; every column but the name has a fixed width:
  //
  //   < 640   name · status                                   (TASK-358)
  //   640     + episodes, with the duration under the count
  //   1280    + robot type, updated
  //   1440    + duration as its own column
  //   1536    + frames
  const columns: DataTableColumn<Dataset>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (d) => d.name.toLowerCase(),
      // `width: 100%` makes this the column that absorbs the slack, `max-width: 0`
      // lets it shrink below its text instead of widening the table.
      className: 'sm:w-full sm:max-w-0',
      cell: (d) => <DatasetNameCell dataset={d} parent={parentOf(d)} />,
    },
    {
      key: 'robot',
      header: 'Robot type',
      hideBelow: 'xl',
      sortable: true,
      sortValue: robotLabel,
      cell: (d) => (
        // Two lines at most: an import-created name like
        // "unitree_g1_dex3 (action 31, state 31)" took three and set the row height.
        <span className="line-clamp-2 w-40 break-words min-[1440px]:w-44" title={robotLabel(d)}>
          {robotLabel(d)}
        </span>
      ),
    },
    {
      key: 'demonstrationCount',
      header: 'Episodes',
      align: 'right',
      sortable: true,
      // Below `sm` the name and the status are what fits in 400 px (TASK-358).
      hideBelow: 'sm',
      cell: (d) => (
        <>
          {formatCount(d.demonstrationCount)}
          {/* Until the window has room for a Duration column, it rides here. */}
          <span className="block whitespace-nowrap text-xs text-ink-tertiary min-[1440px]:hidden" data-testid="dataset-duration-inline">
            {formatDuration(d.totalDuration)}
          </span>
        </>
      ),
    },
    {
      key: 'totalDuration',
      header: 'Duration',
      align: 'right',
      sortable: true,
      hideBelow: 'wide',
      cell: (d) => <span className="whitespace-nowrap">{formatDuration(d.totalDuration)}</span>,
    },
    {
      key: 'totalFrames',
      header: 'Frames',
      align: 'right',
      sortable: true,
      hideBelow: '2xl',
      cell: (d) => formatCount(d.totalFrames),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      // One width for every state, so a row that starts uploading moves nothing.
      cell: (d) => (
        <div className={STATUS_CELL} data-testid="dataset-status-cell">
          <DatasetStatusCell dataset={d} />
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      sortable: true,
      hideBelow: 'xl',
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
                description="Upload a LeRobot dataset folder, import one from Hugging Face, or package a recording session."
                action={emptyAction}
              />
            )
          }
        />
      </Panel>
    </div>
  );
}

/**
 * The status cell's box: 7 rem on a phone (TASK-358), 9 rem from `sm` up — wide
 * enough for "12% · 55.1 MB / 425 MB" under a bar, and the same for a bare tag.
 */
const STATUS_CELL = 'flex w-28 min-w-0 flex-col items-start gap-1.5 sm:w-36';

/** Status tag; an import in flight shows its bar, a failed one says why on hover. */
function DatasetStatusCell({ dataset }: { dataset: Dataset }) {
  // A Hub import in flight is followed by the import tracker (the datasets
  // page starts following any it finds), which knows its phase and bytes.
  const job = useImportJobsStore((state) => state.jobs[dataset.id]);
  const upload = useDatasetUploadStore((state) => (state.job?.datasetId === dataset.id ? state.job : null));
  const hubImport = Boolean(dataset.huggingFaceRepoId)
    && (dataset.status === 'importing' || dataset.status === 'validating');
  if (hubImport) {
    return (
      // The bar is as wide as the cell, never wider: an 11 rem bar pushed the
      // table sideways at 400 px (TASK-358) and the row actions off it at 1440 (TASK-493).
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <StatusTag status={dataset.status} dot pulse />
        {job?.state === 'running'
          ? <ImportProgress job={job} compact />
          : <ProgressBar size="sm" showValue={false} indeterminate />}
      </div>
    );
  }
  // The upload this tab is running (TASK-481): its bytes while it is sending,
  // then a moving bar until the server has verified and validated it.
  if (upload && (dataset.status === 'uploading' || dataset.status === 'validating')) {
    const sending = upload.phase === 'uploading' || upload.phase === 'finishing';
    const percent = Math.floor(uploadPercent(upload) ?? 0);
    const line = upload.phase === 'failed'
      ? 'Stopped — open the upload to try again'
      : upload.phase === 'cancelling'
        ? 'Cancelling'
        : sending
          ? `${percent}% · ${formatBytes(upload.sentBytes)} / ${formatBytes(upload.totalBytes)}`
          : upload.phase === 'validating' ? 'Validating' : 'Verifying the files';
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5" data-testid={`upload-progress-${dataset.id}`}>
        <StatusTag status={dataset.status} dot pulse={upload.phase !== 'failed'} />
        <ProgressBar
          size="sm"
          showValue={false}
          value={percent}
          variant={upload.phase === 'failed' ? 'error' : 'default'}
          indeterminate={!sending && upload.phase !== 'failed'}
        />
        <span className="w-full truncate text-[11px] tabular-nums text-ink-tertiary" title={line}>{line}</span>
      </div>
    );
  }
  if (dataset.status === 'importing' || dataset.status === 'uploading') {
    return <StatusTag status={dataset.status} dot pulse />;
  }
  const err = dataset.importError;
  if (dataset.status === 'failed' && err?.cancelled) {
    // Stopped on purpose (TASK-371): not a failure to explain.
    return <StatusTag tone="neutral" dot>Cancelled</StatusTag>;
  }
  if (dataset.status === 'failed' && err) {
    // The cause first; the server's whole sentence, file name and all, on hover.
    const failure = describeImportFailure(err.error, err.phase);
    return (
      <Tooltip content={`Import failed during ${err.phase}: ${failure.detail}`}>
        <span data-testid="dataset-import-error" className="inline-flex w-full min-w-0 flex-col items-start gap-1">
          <StatusTag status="failed" dot />
          <span className="max-w-full truncate text-[11px] text-ink-tertiary">{failure.headline}</span>
        </span>
      </Tooltip>
    );
  }
  return <StatusTag status={dataset.status} dot />;
}
