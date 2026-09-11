/**
 * @file TalkTrackMeter.tsx
 * @description The counter under a stop's talk track. It reports what the
 *              ROBOT will do with the text — how many parts it becomes and how
 *              long they take — using the chunking mirrored from `host.ts`, and
 *              says so when the tail falls past the per-stop speech cap.
 * @feature tour
 */

import { memo } from 'react';
import { cn } from '@/shared/utils/cn';
import { TOUR_TALK_TRACK_MAX } from '../types/tour.types';
import { TOUR_STOP_SPEECH_CAP_S, chunkTalkTrack, stopSpeechSeconds, talkTrackTruncated } from '../utils/tourFormat';

export const TalkTrackMeter = memo(function TalkTrackMeter({ talkTrack, stopNumber }: { talkTrack: string; stopNumber: number }) {
  const chunks = chunkTalkTrack(talkTrack);
  const seconds = stopSpeechSeconds(talkTrack);
  const truncated = talkTrackTruncated(talkTrack);
  const overLength = talkTrack.length > TOUR_TALK_TRACK_MAX;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" aria-live="polite" data-testid="tour-talktrack-meter">
      <span className={overLength ? 'text-signal-stopped' : 'text-ink-tertiary'} data-testid="tour-talktrack-chars">
        {talkTrack.length}/{TOUR_TALK_TRACK_MAX} chars
      </span>
      <span className="text-ink-secondary" data-testid="tour-talktrack-seconds">
        ≈ {seconds.toFixed(1)} s in {chunks.length} {chunks.length === 1 ? 'part' : 'parts'}
      </span>
      <span className="sr-only">{`Stop ${stopNumber} talk track: about ${seconds.toFixed(1)} seconds in ${chunks.length} parts.`}</span>
      {truncated && (
        <span className={cn('basis-full break-words text-signal-unknown')} data-testid="tour-talktrack-truncated">
          Past the {TOUR_STOP_SPEECH_CAP_S} s cap — the robot stops after {chunks.length} {chunks.length === 1 ? 'part' : 'parts'} and the rest is not said.
        </span>
      )}
    </div>
  );
});
