/**
 * @file useEpisodePlayback.ts
 * @description Playback state of the episode browser: what the viewer asked
 *              for (play, speed), kept true on every camera's `<video>` across
 *              episode switches, failed loads and the end of the video — and a
 *              timer clock for an episode no camera of which can play here.
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
  /**
   * This browser can play none of the cameras (every codec refused), so no
   * `<video>` is mounted. Play and Seek then run a `requestAnimationFrame`
   * clock over `fallbackDuration`, so the joint chart's cursor still moves
   * (TASK-506). Default false: the primary video is the clock.
   */
  videoless?: boolean;
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
  /** The primary element reported `play`. */
  onPlay: () => void;
  /** The primary element reported `pause`. */
  onPause: () => void;
  /** `onPlay` and `onPause` as the one callback the viewer takes. */
  onPlayingChange: (playing: boolean) => void;
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
 *
 * It is the only place the play state is kept: the element's own `play` and
 * `pause` events arrive here too (TASK-482), and nothing else resets it when
 * the episode changes. A video waiting out a rate limit is not a stop — it
 * reloads by itself and is started then, like any newly loaded episode.
 */
export function useEpisodePlayback(options: EpisodePlaybackOptions): EpisodePlayback {
  const { episodeKey, datasetKey, primaryCamera, windowFor, fallbackDuration, videoless = false } = options;
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
  // The time as the timer clock last left it, read by its frames between renders.
  const clockTime = useRef(0);
  useEffect(() => {
    clockTime.current = currentTime;
  }, [currentTime]);

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

  const onPlay = useCallback(() => {
    // The element started without the button (a media key, the browser).
    setPlaying(true);
  }, [setPlaying]);

  const onPause = useCallback(() => {
    // Fired when the element stops for real — not when a new `src` resets it.
    const primary = primaryCamera ? videoRefs.current[primaryCamera] : null;
    // HAVE_NOTHING with no error is an element between two episodes: not a stop.
    if (primary && primary.readyState === 0 && !primary.error) return;
    if (!primary || primary.paused) setPlaying(false);
  }, [primaryCamera, setPlaying]);

  const onPlayingChange = useCallback((next: boolean) => {
    if (next) onPlay();
    else onPause();
  }, [onPlay, onPause]);

  const onFailure = useCallback((camera: string) => {
    // The primary camera drives the clock; without it nothing is playing —
    // unless no camera could ever play, and the timer is the clock.
    if (camera !== primaryCamera || videoless) return;
    pauseAll();
    setPlaying(false);
  }, [primaryCamera, videoless, pauseAll, setPlaying]);

  // The timer clock: only without any video, so it and the video clock never
  // both move the time.
  useEffect(() => {
    if (!videoless || !isPlaying) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (mounted().length > 0) {
        last = null;
      } else {
        const elapsed = last === null ? 0 : Math.max(0, (now - last) / 1000);
        last = now;
        const next = Math.min(duration, clockTime.current + elapsed * rate.current);
        clockTime.current = next;
        setTime(next);
        if (next >= duration) {
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [videoless, isPlaying, duration, mounted, setTime, setPlaying]);

  const togglePlay = useCallback(() => {
    const videos = mounted();
    if (videoless && videos.length === 0) {
      if (playing.current) {
        setPlaying(false);
        return;
      }
      if (!(duration > 0)) return;
      // Play at the end starts the episode over, as a video does.
      if (clockTime.current >= duration) {
        clockTime.current = 0;
        setTime(0);
      }
      setPlaying(true);
      return;
    }
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
  }, [mounted, videoless, duration, pauseAll, setPlaying, primaryCamera, windowFor, setTime, applyRate, start]);

  const seek = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (!Number.isFinite(time)) return;
    clockTime.current = time;
    setTime(time);
    for (const [name, video] of mounted()) video.currentTime = (windowFor(name)?.from ?? 0) + time;
  }, [setTime, mounted, windowFor]);

  return {
    videoRefs, currentTime, duration, isPlaying, speed, setSpeed,
    togglePlay, seek, onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onPlayingChange, onFailure,
  };
}
