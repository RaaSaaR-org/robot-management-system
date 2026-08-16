/**
 * @file PhotoPair.tsx
 * @description Baseline vs current control photo for one checkpoint, side by
 *              side (default) or as a swipe-reveal overlay. Photos are fetched
 *              through the API client (bearer token) and shown as object URLs;
 *              a missing photo says why it is missing.
 * @feature patrol
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { patrolApi } from '../api/patrolApi';
import { PATROL_MICRO } from './patrolUi';

export interface PhotoPairProps {
  robotId: string;
  checkpointName: string;
  /** Run whose photo is "current". */
  currentRunId: string;
  currentKey: string | null | undefined;
  /** Why the current photo is absent, when it is. */
  currentDropped?: 'person' | 'error' | null;
  /** Baseline run + key; null when no baseline exists for this checkpoint × window. */
  baselineRunId: string | null;
  /** Robot that walked the baseline run; defaults to `robotId` (bound routes). */
  baselineRobotId?: string | null;
  baselineKey: string | null | undefined;
  /** `side` (default) = two frames; `swipe` = current photo with the baseline revealed by a slider. */
  mode?: 'side' | 'swipe';
  className?: string;
}

type PhotoState = { status: 'idle' | 'loading' | 'ok' | 'error'; url: string | null };

function usePhoto(robotId: string, runId: string | null, key: string | null | undefined): PhotoState {
  const [state, setState] = useState<PhotoState>({ status: 'idle', url: null });
  useEffect(() => {
    if (!runId || !key) {
      setState({ status: 'idle', url: null });
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setState({ status: 'loading', url: null });
    void patrolApi
      .fetchPhotoUrl(robotId, runId, key)
      .then((u) => {
        url = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setState({ status: 'ok', url: u });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', url: null });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [robotId, runId, key]);
  return state;
}

const FRAME =
  'relative aspect-[4/3] w-full rounded-brand overflow-hidden ring-1 ring-[var(--glass-border)] flex items-center justify-center bg-glass-subtle';
const TAG = cn(
  'absolute top-1.5 left-1.5 z-10 glass-elevated rounded px-1.5 py-px pointer-events-none',
  PATROL_MICRO,
  'text-theme-primary',
);

interface FrameProps {
  label: string;
  state: PhotoState;
  missingText: string;
  alt: string;
}

function Frame({ label, state, missingText, alt }: FrameProps) {
  return (
    <figure className="min-w-0">
      <div className={cn(FRAME, state.status === 'loading' && 'animate-pulse')}>
        <figcaption className={TAG}>{label}</figcaption>
        {state.status === 'ok' && state.url ? (
          <img src={state.url} alt={alt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <p className="card-meta text-xs text-center px-3 pt-4">
            {state.status === 'loading' ? 'loading…' : state.status === 'error' ? 'photo unavailable' : missingText}
          </p>
        )}
      </div>
    </figure>
  );
}

interface SwipeFrameProps {
  baseline: PhotoState;
  current: PhotoState;
  checkpointName: string;
}

/** Current photo underneath, baseline clipped on top; a real range input drives the reveal. */
function SwipeFrame({ baseline, current, checkpointName }: SwipeFrameProps) {
  const [reveal, setReveal] = useState(50);
  return (
    <figure className="min-w-0 flex flex-col gap-1.5">
      <div className={FRAME}>
        <img src={current.url ?? undefined} alt={`Current photo at ${checkpointName}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        <img
          src={baseline.url ?? undefined}
          alt={`Baseline photo at ${checkpointName}`}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}
        />
        <span className="absolute inset-y-0 w-px bg-white/90 shadow-[0_0_6px_rgb(0_0_0/0.6)] pointer-events-none" style={{ left: `${reveal}%` }} aria-hidden="true" />
        <figcaption className={TAG}>Baseline</figcaption>
        <span className={cn(TAG, 'left-auto right-1.5')} aria-hidden="true">
          Current
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={reveal}
        aria-label="Reveal baseline"
        onChange={(e) => setReveal(Number(e.target.value))}
        className="w-full h-1.5 accent-cobalt-500 cursor-ew-resize"
      />
    </figure>
  );
}

export const PhotoPair = memo(function PhotoPair({
  robotId,
  checkpointName,
  currentRunId,
  currentKey,
  currentDropped,
  baselineRunId,
  baselineRobotId,
  baselineKey,
  mode = 'side',
  className,
}: PhotoPairProps) {
  const baseline = usePhoto(baselineRobotId ?? robotId, baselineRunId, baselineKey);
  const current = usePhoto(robotId, currentRunId, currentKey);
  const currentMissing =
    currentDropped === 'person'
      ? 'not stored — a person was in frame'
      : currentDropped === 'error'
        ? 'capture failed'
        : 'no photo';
  const canSwipe = mode === 'swipe' && baseline.status === 'ok' && current.status === 'ok' && Boolean(baseline.url) && Boolean(current.url);
  return (
    <div className={cn(canSwipe ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-2', 'min-w-0', className)} data-testid="patrol-photo-pair" data-checkpoint={checkpointName}>
      {canSwipe ? (
        <SwipeFrame baseline={baseline} current={current} checkpointName={checkpointName} />
      ) : (
        <>
          <Frame
            label="Baseline"
            state={baseline}
            missingText={baselineRunId ? 'no baseline photo for this checkpoint' : 'no baseline for this window yet'}
            alt={`Baseline photo at ${checkpointName}`}
          />
          <Frame label="Current" state={current} missingText={currentMissing} alt={`Current photo at ${checkpointName}`} />
        </>
      )}
    </div>
  );
});
