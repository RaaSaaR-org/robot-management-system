/**
 * @file EpisodePanel.tsx
 * @description Episode controls during recording: "Next episode" button
 *              (shortcut N), episode list with per-episode discard (custom
 *              confirm dialog — not window.confirm, so UI tests can drive it),
 *              and progress toward the session's episode target.
 * @feature datacollection
 */

import { useState } from 'react';
import { SkipForward, Trash2, Film, Loader2 } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import type { EpisodeSummary } from '../types/datacollection.types';

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
  onNextEpisode: () => Promise<void> | void;
  onDiscardEpisode: (episodeIndex: number) => Promise<void> | void;
}

function formatSeconds(s: number): string {
  return `${s.toFixed(1)}s`;
}

export function EpisodePanel({
  episodes,
  currentEpisode,
  numEpisodes,
  isRecording,
  canDiscard,
  onNextEpisode,
  onDiscardEpisode,
}: EpisodePanelProps) {
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const handleNext = async () => {
    setBusy(true);
    try {
      await onNextEpisode();
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDiscard = async () => {
    if (confirmIndex === null) return;
    setBusy(true);
    try {
      await onDiscardEpisode(confirmIndex);
      setConfirmIndex(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="episode-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-turquoise-400" />
          <h3 className="text-sm font-medium text-theme-secondary">Episodes</h3>
        </div>
        {isRecording && (
          <button
            onClick={handleNext}
            disabled={busy}
            data-testid="episode-next"
            title="Finish the current episode and start the next one (shortcut: N)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-brand text-xs font-medium bg-turquoise-500/15 text-turquoise-400 hover:bg-turquoise-500/25 border border-turquoise-500/20 transition-all disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <SkipForward size={13} />}
            Next episode
            <kbd className="ml-1 px-1 rounded bg-black/20 font-mono text-[10px]">N</kbd>
          </button>
        )}
      </div>

      {/* Progress vs target */}
      <p className="text-xs text-theme-muted mb-3" data-testid="episode-progress">
        {isRecording ? (
          <>
            Recording episode{' '}
            <span className="text-theme-primary font-semibold">{currentEpisode + 1}</span>
            {numEpisodes ? <> of {numEpisodes}</> : null}
          </>
        ) : (
          <>
            {episodes.length} episode{episodes.length === 1 ? '' : 's'} recorded
            {numEpisodes ? <> (target: {numEpisodes})</> : null}
          </>
        )}
      </p>

      {/* Episode list */}
      {episodes.length === 0 ? (
        <p className="text-xs text-theme-tertiary" data-testid="episode-empty">
          No frames recorded yet — connect an input source and move the robot.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {episodes.map((ep) => (
            <li
              key={ep.episodeIndex}
              data-testid={`episode-row-${ep.episodeIndex}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-brand bg-glass-subtle text-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono font-semibold text-theme-primary shrink-0">
                  Ep {ep.episodeIndex}
                </span>
                {isRecording && ep.episodeIndex === currentEpisode && (
                  <span className="flex items-center gap-1 text-red-400 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    live
                  </span>
                )}
                <span className="text-theme-muted truncate">
                  {ep.frameCount.toLocaleString()} frames · {formatSeconds(ep.durationS)}
                </span>
              </div>
              {canDiscard && (
                <button
                  onClick={() => setConfirmIndex(ep.episodeIndex)}
                  data-testid={`episode-discard-${ep.episodeIndex}`}
                  aria-label={`Discard episode ${ep.episodeIndex}`}
                  className="p-1.5 rounded-brand text-theme-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Discard confirmation (custom dialog — window.confirm is untestable via Playwright MCP) */}
      {confirmIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Discard episode ${confirmIndex}`}
        >
          <Card className="max-w-sm w-full mx-4" data-testid="discard-dialog">
            <h3 className="text-base font-semibold text-theme-primary mb-2">
              Discard episode {confirmIndex}?
            </h3>
            <p className="text-sm text-theme-muted mb-4">
              All frames of this episode will be deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmIndex(null)}
                data-testid="discard-cancel"
                className="px-4 py-2 text-sm text-theme-secondary hover:text-theme-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDiscard}
                disabled={busy}
                data-testid="discard-confirm"
                className="px-4 py-2 rounded-brand text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 transition-all disabled:opacity-50"
              >
                {busy ? 'Discarding...' : 'Discard'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
