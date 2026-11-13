/**
 * @file useEpisodeFrames.ts
 * @description The joint samples of the episode on screen: one request at a time, dropped the moment
 *              another episode is opened, and tried again by itself after a passing failure.
 * @feature training
 */

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/shared/components/ui';
import { trainingApi } from '../api/trainingApi';
import type { FrameData } from '../types';

/** The most frames asked for; a longer episode is charted from its first this many. */
export const FRAMES_PAGE = 2000;
/**
 * The most samples the chart is given. It is a few hundred pixels wide, and a
 * frame of a 31-joint robot is ~1.2 KB of JSON: the server thins the page to
 * this many evenly spaced frames, first and last included.
 */
export const CHART_POINTS = 400;
/**
 * Waits before each further try after a passing failure — a gateway timeout
 * (504), a pod that is restarting (502, 503) or a request that never arrived.
 * Three tries more, then the error is shown with its Retry button.
 */
export const FRAMES_RETRY_DELAYS_MS = [500, 1500, 3000];

const NO_FRAMES: FrameData[] = [];

/** A failure that says "not now" rather than "not this". */
function isPassing(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return status === 0 || status === 502 || status === 503 || status === 504;
}

interface Answer {
  key: string;
  frames: FrameData[];
  total: number | null;
  error: string | null;
}

export interface EpisodeFrames {
  /** The samples to chart — empty until this episode's own have arrived. */
  frames: FrameData[];
  /** The episode's real frame count as the server read it; null until it has answered. */
  total: number | null;
  /** True from the moment the episode is asked for until its answer (or final error) is in. */
  isLoading: boolean;
  error: string | null;
  /** Ask again, after an error. */
  retry: () => void;
}

/**
 * Load the frames of one episode (TASK-482, TASK-492).
 *
 * The answer is kept with the request it belongs to: until the two agree the
 * chart is loading, so a slow request never leaves the previous episode's
 * samples on screen as if they were this one's. When the episode changes, the
 * request in flight is aborted — the server stops decoding it — instead of
 * being left to finish behind the viewer's back; clicking through sixty
 * episodes used to leave sixty of them queued on the server, and the one the
 * viewer stopped on waited behind all of them.
 *
 * @param episode null to load nothing.
 */
export function useEpisodeFrames(datasetId: string | undefined, episode: number | null): EpisodeFrames {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const key = datasetId && episode !== null ? `${datasetId}:${episode}:${reloadKey}` : null;

  useEffect(() => {
    if (!datasetId || episode === null) return;
    const requestKey = `${datasetId}:${episode}:${reloadKey}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (tries: number): void => {
      trainingApi
        .getEpisodeFrames(datasetId, episode, 0, FRAMES_PAGE, { maxPoints: CHART_POINTS, signal: controller.signal })
        .then((r) => {
          if (controller.signal.aborted) return;
          setAnswer({ key: requestKey, frames: r.frames, total: r.total, error: null });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const delay = FRAMES_RETRY_DELAYS_MS[tries];
          if (isPassing(err) && delay !== undefined) {
            timer = setTimeout(() => attempt(tries + 1), delay);
            return;
          }
          // An empty chart here used to hide a read failure (TASK-354).
          setAnswer({ key: requestKey, frames: NO_FRAMES, total: null, error: errorMessage(err, 'unknown error') });
        });
    };
    attempt(0);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [datasetId, episode, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  const current = answer && answer.key === key ? answer : null;
  return {
    frames: current?.frames ?? NO_FRAMES,
    total: current?.total ?? null,
    isLoading: key !== null && !current,
    error: current?.error ?? null,
    retry,
  };
}
