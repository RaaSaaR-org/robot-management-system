/**
 * @file EpisodeViewer.tsx
 * @description Camera grid and playback controls (play, seek, speed) for one episode. On a wide
 *              screen it fills the height its parent gives it, so the controls stay in view.
 * @feature training
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MutableRefObject, ReactNode, SyntheticEvent } from 'react';
import { Pause, Play, VideoOff } from 'lucide-react';
import { Button, EmptyState, Panel, SegmentedControl } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { cameraLabel, formatPlayhead } from './episodeFormat';
import { canPlayVideoCodec, describeVideoCodec } from './videoCodec';

export type PlaybackSpeed = '0.5' | '1' | '2';

/** `side`: a column beside the chart. `stacked`: across the width, above the chart. */
export type ViewerLayout = 'side' | 'stacked';

export interface EpisodeViewerProps {
  cameras: string[];
  /** Video URL for a camera of the selected episode. */
  srcFor: (camera: string) => string;
  /**
   * The codec a camera's video is stored in, from the dataset's info.json
   * (`av1`, `h264`, …). Lets the player say "this browser can't play AV1"
   * instead of showing a blank box.
   */
  codecFor?: (camera: string) => string | undefined;
  /**
   * False while the URLs are not usable yet (the video ticket is on its way).
   * No `<video>` is mounted until then. Default true.
   */
  ready?: boolean;
  /**
   * Ask for fresh video URLs: a video failed to load, which with sign-in on is
   * what an expired ticket looks like. Called once on its own before a failure
   * is shown, and again by the Retry button.
   */
  onReload?: () => void;
  primaryCamera: string | undefined;
  videoRefs: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  onTimeUpdate: () => void;
  /**
   * A camera's video is ready to be played or sought. Every camera reports,
   * not only the primary one: a newly loaded video starts paused at 1×, and the
   * page puts the chosen speed and the play state back on each of them.
   */
  onLoadedMetadata: (camera: string) => void;
  onEnded: () => void;
  /** The primary video stopped on its own account (the end, the browser, a media key). */
  onPause?: () => void;
  /** A camera ended in a notice instead of a video: nothing is playing there. */
  onFailure?: (camera: string) => void;
  /**
   * How the cameras tile on a wide screen: two cameras stack in `side` and sit
   * next to each other in `stacked`. Default `stacked`.
   */
  layout?: ViewerLayout;
  className?: string;
  /** What the viewer asked for: true from Play until Pause, the end, or a failure. */
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

/** `MediaError.MEDIA_ERR_DECODE`: the bytes arrived and could not be decoded. */
const MEDIA_ERR_DECODE = 3;

/** How long a silent reload may take before the failure is shown after all. */
const RELOAD_GRACE_MS = 4000;

/** The URL without its ticket: the same video, whichever ticket fetched it. */
function withoutTicket(src: string): string {
  return src.replace(/([?&])ticket=[^&#]*&?/, '$1').replace(/[?&](?=#|$)/, '');
}

/** A message in the place a video would be. Calm: nothing here is the viewer's fault. */
function PlayerNotice({
  testId,
  title,
  children,
  onRetry,
}: {
  testId: string;
  title: string;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex aspect-video w-full flex-col items-center justify-center gap-2 px-6 pt-8 text-center lg:aspect-auto lg:h-full lg:min-h-[11rem] lg:pb-3"
    >
      <VideoOff className="h-6 w-6 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <p className="text-sm font-medium text-ink-primary">{title}</p>
      <p className="max-w-md text-xs text-ink-tertiary">{children}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      )}
    </div>
  );
}

interface CameraCellProps {
  camera: string;
  src: string;
  codec: string | undefined;
  ready: boolean;
  onReload?: () => void;
  videoRefs: EpisodeViewerProps['videoRefs'];
  onLoadedMetadata: (camera: string) => void;
  onFailure?: (camera: string) => void;
  /** Playback events, wired on the primary camera only. */
  onTimeUpdate?: () => void;
  onEnded?: () => void;
  onPause?: () => void;
}

/**
 * One camera of the episode: its video, or the reason there is none.
 *
 * A `<video>` that cannot play says nothing by itself — it stays a blank box —
 * so every way it can fail ends in a sentence here (TASK-478):
 *
 * - the browser says up front it cannot play the dataset's codec → no request
 *   is made at all, the notice names the codec and where it does play;
 * - the bytes arrive and do not decode → the same notice;
 * - the request fails (404, network, a refused or expired ticket) → one silent
 *   reload with fresh URLs, then "Couldn't load this video" with Retry.
 */
function CameraCell(p: CameraCellProps) {
  const { camera, src, codec, onReload, onFailure } = p;
  // Bumped by Retry, and part of the <video> key: a new element is the only
  // reliable way to make a browser request an unchanged URL again.
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ src: string; attempt: number; kind: 'codec' | 'load' } | null>(null);
  // The URL a silent reload is pending for.
  const [reloading, setReloading] = useState<string | null>(null);
  // The video (ticket aside) that has already had its one silent reload.
  const reloaded = useRef<string | null>(null);

