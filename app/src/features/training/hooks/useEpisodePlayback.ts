/**
 * @file useEpisodePlayback.ts
 * @description Playback state of the episode browser: what the viewer asked
 *              for (play, speed), kept true on every camera's `<video>` across
 *              episode switches, failed loads and the end of the video.
 * @feature training
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from 'react';
import type { PlaybackSpeed } from '../components/datasets/EpisodeViewer';

/** The slice of a chunk video one episode occupies (v3.0), in seconds. */
interface TimeWindow {
  from: number;
  to: number;
}

export interface EpisodePlaybackOptions {
  /**
   * Identifies the episode on screen (dataset and index). Time and duration
   * belong to it: when it changes they read 0 and the fallback at once, never
   * the previous episode's numbers. Null while nothing is selected.
   */
  episodeKey: string | null;
  /** Changes when the dataset does; playback stops then. */
  datasetKey: string | undefined;
  primaryCamera: string | undefined;
  /** The episode's window inside a camera's chunk video; undefined for one file per episode. */
  windowFor: (camera: string) => TimeWindow | undefined;
  /** The episode's length from its metadata, until the video reports its own. */
  fallbackDuration: number;
}

export interface EpisodePlayback {
  videoRefs: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  /** Seconds into the episode. */
  currentTime: number;
  duration: number;
  /**
   * What the viewer asked for: true from Play until Pause, the end of the
   * episode, or a video that will not play. It survives an episode switch —
   * the next episode starts playing as soon as it has loaded.
   */
  isPlaying: boolean;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  togglePlay: () => void;
  seek: (e: ChangeEvent<HTMLInputElement>) => void;
  onTimeUpdate: () => void;
  onLoadedMetadata: (camera: string) => void;
  onEnded: () => void;
  onPause: () => void;
  onFailure: (camera: string) => void;
}

/**
 * One source of truth for the transport controls (TASK-484).
 *
 * A `<video>` that is given a new `src` goes back to paused at 1× without a
 * word, so "playing" and "2×" cannot live in the element. They live here, and
 * are put back on every video the moment it has loaded; anything that stops
 * playback for real (the end, a failed load, a refused `play()`) comes back
 * here as well, so the button and the element never disagree.
 */
