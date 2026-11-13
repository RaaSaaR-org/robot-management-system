/**
 * @file EpisodeViewer.tsx
 * @description Camera grid and playback controls (play, seek, speed) for one episode
 * @feature training
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MutableRefObject, ReactNode, SyntheticEvent } from 'react';
import { Pause, Play, VideoOff } from 'lucide-react';
import { Button, EmptyState, Panel, SegmentedControl } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { beginRateLimitWait, useRateLimitHint } from '@/api/rateLimitStatus';
import { cameraLabel, formatClock } from './episodeFormat';
import { canPlayVideoCodec, describeVideoCodec } from './videoCodec';

export type PlaybackSpeed = '0.5' | '1' | '2';

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
  /**
   * Ask whether a video that failed to load was rate limited: resolves to the
   * milliseconds to wait before loading it again, or null when the failure was
   * something else. With it, a throttled video waits and reloads by itself
   * instead of ending in "Couldn't load this video" (TASK-482).
   */
  probeThrottle?: (src: string) => Promise<number | null>;
  /** The primary camera started or stopped playing, whoever caused it. */
  onPlayingChange?: (playing: boolean) => void;
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

/** `MediaError.MEDIA_ERR_DECODE`: the bytes arrived and could not be decoded. */
const MEDIA_ERR_DECODE = 3;

/** How long a silent reload may take before the failure is shown after all. */
const RELOAD_GRACE_MS = 4000;

/** How often a throttled video reloads by itself before the failure is shown. */
const MAX_THROTTLE_RELOADS = 4;

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
      className="flex aspect-video w-full flex-col items-center justify-center gap-2 px-6 pt-8 text-center"
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
  probeThrottle?: (src: string) => Promise<number | null>;
  onPlayingChange?: (playing: boolean) => void;
  videoRefs: EpisodeViewerProps['videoRefs'];
  /** Playback events, wired on the primary camera only. */
  onTimeUpdate?: () => void;
  onLoadedMetadata?: () => void;
  onEnded?: () => void;
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
 *   reload with fresh URLs, then "Couldn't load this video" with Retry;
 * - the request was rate limited (429) → the cell waits as long as the server
 *   asked and loads the video again by itself, a few times over, saying so
 *   only once the wait has lasted more than a moment (TASK-482).
 */
function CameraCell(p: CameraCellProps) {
  const { camera, src, codec, onReload } = p;
  // Bumped by Retry, and part of the <video> key: a new element is the only
  // reliable way to make a browser request an unchanged URL again.
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ src: string; attempt: number; kind: 'codec' | 'load' } | null>(null);
  // The URL a silent reload is pending for.
  const [reloading, setReloading] = useState<string | null>(null);
  // The video (ticket aside) that has already had its one silent reload.
  const reloaded = useRef<string | null>(null);
  // A rate-limited load waiting to try again, and how long the server asked for.
  const [throttle, setThrottle] = useState<{ src: string; attempt: number; waitMs: number } | null>(null);
  // How many times the current video (ticket aside) has reloaded after a 429.
  const throttleReloads = useRef<{ video: string; count: number }>({ video: '', count: 0 });
  // What is on screen now, for an answer that arrives after the viewer moved on.
  const current = useRef({ src, attempt });
  current.current = { src, attempt };
  const hintVisible = useRateLimitHint();

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

  const throttled = throttle !== null && throttle.src === src && throttle.attempt === attempt;
  const throttleWaitMs = throttled ? throttle.waitMs : null;

  useEffect(() => {
    if (throttleWaitMs === null) return;
    // Counted as a rate-limit wait, so the shell's hint covers it too.
    const endWait = beginRateLimitWait();
    const timer = setTimeout(() => setAttempt((a) => a + 1), throttleWaitMs);
    return () => {
      clearTimeout(timer);
      endWait();
    };
  }, [throttleWaitMs, src, attempt]);

  /** A load failure that was not a rate limit: one silent reload, then say so. */
  const settleLoadError = () => {
    const video = withoutTicket(src);
    if (onReload && reloaded.current !== video) {
      reloaded.current = video;
      setReloading(src);
      onReload();
      return;
    }
    setFailure({ src, attempt, kind: 'load' });
  };

  const handleError = (e: SyntheticEvent<HTMLVideoElement>) => {
    if (e.currentTarget.error?.code === MEDIA_ERR_DECODE) {
      setFailure({ src, attempt, kind: 'codec' });
      return;
    }
    const probe = p.probeThrottle;
    if (!probe) {
      settleLoadError();
      return;
    }
    const asked = { src, attempt };
    void probe(src)
      .catch(() => null)
      .then((waitMs) => {
        // The viewer picked another episode meanwhile: not this video's answer.
        if (current.current.src !== asked.src || current.current.attempt !== asked.attempt) return;
        const video = withoutTicket(asked.src);
        if (throttleReloads.current.video !== video) throttleReloads.current = { video, count: 0 };
        if (waitMs !== null && throttleReloads.current.count < MAX_THROTTLE_RELOADS) {
          throttleReloads.current.count += 1;
          setThrottle({ ...asked, waitMs });
          return;
        }
        settleLoadError();
      });
  };

  const retry = () => {
    throttleReloads.current = { video: '', count: 0 };
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
  } else if (throttled) {
    // Quiet for the first moment; most waits end before anyone would read this.
    body = hintVisible ? (
      <PlayerNotice testId="video-throttled" title="Waiting for the server">
        Too many requests at once, so the server asked us to slow down. This video loads by itself in a moment.
      </PlayerNotice>
    ) : (
      <div className="aspect-video w-full" data-testid="video-pending" />
    );
  } else if (!p.ready) {
    body = <div className="aspect-video w-full" data-testid="video-pending" />;
  } else {
    body = (
      <video
        key={attempt}
        ref={(el) => { p.videoRefs.current[camera] = el; }}
        src={src}
        onTimeUpdate={p.onTimeUpdate}
        onLoadedMetadata={p.onLoadedMetadata}
        onEnded={p.onEnded}
        onPlay={p.onPlayingChange && (() => p.onPlayingChange?.(true))}
        onPause={p.onPlayingChange && (() => p.onPlayingChange?.(false))}
        onError={handleError}
        className="aspect-video w-full"
        playsInline
      />
    );
  }

  return (
    <div className="relative bg-canvas">
      <span className="absolute left-2 top-2 z-10 rounded-tag bg-canvas/80 px-1.5 py-0.5 text-xs font-medium text-ink-secondary">
        {cameraLabel(camera)}
      </span>
      {body}
    </div>
  );
}

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
          <CameraCell
            key={cam}
            camera={cam}
            src={p.srcFor(cam)}
            codec={p.codecFor?.(cam)}
            ready={p.ready ?? true}
            onReload={p.onReload}
            probeThrottle={p.probeThrottle}
            onPlayingChange={cam === p.primaryCamera ? p.onPlayingChange : undefined}
            videoRefs={p.videoRefs}
            onTimeUpdate={cam === p.primaryCamera ? p.onTimeUpdate : undefined}
            onLoadedMetadata={cam === p.primaryCamera ? p.onLoadedMetadata : undefined}
            onEnded={cam === p.primaryCamera ? p.onEnded : undefined}
          />
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
