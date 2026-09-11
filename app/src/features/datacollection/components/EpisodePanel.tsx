/**
 * @file EpisodePanel.tsx
 * @description Episode controls during recording: "Next episode" button
 *              (shortcut N), episode list with per-episode discard (through
 *              the kit's confirm dialog), and progress toward the session's
 *              episode target.
 * @feature datacollection
 */

import { useState } from 'react';
import { SkipForward, Trash2 } from 'lucide-react';
import { Button, Panel, StatusTag, confirm } from '@/shared/components/ui';
import type { EpisodeSummary } from '../types/datacollection.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface EpisodePanelProps {
  episodes: EpisodeSummary[];
  /** Episode currently being recorded (from live progress) */
  currentEpisode: number;
  /** Target episode count for the session (null = no target) */
  numEpisodes: number | null;
  /** True while the session is recording (controls Next/Discard availability) */
  isRecording: boolean;
  /** True while created/recording/paused — discard allowed */
  canDiscard: boolean;
  onNextEpisode: () => unknown | Promise<unknown>;
  onDiscardEpisode: (episodeIndex: number) => Promise<void> | void;
}

function formatSeconds(s: number): string {
  return `${s.toFixed(1)}s`;
}

export function EpisodePanel({
  episodes, currentEpisode, numEpisodes, isRecording, canDiscard, onNextEpisode, onDiscardEpisode,
}: EpisodePanelProps) {
  const [busy, setBusy] = useState(false);

  const handleNext = async () => {
    setBusy(true);
    try {
      await onNextEpisode();
    } finally {
      setBusy(false);
    }
  };

  const askDiscard = async (index: number) => {
    const ok = await confirm({
      title: `Discard episode ${index}?`,
      description: 'All frames of this episode are deleted. This cannot be undone.',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
    if (ok) await onDiscardEpisode(index);
  };

  return (
    <Panel data-testid="episode-panel">
      <Panel.Header
        title="Episodes"
        actions={isRecording && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleNext}
            isLoading={busy}
            data-testid="episode-next"
            title="Finish the current episode and start the next one (shortcut: N)"
            leftIcon={<SkipForward className="h-4 w-4" strokeWidth={1.75} />}
          >
            Next episode
          </Button>
        )}
      />
      <Panel.Body className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-tertiary" data-testid="episode-progress">
          {isRecording ? (
            <>
              Recording episode <span className="font-semibold text-ink-primary">{currentEpisode + 1}</span>
              {numEpisodes ? <> of {numEpisodes}</> : null}
              <span className="hidden sm:inline"> · press N for the next one</span>
            </>
          ) : (
            <>
              {episodes.length} episode{episodes.length === 1 ? '' : 's'} recorded
              {numEpisodes ? <> (target: {numEpisodes})</> : null}
            </>
          )}
        </p>

        {episodes.length === 0 ? (
          <p className="text-[13px] text-ink-tertiary" data-testid="episode-empty">
            No frames recorded yet. Connect an input source and move the robot.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-control border border-line-subtle">
            {episodes.map((ep) => (
              <li
                key={ep.episodeIndex}
                data-testid={`episode-row-${ep.episodeIndex}`}
                className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="shrink-0 font-medium text-ink-primary">Episode {ep.episodeIndex}</span>
                  {isRecording && ep.episodeIndex === currentEpisode && (
                    <StatusTag status="recording" dot pulse size="sm">Live</StatusTag>
                  )}
                  <span className="text-ink-tertiary">
                    {ep.frameCount.toLocaleString(UI_DATE_LOCALE)} frames · {formatSeconds(ep.durationS)}
                  </span>
                  {/* Only when there ARE drops: "0 dropped" on every healthy
                      episode teaches the operator to stop reading the line.
                      Amber (degraded), never the red of a destroyed take. */}
                  {typeof ep.droppedFrames === 'number' && ep.droppedFrames > 0 && (
                    <span className="shrink-0 text-signal-estimated" data-testid={`episode-dropped-${ep.episodeIndex}`}>
                      · {ep.droppedFrames.toLocaleString(UI_DATE_LOCALE)} dropped
                    </span>
                  )}
                </div>
                {canDiscard && (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    onClick={() => void askDiscard(ep.episodeIndex)}
                    data-testid={`episode-discard-${ep.episodeIndex}`}
                    aria-label={`Discard episode ${ep.episodeIndex}`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
}