  const playable = useMemo(() => canPlayVideoCodec(codec), [codec]);
  // A failure belongs to the URL and attempt it happened on; a new episode, a
  // new ticket or a retry starts clean without an effect to reset it.
  const failed = failure && failure.src === src && failure.attempt === attempt ? failure.kind : null;

  useEffect(() => {
    if (!reloading || reloading !== src) return;
    // Fresh URLs were asked for and none came: say so rather than sit blank.
    const timer = setTimeout(() => setFailure({ src, attempt, kind: 'load' }), RELOAD_GRACE_MS);
    return () => clearTimeout(timer);
  }, [reloading, src, attempt]);

  // A notice in place of the video means nothing plays here. The page hears
  // it, so the play button never claims otherwise (TASK-484).
  const broken = playable === false || failed !== null;
  useEffect(() => {
    if (broken) onFailure?.(camera);
  }, [broken, camera, src, onFailure]);

  const handleError = (e: SyntheticEvent<HTMLVideoElement>) => {
    if (e.currentTarget.error?.code === MEDIA_ERR_DECODE) {
      setFailure({ src, attempt, kind: 'codec' });
      return;
    }
    const video = withoutTicket(src);
    if (onReload && reloaded.current !== video) {
      reloaded.current = video;
      setReloading(src);
      onReload();
      return;
    }
    setFailure({ src, attempt, kind: 'load' });
  };

  const retry = () => {
    setAttempt((a) => a + 1);
    setReloading(null);
    onReload?.();
  };

  const info = codec ? describeVideoCodec(codec) : null;

  let body: ReactNode;
  if (playable === false || failed === 'codec') {
    body = (
      <PlayerNotice
        testId="video-codec-unsupported"
        title={info ? `This browser can't play ${info.label} video` : "This browser can't decode this video"}
      >
        {info
          ? `This camera's video is stored as ${info.label}, which this browser cannot decode. Open this page in ${info.browsers} to watch it.`
          : 'The video arrived, but this browser could not decode it. Open this page in a current Chrome, Edge or Firefox to watch it.'}
      </PlayerNotice>
    );
  } else if (failed === 'load') {
    body = (
      <PlayerNotice testId="video-load-failed" title="Couldn't load this video" onRetry={retry}>
        The server did not return a playable video for this camera.
        {info && ` It is stored as ${info.label} — if it keeps failing, this browser may not be able to decode it.`}
      </PlayerNotice>
    );
  } else if (!p.ready) {
    body = <div className="aspect-video w-full lg:aspect-auto lg:h-full" data-testid="video-pending" />;
  } else {
    body = (
      <video
        key={attempt}
        ref={(el) => { p.videoRefs.current[camera] = el; }}
        src={src}
        onTimeUpdate={p.onTimeUpdate}
        onLoadedMetadata={() => p.onLoadedMetadata(camera)}
        onEnded={p.onEnded}
        onPause={p.onPause}
        onError={handleError}
        // Wide screens: the cell's height is the layout's and the picture fits inside it.
        className="aspect-video w-full lg:absolute lg:inset-0 lg:aspect-auto lg:h-full lg:object-contain"
        playsInline
      />
    );
  }

