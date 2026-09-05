/**
 * @file DatasetCard.tsx
 * @description Card component displaying dataset summary
 * @feature training
 */

import { useRef, useState, type KeyboardEvent } from 'react';
import {
  Database,
  Play,
  Trash2,
  Sparkles,
  AlertTriangle,
  CameraOff,
  ShieldQuestion,
  ExternalLink,
  RotateCw,
  GitFork,
  Lock,
  Copy,
} from 'lucide-react';
import { Card, Badge, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api/trainingApi';
import { datasetShape, describeSelectionOrigin, isDatasetView } from '../types';
import type { Dataset, DatasetParentSummary, DatasetStatus } from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface DatasetCardProps {
  dataset: Dataset;
  onClick?: () => void;
  onViewEpisodes?: () => void;
  onDelete?: () => void;
  /** Re-run the import behind this row (it must have a huggingFaceRepoId). */
  onRetryImport?: () => void;
  /**
   * The dataset this view was forked from, when the caller can name it — the
   * grid resolves it out of the list it already holds. `dataset.parent` is
   * used when the server inlined it instead. Ignored for a materialized row.
   */
  parent?: DatasetParentSummary | null;
  /**
   * Fork this view again. A frozen view cannot be edited, so the card offers
   * this in place of the delete control rather than a dead button.
   */
  onDuplicateView?: () => void;
  selected?: boolean;
  /** Show the mixture-selection checkbox. */
  selectable?: boolean;
  /** Whether this dataset is in the current mixture selection. */
  checked?: boolean;
  onToggleChecked?: () => void;
  className?: string;
}

const statusColors: Record<DatasetStatus, string> = {
  uploading: 'bg-blue-100 text-blue-800',
  importing: 'bg-purple-100 text-purple-800',
  validating: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const statusLabels: Record<DatasetStatus, string> = {
  uploading: 'Uploading',
  importing: 'Importing',
  validating: 'Validating',
  ready: 'Ready',
  failed: 'Failed',
};

/**
 * Card component for displaying dataset summary
 */
export function DatasetCard({
  dataset,
  onClick,
  onViewEpisodes,
  onDelete,
  onRetryImport,
  parent,
  onDuplicateView,
  selected,
  selectable,
  checked,
  onToggleChecked,
  className,
}: DatasetCardProps) {
  const qualityPercent = dataset.qualityScore
    ? Math.round(dataset.qualityScore)
    : null;

  // A view copies no bytes: it is `selection` applied to a parent dataset
  // (TASK-240). Viewness is read off `kind` alone — a materialized row can
  // carry a `parentDatasetId` as provenance without being a view.
  const isView = isDatasetView(dataset);
  const viewParent = parent ?? dataset.parent ?? null;
  const selectedEpisodes = dataset.selection?.episodes.length ?? dataset.demonstrationCount;
  const isFrozen = isView && !!dataset.frozenAt;

  const isSynthetic = !!dataset.infoJson?._synthetic;
  const showThumb = isSynthetic && dataset.status === 'ready' && dataset.totalFrames > 0;

  // What validation found, if anything ever looked. Three states, and the
  // third is the one that used to be invisible: a dataset registered straight
  // to `ready` that nobody has checked looks identical to a checked one.
  const validation = dataset.validation;
  const noImages = validation?.warnings.some((w) => w.code === 'NO_IMAGE_FEATURES') ?? false;
  const errorCount = validation?.errors.length ?? 0;

  const importError = dataset.importError;
  const shape = datasetShape(dataset);

  // The card is a div, and a div with an onClick is invisible to a keyboard.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    // ONLY when the card itself has focus. Keydown bubbles, so without this the
    // card answered Enter and Space raised on every control inside it — the
    // mixture checkbox, Retry import, Episodes, Delete, the Hugging Face link.
    // Enter on Retry opened the dataset as well as retrying; Space on the
    // checkbox was swallowed by the preventDefault below and never toggled it.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Space scrolls the page otherwise, which is what the button role promises
    // it will not do.
    event.preventDefault();
    onClick();
  };

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      className={cn(
        'overflow-hidden transition-all',
        onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500',
        selected && 'ring-2 ring-cobalt-500',
        checked && 'ring-2 ring-cobalt-400',
        className
      )}
    >
      {/* Media slot — every card gets the same-height area so grid rows align.
          Synthetic datasets show a video preview; everything else a neutral
          placeholder. */}
      {showThumb ? <SyntheticThumb datasetId={dataset.id} /> : <PlaceholderThumb />}
      <Card.Body>
        <div className="flex items-start justify-between gap-2">
          {selectable && (
            <label
              className="mt-1 flex shrink-0 items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={!!checked}
                onChange={() => onToggleChecked?.()}
                aria-label={`Select ${dataset.name} for a training mixture`}
                className="h-4 w-4"
              />
            </label>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-theme-primary truncate">{dataset.name}</h3>
            {dataset.description && (
              <p className="text-sm text-theme-secondary mt-1 line-clamp-2">
                {dataset.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isView && (
              <Badge
                data-testid="dataset-view-badge"
                variant="cobalt"
                size="sm"
                className="gap-1"
                title="A view — a named episode selection over another dataset. No files were copied."
              >
                <GitFork className="h-3 w-3" />
                View
              </Badge>
            )}
            {isFrozen && (
              <span
                data-testid="dataset-view-frozen"
                title="Frozen — a training run cites this selection, so it can no longer be edited"
                className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-400"
              >
                <Lock className="h-3 w-3" />
                Frozen
              </span>
            )}
            {isSynthetic && !showThumb && (
              <Badge variant="purple" size="sm" className="gap-1" title="Synthetic — generated with NVIDIA Cosmos 3">
                <Sparkles className="h-3 w-3" />
                Synthetic
              </Badge>
            )}
            <Badge className={statusColors[dataset.status] ?? 'bg-theme-elevated text-theme-secondary'}>
              {statusLabels[dataset.status] ?? dataset.status ?? 'Unknown'}
            </Badge>
          </div>
        </div>

        {/* What this view actually is: whose episodes, how many of them, and by
            what rule they were picked. Without the parent's total, "142
            episodes" reads like a small dataset rather than a third of a big
            one — and which third is the whole experiment. */}
        {isView && (
          <div
            data-testid="dataset-view-origin"
            className="mt-3 rounded-md bg-cobalt-500/5 px-3 py-2 text-sm text-theme-secondary"
          >
            <p className="truncate">
              Fork of{' '}
              <span className="font-medium text-theme-primary">
                {viewParent?.name ?? 'another dataset'}
              </span>
            </p>
            <p className="mt-0.5 text-theme-tertiary">
              {viewParent?.demonstrationCount !== undefined
                ? `${selectedEpisodes} of ${viewParent.demonstrationCount} episodes`
                : `${selectedEpisodes} episodes selected`}
              {dataset.selection ? ` · ${describeSelectionOrigin(dataset.selection.origin)}` : ''}
            </p>
          </div>
        )}

        {/* Why the import stopped. A "Failed" badge on its own sends whoever
            reads it to the server's log, on a machine they may not have — and
            the row that provoked this was 171,625 frames of nothing. */}
        {importError && (
          <div
            data-testid="dataset-import-error"
            className="mt-3 rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-300"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-medium">Import failed during {importError.phase}</span>
                <p className="mt-0.5 break-words">{importError.error}</p>
                <p className="mt-0.5 text-xs opacity-80">
                  {new Date(importError.failedAt).toLocaleString(UI_DATE_LOCALE)}
                </p>
              </div>
            </div>
            {onRetryImport && dataset.huggingFaceRepoId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onRetryImport(); }}
                className="mt-2 gap-1 px-2 py-1 h-auto text-xs"
              >
                <RotateCw className="h-3 w-3" />
                Retry import
              </Button>
            )}
          </div>
        )}

        {/* THE line that would have saved a training run. A dataset with no
            camera feature validates perfectly and then dies hours into a
            training job with "All image features are missing from the batch".
            It is a warning and not a failure — a state-only dataset is a
            legitimate thing to hold — so it needs somewhere to be seen. */}
        {noImages && (
          <div
            data-testid="dataset-no-images"
            className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          >
            <CameraOff className="h-4 w-4 shrink-0 mt-0.5" />
            <span>No camera features — a VLA policy cannot train on this.</span>
          </div>
        )}

        {errorCount > 0 && (
          <div
            data-testid="dataset-validation-errors"
            className="mt-3 rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-300"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-medium">
                  {errorCount === 1 ? '1 structural problem' : `${errorCount} structural problems`}
                </span>
                {/* The first one in full. A count alone sends whoever reads it
                    to the logs, which are on a machine they may not have. */}
                <p className="mt-0.5 break-words">{validation!.errors[0]!.message}</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-theme-tertiary">Frames</span>
            <p className="font-medium text-theme-primary">
              {dataset.totalFrames.toLocaleString(UI_DATE_LOCALE)}
            </p>
          </div>
          <div>
            <span className="text-theme-tertiary">Duration</span>
            <p className="font-medium text-theme-primary">
              {formatDuration(dataset.totalDuration)}
            </p>
          </div>
          <div>
            <span className="text-theme-tertiary">Demonstrations</span>
            <p className="font-medium text-theme-primary">{dataset.demonstrationCount}</p>
          </div>
          <div>
            <span className="text-theme-tertiary">FPS</span>
            <p className="font-medium text-theme-primary">{dataset.fps}</p>
          </div>
        </div>

        {/* The facts a mixture is judged on. Two datasets of the same robot are
            concatenable only if these agree, and the widths are what decide it —
            43-wide GR00T next to a 28-wide Dex3 recording is a different action
            space, not a bigger dataset. */}
        <div
          data-testid="dataset-shape"
          className="mt-3 flex flex-wrap items-center gap-1.5 text-xs"
        >
          <ShapeChip label="Robot" value={shape.robotType ?? 'unknown'} unknown={!shape.robotType} />
          <ShapeChip
            label="State/Action"
            value={
              shape.stateWidth !== null || shape.actionWidth !== null
                ? `${shape.stateWidth ?? '?'} / ${shape.actionWidth ?? '?'}`
                : 'unknown'
            }
            unknown={shape.stateWidth === null && shape.actionWidth === null}
          />
          <ShapeChip
            label="Cameras"
            value={String(shape.cameraKeys.length)}
            unknown={false}
          />
          {dataset.sourceRevision && (
            <ShapeChip label="Rev" value={dataset.sourceRevision.slice(0, 7)} unknown={false} mono />
          )}
          {dataset.importMode === 'metadata' && (
            <Badge variant="warning" size="sm">Metadata only</Badge>
          )}
        </div>

        {dataset.huggingFaceRepoId && (
          <a
            href={`https://huggingface.co/datasets/${dataset.huggingFaceRepoId}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 text-xs font-mono text-cobalt-400 hover:underline break-all"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {dataset.huggingFaceRepoId}
          </a>
        )}

        {/* Not validated is a THIRD state, and it was invisible: locally
            registered datasets are written straight to `ready` without a check,
            so a green badge on one meant nothing had been looked at. */}
        {!validation && dataset.status === 'ready' && (
          <div
            data-testid="dataset-not-validated"
            className="mt-3 flex items-start gap-2 text-sm text-theme-tertiary"
          >
            <ShieldQuestion className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Not validated — nothing has opened this dataset&rsquo;s files.</span>
          </div>
        )}

        {qualityPercent !== null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-theme-tertiary">Quality Score</span>
              <span
                className={cn(
                  'font-medium',
                  qualityPercent >= 80
                    ? 'text-green-600'
                    : qualityPercent >= 60
                      ? 'text-yellow-600'
                      : 'text-red-600'
                )}
              >
                {qualityPercent}%
              </span>
            </div>
            <div className="w-full h-2 bg-theme-secondary/20 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  qualityPercent >= 80
                    ? 'bg-green-500'
                    : qualityPercent >= 60
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                )}
                style={{ width: `${qualityPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-theme-secondary/20 flex items-center justify-between">
          <span className="text-xs text-theme-tertiary">
            LeRobot {dataset.lerobotVersion} &bull; {new Date(dataset.createdAt).toLocaleDateString(UI_DATE_LOCALE)}
          </span>
          <div className="flex items-center gap-1">
            {dataset.status === 'ready' && onViewEpisodes && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onViewEpisodes(); }}
                className="text-xs gap-1 px-2 py-1 h-auto"
              >
                <Play className="w-3 h-3" />
                Episodes
              </Button>
            )}
            {/* A frozen view is what a finished run was trained on: it cannot
                be edited or deleted. The card offers the thing that CAN happen
                — a new view starting from the same episodes — rather than a
                disabled bin with no explanation. */}
            {isFrozen ? (
              onDuplicateView && (
                <Button
                  data-testid="dataset-view-duplicate"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onDuplicateView(); }}
                  className="text-xs gap-1 px-2 py-1 h-auto"
                  title="Frozen by a training run — fork it again to change the selection"
                >
                  <Copy className="w-3 h-3" />
                  Duplicate
                </Button>
              )
            ) : (
              onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 rounded text-theme-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title={isView ? 'Delete view' : 'Delete dataset'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

/**
 * One fact from `datasetShape`. An unknown one is drawn dashed rather than
 * merely spelled differently, so it does not read as a measured value.
 */
function ShapeChip({
  label,
  value,
  unknown,
  mono,
}: {
  label: string;
  value: string;
  unknown: boolean;
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
        unknown
          ? 'border border-dashed border-theme-secondary/40 text-theme-tertiary'
          : 'bg-theme-secondary/10 text-theme-secondary'
      )}
    >
      <span className="text-theme-tertiary">{label}</span>
      <span className={cn('font-medium text-theme-primary', mono && 'font-mono')}>{value}</span>
    </span>
  );
}

/**
 * Neutral media placeholder for datasets without a video preview. Keeps every
 * card's media slot the same height so grid rows stay aligned.
 */
function PlaceholderThumb() {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-theme-elevated">
      <Database className="h-7 w-7 text-theme-muted" />
    </div>
  );
}

/**
 * Looping video preview for a synthetic dataset's first episode. Shows a poster
 * frame at rest and plays muted on hover — turns the synthetic list into a
 * gallery of generated clips.
 */
function SyntheticThumb({ datasetId }: { datasetId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const src = `${trainingApi.getEpisodeVideoUrl(datasetId, 0, 'image_0')}#t=0.1`;

  const seekPoster = () => {
    const v = ref.current;
    if (v) {
      try { v.currentTime = 0.1; } catch { /* not seekable yet */ }
    }
  };

  // Fallback when the preview can't load (missing video / non-default camera
  // key): keep the Cosmos 3 chip, drop the broken <video> and play overlay.
  if (failed) {
    return (
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-purple-500/5">
        <Sparkles className="h-7 w-7 text-purple-400/50" />
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-purple-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          <Sparkles className="h-3 w-3" />
          Cosmos 3
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/thumb relative aspect-video w-full overflow-hidden bg-black"
      onMouseEnter={() => ref.current?.play().catch(() => {})}
      onMouseLeave={() => { const v = ref.current; if (v) { v.pause(); seekPoster(); } }}
    >
      <video
        ref={ref}
        src={src}
        className="h-full w-full object-cover transition-transform duration-500 group-hover/thumb:scale-105"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={seekPoster}
        onError={() => setFailed(true)}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-md bg-purple-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
        <Sparkles className="h-3 w-3" />
        Cosmos 3
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/thumb:opacity-100">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
          <Play className="h-4 w-4 translate-x-px text-white" fill="currentColor" />
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
