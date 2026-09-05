/**
 * @file DatasetViewsSection.tsx
 * @description The views forked off a dataset, with what each one selects and
 *   what can still be done to it (TASK-240).
 * @feature training
 */

import { memo, useState } from 'react';
import { Copy, GitFork, HardDriveDownload, Lock, Trash2 } from 'lucide-react';
import { Button, Spinner } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { describeSelectionOrigin } from '../types';
import type { DatasetViewSummary } from '../types';

export interface DatasetViewsSectionProps {
  /**
   * Episodes the parent has — the "of M" half of every row's count. Only a
   * fallback: each row carries its own parent total, and that one is the
   * server's own count rather than however many episodes this page loaded.
   */
  parentEpisodeCount: number;
  views: DatasetViewSummary[];
  isLoading?: boolean;
  /** Why the list could not be loaded. An empty list alone does not say. */
  error?: string | null;
  onCreate?: () => void;
  onOpen?: (view: DatasetViewSummary) => void;
  /** Frozen views are never deleted — they are duplicated instead. */
  onDelete?: (view: DatasetViewSummary) => Promise<void>;
  onDuplicate?: (view: DatasetViewSummary) => void;
  onMaterialize?: (view: DatasetViewSummary) => Promise<void>;
}

/**
 * The "Views" section of a dataset's detail page.
 *
 * Every row says how many of the parent's episodes it selects and by what
 * rule, because a fork whose contents you cannot see is a fork nobody trusts
 * to be an experiment arm.
 */
export const DatasetViewsSection = memo(function DatasetViewsSection({
  parentEpisodeCount,
  views,
  isLoading,
  error,
  onCreate,
  onOpen,
  onDelete,
  onDuplicate,
  onMaterialize,
}: DatasetViewsSectionProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const run = async (
    view: DatasetViewSummary,
    action: (view: DatasetViewSummary) => Promise<void>,
  ) => {
    setBusyId(view.id);
    setRowError(null);
    try {
      await action(view);
    } catch (err) {
      // The 409 for a frozen view names the training job holding it. That
      // sentence is the entire answer to "why did nothing happen".
      setRowError(getErrorMessage(err, `Could not update "${view.name}"`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      data-testid="dataset-views-section"
      className="rounded-xl border border-white/[0.04] bg-[#1E1F24]/40 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-theme-primary">
          <GitFork className="h-4 w-4 text-cobalt-400" />
          Views
          {views.length > 0 && (
            <span className="text-xs font-normal text-theme-tertiary">({views.length})</span>
          )}
        </h3>
        {onCreate && (
          <Button data-testid="views-create" variant="ghost" size="sm" onClick={onCreate}>
            Create view
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" data-testid="views-error" className="mb-2 text-xs text-red-400">
          {error}
        </p>
      )}
      {rowError && (
        <p role="alert" data-testid="views-row-error" className="mb-2 text-xs text-red-400">
          {rowError}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Spinner size="sm" label="Loading views..." />
        </div>
      ) : views.length === 0 ? (
        <p className="text-xs text-theme-tertiary">
          No views yet — select episodes in the list and fork them into one. A view copies no
          files, so twenty experiment arms cost twenty rows.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {views.map((view) => {
            const frozen = !!view.frozenAt;
            const selected = view.selection?.episodes.length ?? view.demonstrationCount;
            const total = view.parentDemonstrationCount ?? parentEpisodeCount;
            const busy = busyId === view.id;
            return (
              <li
                key={view.id}
                data-testid={`view-row-${view.id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.04] bg-[#141414]/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-theme-primary">
                      {view.name}
                    </span>
                    {frozen && (
                      <span
                        data-testid={`view-frozen-${view.id}`}
                        title={`Frozen ${new Date(view.frozenAt!).toLocaleDateString(UI_DATE_LOCALE)} — a training run cites this selection`}
                        className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1 py-px text-[10px] font-medium text-amber-400"
                      >
                        <Lock className="h-3 w-3" />
                        Frozen
                      </span>
                    )}
                    {view.materializedPath && (
                      <span
                        title={`Written to disk at ${view.materializedPath}`}
                        className="rounded bg-theme-secondary/10 px-1 py-px text-[10px] text-theme-tertiary"
                      >
                        on disk
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-theme-tertiary">
                    {selected} of {total} episodes
                    {view.selection ? ` · ${describeSelectionOrigin(view.selection.origin)}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {onOpen && (
                    <Button variant="ghost" size="sm" onClick={() => onOpen(view)}>
                      Open
                    </Button>
                  )}
                  {onMaterialize && !view.materializedPath && (
                    <button
                      data-testid={`view-materialize-${view.id}`}
                      disabled={busy}
                      onClick={() => void run(view, onMaterialize)}
                      title="Write this selection to disk — only needed by a consumer that cannot take an episode filter"
                      className="rounded p-1 text-theme-tertiary transition-colors hover:bg-cobalt-500/10 hover:text-cobalt-400 disabled:opacity-50"
                    >
                      <HardDriveDownload className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* A frozen view cannot be edited or deleted, so it is offered
                      the thing that CAN happen instead of a dead control. */}
                  {frozen
                    ? onDuplicate && view.selection && (
                        <Button
                          data-testid={`view-duplicate-${view.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => onDuplicate(view)}
                          leftIcon={<Copy className="h-3.5 w-3.5" />}
                        >
                          Duplicate
                        </Button>
                      )
                    : onDelete && (
                        <button
                          data-testid={`view-delete-${view.id}`}
                          disabled={busy}
                          onClick={() => void run(view, onDelete)}
                          title="Delete view"
                          className="rounded p-1 text-theme-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