export function useEpisodePlayback(options: EpisodePlaybackOptions): EpisodePlayback {
  const { episodeKey, datasetKey, primaryCamera, windowFor, fallbackDuration } = options;
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Time and the video's own duration are stored with the episode they were
  // measured on, and read back only for that episode.
  const [timeAt, setTimeAt] = useState<{ key: string | null; seconds: number }>({ key: null, seconds: 0 });
  const [measured, setMeasured] = useState<{ key: string | null; seconds: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>('1');
  // The same two values for event handlers, which must not wait for a render.
  const playing = useRef(false);
  const rate = useRef(1);

  const currentTime = timeAt.key === episodeKey ? timeAt.seconds : 0;
  const duration = measured && measured.key === episodeKey ? measured.seconds : fallbackDuration;

  const setPlaying = useCallback((next: boolean) => {
    playing.current = next;
    setIsPlaying(next);
  }, []);
  const setTime = useCallback((seconds: number) => setTimeAt({ key: episodeKey, seconds }), [episodeKey]);

  const mounted = useCallback(
    () => Object.entries(videoRefs.current).filter((entry): entry is [string, HTMLVideoElement] => Boolean(entry[1])),
    [],
  );

  const applyRate = useCallback((video: HTMLVideoElement) => {
    // Both: `playbackRate` is what plays now, `defaultPlaybackRate` is what a
    // reload of the same element falls back to.
    video.defaultPlaybackRate = rate.current;
    video.playbackRate = rate.current;
  }, []);

  const start = useCallback((video: HTMLVideoElement, isPrimary: boolean) => {
    let attempt: Promise<void> | undefined;
    try {
      attempt = video.play();
    } catch {
      if (isPrimary) setPlaying(false);
      return;
    }
    attempt?.catch((err: unknown) => {
      // AbortError: a new episode's load interrupted this play; that episode
      // starts itself once loaded. Anything else is a refusal — say so.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      if (isPrimary) setPlaying(false);
    });
  }, [setPlaying]);

  const pauseAll = useCallback(() => {
    for (const [, video] of mounted()) video.pause();
  }, [mounted]);

  // Another dataset is another session: nothing carries over.
  useEffect(() => {
    setPlaying(false);
  }, [datasetKey, setPlaying]);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    rate.current = Number(next);
    setSpeedState(next);
    // Applied on every click, the highlighted one included: the control is
    // never a claim the elements do not back.
    for (const [, video] of mounted()) applyRate(video);
  }, [mounted, applyRate]);

  const onLoadedMetadata = useCallback((camera: string) => {
    const video = videoRefs.current[camera];
    if (!video) return;
    applyRate(video);
    const isPrimary = camera === primaryCamera;
    if (isPrimary) {
      // Chunked (v3.0): the duration is the episode's window, not the chunk video's.
      const win = windowFor(camera);
      if (win) setMeasured({ key: episodeKey, seconds: win.to - win.from });
      else if (Number.isFinite(video.duration) && video.duration > 0) setMeasured({ key: episodeKey, seconds: video.duration });
    }
    if (playing.current) start(video, isPrimary);
  }, [applyRate, primaryCamera, windowFor, episodeKey, start]);

  const onTimeUpdate = useCallback(() => {
    if (!primaryCamera) return;
    const primary = videoRefs.current[primaryCamera];
    if (!primary) return;
    const win = windowFor(primaryCamera);
    const rel = Math.max(0, primary.currentTime - (win?.from ?? 0));
    // Clamp so a chunked episode never bleeds into the next one.
    if (win && primary.currentTime >= win.to - 0.05) {
      pauseAll();
      setPlaying(false);
      setTime(win.to - win.from);
      return;
    }
    setTime(rel);
    for (const [name, video] of mounted()) {
      if (name === primaryCamera) continue;
      const target = (windowFor(name)?.from ?? 0) + rel;
      if (Math.abs(video.currentTime - target) > 0.1) video.currentTime = target;
    }
  }, [primaryCamera, windowFor, pauseAll, setPlaying, setTime, mounted]);

  const onEnded = useCallback(() => {
    setPlaying(false);
    // The last time update can be a few frames short; the end is the end.
    const primary = primaryCamera ? videoRefs.current[primaryCamera] : null;
    if (primary && Number.isFinite(primary.duration) && !windowFor(primaryCamera!)) setTime(primary.duration);
  }, [primaryCamera, windowFor, setPlaying, setTime]);

  const onPause = useCallback(() => {
    // Fired when the element stops for real — not when a new `src` resets it.
    const primary = primaryCamera ? videoRefs.current[primaryCamera] : null;
    // HAVE_NOTHING with no error is an element between two episodes: not a stop.
    if (primary && primary.readyState === 0 && !primary.error) return;
    if (!primary || primary.paused) setPlaying(false);
  }, [primaryCamera, setPlaying]);

  const onFailure = useCallback((camera: string) => {
    // The primary camera drives the clock; without it nothing is playing.
    if (camera !== primaryCamera) return;
    pauseAll();
    setPlaying(false);
  }, [primaryCamera, pauseAll, setPlaying]);

  const togglePlay = useCallback(() => {
    const videos = mounted();
    if (videos.length === 0) return;
    if (playing.current) {
      pauseAll();
      setPlaying(false);
      return;
    }
    const primary = (primaryCamera && videoRefs.current[primaryCamera]) || videos[0]![1];
    const win = primaryCamera ? windowFor(primaryCamera) : undefined;
    // Play at the end of a chunked episode starts it over (a plain file does that by itself).
    if (win && primary.currentTime >= win.to - 0.1) {
      for (const [name, video] of videos) video.currentTime = windowFor(name)?.from ?? 0;
      setTime(0);
    }
    setPlaying(true);
    for (const [, video] of videos) {
      applyRate(video);
      start(video, video === primary);
    }
  }, [mounted, pauseAll, setPlaying, primaryCamera, windowFor, setTime, applyRate, start]);

  const seek = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time)) return;
    setTime(time);
    for (const [name, video] of mounted()) video.currentTime = (windowFor(name)?.from ?? 0) + time;
  }, [setTime, mounted, windowFor]);

  return {
    videoRefs, currentTime, duration, isPlaying, speed, setSpeed,
    togglePlay, seek, onTimeUpdate, onLoadedMetadata, onEnded, onPause, onFailure,
  };
}
