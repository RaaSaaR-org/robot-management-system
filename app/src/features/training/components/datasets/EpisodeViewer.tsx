/**
 * @file EpisodeViewer.tsx
 * @description Camera grid and playback controls (play, seek, speed) for one episode
 * @feature training
 */

import type { ChangeEvent, MutableRefObject } from 'react';
import { Pause, Play, VideoOff } from 'lucide-react';
import { Button, EmptyState, Panel, SegmentedControl } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { formatClock } from './episodeFormat';

export type PlaybackSpeed = '0.5' | '1' | '2';

export interface EpisodeViewerProps {
  cameras: string[];
  /** Video URL for a camera of the selected episode. */
  srcFor: (camera: string) => string;
  primaryCamera: string | undefined;
  videoRefs: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  onEnded: () => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  duration: number;
  onSeek: (e: ChangeEvent<HTMLInputElement>) => void;
  speed: PlaybackSpeed;
  onSpeedChange: (speed: PlaybackSpeed) => void;
}

const SPEEDS: { value: PlaybackSpeed; label: string }[] = [
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
];

export function EpisodeViewer(p: EpisodeViewerProps) {
  if (p.cameras.length === 0) {
    return (
      <Panel data-testid="no-cameras">
        <EmptyState
          size="sm"
          icon={<VideoOff />}
          title="No camera streams in this dataset"
          description="It holds joint states and actions only — inspect the trajectory chart below."
        />
      </Panel>
    );
  }

  return (
    <Panel padding="none">
      <div className={cn('grid gap-px bg-line-subtle', p.cameras.length > 1 && 'lg:grid-cols-2')}>
        {p.cameras.map((cam) => (
          <div key={cam} className="relative bg-canvas">
            <span className="absolute left-2 top-2 z-10 rounded-tag bg-canvas/80 px-1.5 py-0.5 text-xs font-medium text-ink-secondary">
              {cam}
            </span>
            <video
              ref={(el) => { p.videoRefs.current[cam] = el; }}
              src={p.srcFor(cam)}
              onTimeUpdate={cam === p.primaryCamera ? p.onTimeUpdate : undefined}
              onLoadedMetadata={cam === p.primaryCamera ? p.onLoadedMetadata : undefined}
              onEnded={cam === p.primaryCamera ? p.onEnded : undefined}
              className="aspect-video w-full"
              playsInline
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={p.isPlaying ? 'Pause' : 'Play'}
          onClick={p.onPlayPause}
        >
          {p.isPlaying ? <Pause className="h-4 w-4" strokeWidth={1.75} /> : <Play className="h-4 w-4" strokeWidth={1.75} />}
        </Button>
        <span className="w-24 text-xs tabular-nums text-ink-tertiary">
          {formatClock(p.currentTime)} / {formatClock(p.duration)}
        </span>
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={p.duration || 1}
          step={0.05}
          value={p.currentTime}
          onChange={p.onSeek}
          className="min-w-24 flex-1 cursor-pointer accent-primary"
        />
        <SegmentedControl label="Playback speed" size="sm" options={SPEEDS} value={p.speed} onChange={p.onSpeedChange} />
      </div>
    </Panel>
  );
}
