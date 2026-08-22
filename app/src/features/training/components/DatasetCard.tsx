/**
 * @file DatasetCard.tsx
 * @description Card component displaying dataset summary
 * @feature training
 */

import { useRef, useState } from 'react';
import { Database, Play, Trash2, Sparkles, AlertTriangle, CameraOff, ShieldQuestion } from 'lucide-react';
import { Card, Badge, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api/trainingApi';
import type { Dataset, DatasetStatus } from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface DatasetCardProps {
  dataset: Dataset;
  onClick?: () => void;
  onViewEpisodes?: () => void;
  onDelete?: () => void;
  selected?: boolean;
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
export function DatasetCard({ dataset, onClick, onViewEpisodes, onDelete, selected, className }: DatasetCardProps) {
  const qualityPercent = dataset.qualityScore
    ? Math.round(dataset.qualityScore)
    : null;

  const isSynthetic = !!dataset.infoJson?._synthetic;
  const showThumb = isSynthetic && dataset.status === 'ready' && dataset.totalFrames > 0;

  // What validation found, if anything ever looked. Three states, and the
  // third is the one that used to be invisible: a dataset registered straight
  // to `ready` that nobody has checked looks identical to a checked one.
  const validation = dataset.validation;
  const noImages = validation?.warnings.some((w) => w.code === 'NO_IMAGE_FEATURES') ?? false;
  const errorCount = validation?.errors.length ?? 0;

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      className={cn(
        'cursor-pointer overflow-hidden transition-all',
        selected && 'ring-2 ring-cobalt-500',
        className
      )}
    >
      {/* Media slot — every card gets the same-height area so grid rows align.
          Synthetic datasets show a video preview; everything else a neutral
          placeholder. */}
      {showThumb ? <SyntheticThumb datasetId={dataset.id} /> : <PlaceholderThumb />}
      <Card.Body>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-theme-primary truncate">{dataset.name}</h3>
            {dataset.description && (
              <p className="text-sm text-theme-secondary mt-1 line-clamp-2">
                {dataset.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1 rounded text-theme-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                title="Delete dataset"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
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
