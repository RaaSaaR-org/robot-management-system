/**
 * @file PhotoPair.tsx
 * @description Baseline vs current control photo for one checkpoint, side by
 *              side. Photos are fetched through the API client (bearer token)
 *              and shown as object URLs; a missing photo says why it is missing.
 * @feature patrol
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { patrolApi } from '../api/patrolApi';

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

interface FrameProps {
  label: string;
  state: PhotoState;
  missingText: string;
  alt: string;
}

function Frame({ label, state, missingText, alt }: FrameProps) {
  return (
    <figure className="min-w-0 flex flex-col gap-1">
      <figcaption className="card-meta text-[11px] uppercase tracking-wide">{label}</figcaption>
      <div className="relative aspect-[4/3] w-full rounded-brand overflow-hidden glass-subtle flex items-center justify-center">
        {state.status === 'ok' && state.url ? (
          <img src={state.url} alt={alt} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <p className="card-meta text-xs text-center px-3">
            {state.status === 'loading' ? 'loading…' : state.status === 'error' ? 'photo unavailable' : missingText}
          </p>
        )}
      </div>
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
  return (
    <div className={cn('grid grid-cols-2 gap-2 min-w-0', className)} data-testid="patrol-photo-pair" data-checkpoint={checkpointName}>
      <Frame
        label="Baseline"
        state={baseline}
        missingText={baselineRunId ? 'no baseline photo for this checkpoint' : 'no baseline for this window yet'}
        alt={`Baseline photo at ${checkpointName}`}
      />
      <Frame label="Current" state={current} missingText={currentMissing} alt={`Current photo at ${checkpointName}`} />
    </div>
  );
});