  return (
    <div className="relative bg-canvas lg:min-h-0">
      <span className="absolute left-2 top-2 z-10 rounded-tag bg-canvas/80 px-1.5 py-0.5 text-xs font-medium text-ink-secondary">
        {cameraLabel(camera)}
      </span>
      {body}
    </div>
  );
}

/** Column classes of the camera grid (written out, so Tailwind sees each one). */
function gridColumns(count: number, layout: ViewerLayout): string {
  if (count <= 1) return '';
  // Two cameras stack in the narrow side column; three or four make a 2×2 block.
  if (count === 2 && layout === 'side') return 'sm:grid-cols-2 lg:grid-cols-1';
  return 'sm:grid-cols-2';
}

export function EpisodeViewer(p: EpisodeViewerProps) {
  const { cameras, codecFor, layout = 'stacked' } = p;
  // With every camera in a codec this browser refuses there is nothing to
  // play, and a Play button that does nothing would be a small lie.
  const nothingPlayable = useMemo(
    () => cameras.length > 0 && cameras.every((cam) => canPlayVideoCodec(codecFor?.(cam)) === false),
    [cameras, codecFor],
  );

  if (cameras.length === 0) {
    return (
      <Panel data-testid="no-cameras" className={cn('lg:flex lg:flex-col lg:justify-center', p.className)}>
        <EmptyState
          size="sm"
          icon={<VideoOff />}
          title="No camera streams in this dataset"
          description="It holds joint states and actions only — inspect the joint trajectories chart."
        />
      </Panel>
    );
  }

  const duration = p.duration > 0 ? p.duration : 0;
  // Never past the end: the clock and the slider stop where the total is.
  const position = duration > 0 ? Math.min(Math.max(0, p.currentTime), duration) : 0;

  return (
    <Panel padding="none" data-testid="episode-viewer" className={cn('flex flex-col overflow-hidden lg:min-h-0', p.className)}>
      <div
        className={cn(
          'grid gap-px bg-line-subtle lg:min-h-0 lg:flex-1 lg:auto-rows-fr',
          gridColumns(cameras.length, layout),
        )}
      >
        {cameras.map((cam) => (
          <CameraCell
            key={cam}
            camera={cam}
            src={p.srcFor(cam)}
            codec={codecFor?.(cam)}
            ready={p.ready ?? true}
            onReload={p.onReload}
            videoRefs={p.videoRefs}
            onLoadedMetadata={p.onLoadedMetadata}
            onFailure={p.onFailure}
            onTimeUpdate={cam === p.primaryCamera ? p.onTimeUpdate : undefined}
            onEnded={cam === p.primaryCamera ? p.onEnded : undefined}
            onPause={cam === p.primaryCamera ? p.onPause : undefined}
          />
        ))}
      </div>
      <div data-testid="transport" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={p.isPlaying ? 'Pause' : 'Play'}
          disabled={nothingPlayable}
          onClick={p.onPlayPause}
        >
          {p.isPlaying ? <Pause className="h-4 w-4" strokeWidth={1.75} /> : <Play className="h-4 w-4" strokeWidth={1.75} />}
        </Button>
        <span data-testid="transport-clock" className="whitespace-nowrap text-xs tabular-nums text-ink-tertiary">
          {formatPlayhead(position)} / {formatPlayhead(duration)}
        </span>
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={duration || 1}
          step={0.01}
          value={position}
          disabled={nothingPlayable}
          onChange={p.onSeek}
          className="mx-1 min-w-16 flex-1 cursor-pointer accent-primary"
        />
        <SegmentedControl label="Playback speed" size="sm" options={SPEEDS} value={p.speed} onChange={p.onSpeedChange} />
      </div>
    </Panel>
  );
}
