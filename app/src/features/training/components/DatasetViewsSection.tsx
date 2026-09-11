/**
 * @file DatasetViewsSection.tsx
 * @description The views forked off a dataset, with what each one selects and
 *   what can still be done to it (TASK-240).
 * @feature training
 */

import { memo } from 'react';
import { Copy, ExternalLink, GitFork, HardDriveDownload, Lock, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  StatusTag,
  Tooltip,
  confirm,
  toast,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { describeSelectionOrigin } from '../types';
import type { DatasetViewSummary } from '../types';
import { formatRelative } from './datasets/datasetFormat';

export interface DatasetViewsSectionProps {
  /**
   * Episodes the parent has — the "of M" half of every row's count. Only a
   * fallback: each row carries its own parent total from the server.
   */
  parentEpisodeCount: number;
  views: DatasetViewSummary[];
  isLoading?: boolean;
  /** Why the list could not be loaded. An empty list alone does not say. */
  error?: string | null;
  onRetry?: () => void;
  onCreate?: () => void;
  onOpen?: (view: DatasetViewSummary) => void;
  /** Frozen views are never deleted — they are duplicated instead. */
  onDelete?: (view: DatasetViewSummary) => Promise<void>;
  onDuplicate?: (view: DatasetViewSummary) => void;
  onMaterialize?: (view: DatasetViewSummary) => Promise<void>;
}

/**
 * The "Views" panel of a dataset's episode page. Every row says how many of the
 * parent's episodes it selects and by what rule, because a fork whose contents
 * you cannot see is a fork nobody trusts to be an experiment arm.
 */
export const DatasetViewsSection = memo(function DatasetViewsSection({
  parentEpisodeCount,
  views,
  isLoading,
  error,
  onRetry,
  onCreate,
  onOpen,
  onDelete,
  onDuplicate,
  onMaterialize,
}: DatasetViewsSectionProps) {
  const askDelete = async (view: DatasetViewSummary) => {
    if (!onDelete) return;
    const ok = await confirm({
      title: `Delete ${view.name}?`,
      description: 'The view is removed. The episodes stay in this dataset — a view copies no files.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await onDelete(view);
      toast.success('View deleted', { description: view.name });
    } catch (err) {
      // The 409 for a frozen view names the training job holding it.
      toast.error("Couldn't delete view", { description: getErrorMessage(err, view.name) });
    }
  };

  const materialize = async (view: DatasetViewSummary) => {
    if (!onMaterialize) return;
    try {
      await onMaterialize(view);
    } catch (err) {
      toast.error("Couldn't write the view to disk", { description: getErrorMessage(err, view.name) });
    }
  };

  const actionsFor = (view: DatasetViewSummary): RowActionItem[] => {
    const frozen = !!view.frozenAt;
    const items: RowActionItem[] = [];
    if (onOpen) items.push({ label: 'Open', icon: <ExternalLink />, onSelect: () => onOpen(view) });
    if (onMaterialize && !view.materializedPath) {
      items.push({ label: 'Write to disk', icon: <HardDriveDownload />, onSelect: () => void materialize(view) });
    }
    // A frozen view cannot be edited or deleted, so it is offered the thing
    // that CAN happen instead of a dead control.
    if (frozen) {
      if (onDuplicate && view.selection) items.push({ label: 'Duplicate', icon: <Copy />, onSelect: () => onDuplicate(view) });
    } else if (onDelete) {
      items.push({ label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: items.length > 0, onSelect: () => void askDelete(view) });
    }
    return items;
  };

  const columns: DataTableColumn<DatasetViewSummary>[] = [
    {
      key: 'name',
      header: 'View',
      sortable: true,
      cell: (view) => {
        const selected = view.selection?.episodes.length ?? view.demonstrationCount;
        const total = view.parentDemonstrationCount ?? parentEpisodeCount;
        return (
          <div data-testid={`view-row-${view.id}`} className="flex min-w-0 max-w-lg flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-ink-primary">{view.name}</span>
              {view.frozenAt && (
                <Tooltip content={`Frozen ${new Date(view.frozenAt).toLocaleDateString(UI_DATE_LOCALE)} — a training run cites this selection`}>
                  <span className="inline-flex">
                    <StatusTag tone="gated" size="sm" data-testid={`view-frozen-${view.id}`}>
                      <Lock className="h-3 w-3" strokeWidth={1.75} /> Frozen
                    </StatusTag>
                  </span>
                </Tooltip>
              )}
              {view.materializedPath && <StatusTag tone="neutral" size="sm" title={`Written to ${view.materializedPath}`}>On disk</StatusTag>}
            </div>
            <span className="truncate text-[13px] text-ink-tertiary">
              {selected} of {total} episodes
              {view.selection ? ` · ${describeSelectionOrigin(view.selection.origin)}` : ''}
            </span>
          </div>
        );
      },
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      sortValue: (v) => new Date(v.updatedAt),
      cell: (v) => <span className="whitespace-nowrap">{formatRelative(v.updatedAt)}</span>,
    },
  ];

  return (
    <Panel padding="none" data-testid="dataset-views-section">
      <Panel.Header
        title={views.length > 0 ? `Views (${views.length})` : 'Views'}
        titleAs="h2"
        description="Named episode selections of this dataset. A view copies no files."
        actions={
          onCreate && (
            <Button data-testid="views-create" variant="ghost" size="sm" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={onCreate}>
              Create view
            </Button>
          )
        }
      />
      <DataTable
        caption="Views of this dataset"
        dense
        columns={columns}
        rows={views}
        getRowId={(v) => v.id}
        onRowClick={onOpen}
        rowActions={actionsFor}
        rowActionsLabel={(v) => `Actions for ${v.name}`}
        isLoading={isLoading}
        error={error ?? null}
        errorTitle="Couldn't load views"
        onRetry={onRetry}
        empty={
          <EmptyState
            size="sm"
            icon={<GitFork />}
            title="No views yet"
            description="Tick episodes in the list and create a view — twenty experiment arms cost twenty rows, not twenty copies."
          />
        }
      />
    </Panel>
  );
});
