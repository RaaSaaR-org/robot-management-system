/**
 * @file DatasetCard.tsx
 * @description Card component displaying dataset summary
 * @feature training
 */

import { useRef, useState } from 'react';
import { Play, Trash2, Sparkles } from 'lucide-react';
import { Card, Badge, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api/trainingApi';
import type { Dataset, DatasetStatus } from '../types';

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

  return (
    <Card
      onClick={onClick}
      interactive={!!onClick}
      className={cn(
        'cursor-pointer overflow-hidden transition-all',
        selected && 'ring-2 ring-primary-500',
        className
      )}
    >
      {showThumb && <SyntheticThumb datasetId={dataset.id} />}
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
            <Badge className={statusColors[dataset.status] ?? 'bg-gray-100 text-gray-600'}>
              {statusLabels[dataset.status] ?? dataset.status ?? 'Unknown'}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-theme-tertiary">Frames</span>
            <p className="font-medium text-theme-primary">
              {dataset.totalFrames.toLocaleString()}
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
            LeRobot {dataset.lerobotVersion} &bull; {new Date(dataset.createdAt).toLocaleDateString()}
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
