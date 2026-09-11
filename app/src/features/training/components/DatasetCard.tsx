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
import { Button, Checkbox, Panel, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api/trainingApi';
import { datasetShape, describeSelectionOrigin, isDatasetView } from '../types';
import type { Dataset, DatasetParentSummary } from '../types';
import { formatDuration } from './datasets/datasetFormat';
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
    <Panel
      padding="none"
      onClick={onClick}
      interactive={!!onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      className={cn(
        'flex flex-col transition-colors',
        onClick && 'cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        (selected || checked) && 'border-primary',
        className
      )}
    >
      {/* Media slot — every card gets the same-height area so grid rows align.
          Synthetic datasets show a video preview; everything else a neutral
          placeholder. */}
      {showThumb ? <SyntheticThumb datasetId={dataset.id} /> : <PlaceholderThumb />}
      <div className="flex flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          {selectable && (
            <span className="mt-0.5 flex shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={!!checked}
                onChange={() => onToggleChecked?.()}
                aria-label={`Select ${dataset.name} for a training mixture`}
              />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink-primary">{dataset.name}</h3>
            {dataset.description && (
              <p className="mt-1 line-clamp-2 text-[13px] text-ink-secondary">
                {dataset.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isView && (
              <StatusTag
                tone="accent"
                data-testid="dataset-view-badge"
                title="A view — a named episode selection over another dataset. No files were copied."
              >
                <GitFork className="h-3 w-3" strokeWidth={1.75} /> View
              </StatusTag>
            )}
            {isFrozen && (
              <StatusTag
                tone="gated"
                data-testid="dataset-view-frozen"
                title="Frozen — a training run cites this selection, so it can no longer be edited"
              >
                <Lock className="h-3 w-3" strokeWidth={1.75} /> Frozen
              </StatusTag>
            )}
            {isSynthetic && !showThumb && (
              <StatusTag tone="sim" title="Synthetic — generated with NVIDIA Cosmos 3">Synthetic</StatusTag>
            )}
            <StatusTag status={dataset.status ?? 'unknown'} dot />
          </div>
        </div>

        {/* What this view actually is: whose episodes, how many of them, and by
            what rule they were picked. Without the parent's total, "142
            episodes" reads like a small dataset rather than a third of a big
            one — and which third is the whole experiment. */}
        {isView && (
          <div
            data-testid="dataset-view-origin"
            className="mt-3 rounded-control bg-inset px-3 py-2 text-[13px] text-ink-secondary"
          >
            <p className="truncate">
              Fork of{' '}
              <span className="font-medium text-ink-primary">
                {viewParent?.name ?? 'another dataset'}
              </span>
            </p>
            <p className="mt-0.5 text-ink-tertiary">
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
            className="mt-3 rounded-control border border-signal-stopped/40 bg-inset px-3 py-2 text-[13px] text-ink-secondary"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-stopped" strokeWidth={1.75} />
              <div className="min-w-0">
                <span className="font-medium text-ink-primary">Import failed during {importError.phase}</span>
                <p className="mt-0.5 break-words">{importError.error}</p>
                <p className="mt-0.5 text-xs text-ink-tertiary">
                  {new Date(importError.failedAt).toLocaleString(UI_DATE_LOCALE)}
                </p>
              </div>
            </div>
            {onRetryImport && dataset.huggingFaceRepoId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onRetryImport(); }}
                className="mt-2"
                leftIcon={<RotateCw className="h-4 w-4" strokeWidth={1.75} />}
              >
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
            className="mt-3 flex items-start gap-2 rounded-control border border-signal-estimated/40 bg-inset px-3 py-2 text-[13px] text-ink-secondary"
          >
            <CameraOff className="mt-0.5 h-4 w-4 shrink-0 text-signal-estimated" strokeWidth={1.75} />
            <span>No camera features — a VLA policy cannot train on this.</span>
          </div>
        )}

        {errorCount > 0 && (
          <div
            data-testid="dataset-validation-errors"
            className="mt-3 rounded-control border border-signal-stopped/40 bg-inset px-3 py-2 text-[13px] text-ink-secondary"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-stopped" strokeWidth={1.75} />
              <div className="min-w-0">
                <span className="font-medium text-ink-primary">
                  {errorCount === 1 ? '1 structural problem' : `${errorCount} structural problems`}
                </span>
                {/* The first one in full. A count alone sends whoever reads it
                    to the logs, which are on a machine they may not have. */}
                <p className="mt-0.5 break-words">{validation!.errors[0]!.message}</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-ink-tertiary">Frames</span>
            <p className="font-medium text-ink-primary">
              {dataset.totalFrames.toLocaleString(UI_DATE_LOCALE)}
            </p>
          </div>
          <div>
            <span className="text-ink-tertiary">Duration</span>
            <p className="font-medium text-ink-primary">
              {formatDuration(dataset.totalDuration)}
            </p>
          </div>
          <div>
            <span className="text-ink-tertiary">Demonstrations</span>
            <p className="font-medium text-ink-primary">{dataset.demonstrationCount}</p>
          </div>
          <div>
            <span className="text-ink-tertiary">FPS</span>
            <p className="font-medium text-ink-primary">{dataset.fps}</p>
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
          {dataset.importMode === 'metadata' && <StatusTag tone="gated" size="sm">Metadata only</StatusTag>}
        </div>

        {dataset.huggingFaceRepoId && (
          <a
            href={`https://huggingface.co/datasets/${dataset.huggingFaceRepoId}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 break-all font-mono text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            {dataset.huggingFaceRepoId}
          </a>
        )}

        {/* Not validated is a THIRD state, and it was invisible: locally
            registered datasets are written straight to `ready` without a check,
            so a green badge on one meant nothing had been looked at. */}
        {!validation && dataset.status === 'ready' && (
          <div
            data-testid="dataset-not-validated"
            className="mt-3 flex items-start gap-2 text-sm text-ink-tertiary"
          >
            <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>Not validated — nothing has opened this dataset&rsquo;s files.</span>
          </div>
        )}

        {qualityPercent !== null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-ink-tertiary">Quality Score</span>
              <span
                className={cn(
                  'font-medium',
                  qualityPercent >= 80 ? 'text-signal-measured' : qualityPercent >= 60 ? 'text-signal-estimated' : 'text-signal-stopped'
                )}
              >
                {qualityPercent}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  qualityPercent >= 80 ? 'bg-signal-measured' : qualityPercent >= 60 ? 'bg-signal-estimated' : 'bg-signal-stopped'
                )}
                style={{ width: `${qualityPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-ink-tertiary">
            LeRobot {dataset.lerobotVersion} &bull; {new Date(dataset.createdAt).toLocaleDateString(UI_DATE_LOCALE)}
          </span>
          <div className="flex items-center gap-1">
            {dataset.status === 'ready' && onViewEpisodes && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onViewEpisodes(); }}
                leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
              >
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
                  title="Frozen by a training run — fork it again to change the selection"
                  leftIcon={<Copy className="h-4 w-4" strokeWidth={1.75} />}
                >
                  Duplicate
                </Button>
              )
            ) : (
              onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={isView ? 'Delete view' : 'Delete dataset'}
                  title={isView ? 'Delete view' : 'Delete dataset'}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    </Panel>
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
        'inline-flex items-center gap-1 rounded-tag px-1.5 py-0.5',
        unknown
          ? 'border border-dashed border-line-strong text-ink-tertiary'
          : 'bg-inset text-ink-secondary'
      )}
    >
      <span className="text-ink-tertiary">{label}</span>
      <span className={cn('font-medium text-ink-primary', mono && 'font-mono')}>{value}</span>
    </span>
  );
}

/**
 * Neutral media placeholder for datasets without a video preview. Keeps every
 * card's media slot the same height so grid rows stay aligned.
 */
function PlaceholderThumb() {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-inset">
      <Database className="h-7 w-7 text-ink-muted" strokeWidth={1.75} />
    </div>
  );
}

/** "Cosmos 3" provenance tag in the corner of a synthetic thumbnail. */
function CosmosTag() {
  return (
    <span className="pointer-events-none absolute left-2 top-2">
      <StatusTag tone="sim">Cosmos 3</StatusTag>
    </span>
  );
}

/**
 * Looping video preview for a synthetic dataset's first episode. Shows a poster
 * frame at rest and plays muted on hover.
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

  // The preview cannot load (missing video / non-default camera key): keep the
  // provenance tag, drop the broken <video>.
  if (failed) {
    return (
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-inset">
        <Sparkles className="h-7 w-7 text-ink-muted" strokeWidth={1.75} />
        <CosmosTag />
      </div>
    );
  }

  return (
    <div
      className="group/thumb relative aspect-video w-full overflow-hidden bg-canvas"
      onMouseEnter={() => ref.current?.play().catch(() => {})}
      onMouseLeave={() => { const v = ref.current; if (v) { v.pause(); seekPoster(); } }}
    >
      <video
        ref={ref}
        src={src}
        className="h-full w-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={seekPoster}
        onError={() => setFailed(true)}
      />
      <CosmosTag />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/thumb:opacity-100">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas/80 text-ink-primary">
          <Play className="h-4 w-4 translate-x-px" strokeWidth={1.75} fill="currentColor" />
        </span>
      </span>
    </div>
  );
}
