/**
 * @file EpisodePanel.tsx
 * @description Take controls and the take list (TASK-410). One primary button
 *              that follows the phase — Start take between takes, Stop take
 *              while recording (D1) — with Next take and Discard last beside
 *              it. Hotkeys: Space start/stop, N next, Backspace discard last
 *              (a toast with Undo for 5 s; Undo cancels before anything is
 *              sent). Hotkeys are ignored while typing and while a dialog is
 *              open. Each row: thumbnail, "Take N" (1-based, D2), duration,
 *              frames, moved body parts, warnings and who started it.
 *              A recorder without explicit takes (live phase null) keeps the
 *              old Next episode button.
 * @feature datacollection
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, SkipForward, Square, Trash2, Undo2 } from 'lucide-react';
import { Button, Panel, StatusTag, confirm, dismissToast, toast } from '@/shared/components/ui';
import type { EpisodeSummary, LiveState, TakeAction } from '../types/datacollection.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { actorTag, groupLabel, takeLabel, warningLabel } from '../utils/takeFormat';
import { isDialogOpen, isTypingTarget } from '../utils/hotkeys';
import { TakeThumbnail } from './session/TakeThumbnail';

/** How long a Backspace discard waits for Undo before it is sent. */
export const DISCARD_UNDO_MS = 5000;

export interface EpisodePanelProps {
  sessionId: string;
  episodes: EpisodeSummary[];
  /** The session's live state; `phase: null` means the recorder has no explicit takes */
  live: LiveState | null;
  /** True while the session is recording (takes can start and stop) */
  isRecording: boolean;
  /** True while created/recording/paused — discard allowed */
  canDiscard: boolean;
  /** The take action in flight, if any */
  pending?: TakeAction | null;
  /** Space / N / Backspace are bound only when true (the page turns them off in dialogs, VR…) */
  hotkeys?: boolean;
  onStartTake: () => unknown | Promise<unknown>;
  onStopTake: () => unknown | Promise<unknown>;
  onNextTake: () => unknown | Promise<unknown>;
  /** Called after the Undo window, with the take that was last when the discard was asked for */
  onDiscardLast: (expectedTake: number) => unknown | Promise<unknown>;
  onDiscardTake: (take: number) => unknown | Promise<unknown>;
  /** Recorders without explicit takes (SO-101 sidecar): the old boundary */
  onNextEpisode?: () => unknown | Promise<unknown>;
}

function formatSeconds(s: number): string {
  return `${s.toFixed(1)}s`;
}

export function EpisodePanel({
  sessionId, episodes, live, isRecording, canDiscard, pending = null, hotkeys = true,
  onStartTake, onStopTake, onNextTake, onDiscardLast, onDiscardTake, onNextEpisode,
}: EpisodePanelProps) {
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [undoTake, setUndoTake] = useState<number | null>(null);
  const undoRef = useRef<{ timer: ReturnType<typeof setTimeout>; toastId: string; take: number } | null>(null);

  const takeMode = !!live && live.phase !== null;
  const capturing = takeMode && live!.phase === 'capturing';
  const lastTake = live?.take ?? null;
  const canTake = isRecording && takeMode && !pending;
  const canDiscardLast = isRecording && takeMode && lastTake !== null && !(live!.lastTake?.discarded && !capturing && live!.lastTake.take === lastTake);

  const cancelUndo = useCallback(() => {
    const pendingDiscard = undoRef.current;
    if (!pendingDiscard) return;
    clearTimeout(pendingDiscard.timer);
    dismissToast(pendingDiscard.toastId);
    undoRef.current = null;
    setUndoTake(null);
  }, []);

  /** Discard the last take after a 5 s Undo window; nothing is sent until it closes. */
  const requestDiscardLast = useCallback(() => {
    if (lastTake === null || undoRef.current) return;
    const take = lastTake;
    const toastId = toast(`Discarding ${takeLabel(take).toLowerCase()}…`, {
      description: 'Undo within 5 s to keep it.',
      duration: DISCARD_UNDO_MS,
      action: { label: 'Undo', onClick: () => cancelUndo() },
    });
    const timer = setTimeout(() => {
      undoRef.current = null;
      setUndoTake(null);
      void onDiscardLast(take);
    }, DISCARD_UNDO_MS);
    undoRef.current = { timer, toastId, take };
    setUndoTake(take);
  }, [lastTake, onDiscardLast, cancelUndo]);

  // Leaving the page cancels a discard that was not sent yet.
  useEffect(() => () => {
    if (undoRef.current) {
      clearTimeout(undoRef.current.timer);
      dismissToast(undoRef.current.toastId);
      undoRef.current = null;
    }
  }, []);

  // Space start/stop · N next · Backspace discard last.
  const keyState = useRef({ canTake, capturing, canDiscardLast, onStartTake, onStopTake, onNextTake, requestDiscardLast });
  keyState.current = { canTake, capturing, canDiscardLast, onStartTake, onStopTake, onNextTake, requestDiscardLast };
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      if (isDialogOpen()) return;
      const k = keyState.current;
      if (ev.code === 'Space') {
        if (!k.canTake) return;
        ev.preventDefault();
        void (k.capturing ? k.onStopTake() : k.onStartTake());
      } else if (ev.key === 'n' || ev.key === 'N') {
        if (!k.canTake || !k.capturing) return;
        ev.preventDefault();
        void k.onNextTake();
      } else if (ev.key === 'Backspace') {
        if (!k.canDiscardLast) return;
        ev.preventDefault();
        k.requestDiscardLast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys]);

  const legacyNext = async () => {
    if (!onNextEpisode) return;
    setLegacyBusy(true);
    try { await onNextEpisode(); } finally { setLegacyBusy(false); }
  };

  const askDiscard = async (take: number) => {
    const isLive = capturing && take === lastTake;
    const ok = await confirm({
      title: isLive ? `Restart ${takeLabel(take).toLowerCase()}?` : `Discard ${takeLabel(take).toLowerCase()}?`,
      description: isLive
        ? 'Its frames so far are dropped and the take keeps recording under the same number.'
        : 'The take is left out of the dataset. Its number is not reused.',
      confirmLabel: isLive ? 'Restart' : 'Discard',
      tone: 'danger',
      testId: 'episode-discard-confirm',
    });
    if (ok) await onDiscardTake(take);
  };

  const rows = episodes.filter((e) => !e.discarded);

  const takeControls = takeMode && isRecording && (
    <div className="flex flex-col gap-2" data-testid="take-controls">
      {capturing ? (
        <Button
          size="lg"
          fullWidth
          onClick={() => void onStopTake()}
          disabled={!!pending}
          isLoading={pending === 'stop'}
          data-testid="take-primary"
          data-action="stop"
          title="Stop this take (Space)"
          leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />}
        >
          Stop take
        </Button>
      ) : (
        <Button
          size="lg"
          fullWidth
          onClick={() => void onStartTake()}
          disabled={!!pending}
          isLoading={pending === 'start'}
          data-testid="take-primary"
          data-action="start"
          title="Start a take (Space)"
          leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
        >
          Start take
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        {capturing && (
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={() => void onNextTake()}
            disabled={!!pending}
            isLoading={pending === 'next'}
            data-testid="take-next"
            title="Stop this take and start the next one (N)"
            leftIcon={<SkipForward className="h-4 w-4" strokeWidth={1.75} />}
          >
            Next take
          </Button>
        )}
        {lastTake !== null && (
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={() => (undoTake !== null ? cancelUndo() : requestDiscardLast())}
            disabled={(!canDiscardLast && undoTake === null) || pending === 'discard'}
            isLoading={pending === 'discard'}
            data-testid="take-discard-last"
            title="Discard the last take (Backspace) — you can undo for 5 s"
            leftIcon={undoTake !== null ? <Undo2 className="h-4 w-4" strokeWidth={1.75} /> : <Trash2 className="h-4 w-4" strokeWidth={1.75} />}
          >
            {undoTake !== null ? 'Undo discard' : 'Discard last'}
          </Button>
        )}
      </div>
    </div>
  );

  const actions = !takeMode && (
    isRecording && onNextEpisode && (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void legacyNext()}
        isLoading={legacyBusy}
        data-testid="episode-next"
        title="Finish the current episode and start the next one"
        leftIcon={<SkipForward className="h-4 w-4" strokeWidth={1.75} />}
      >
        Next episode
      </Button>
    )
  );

  return (
    <Panel data-testid="episode-panel">
      <Panel.Header title="Takes" actions={actions} />
      <Panel.Body className="flex flex-col gap-3">
        {takeControls}
        <p className="text-[13px] text-ink-tertiary" data-testid="episode-progress">
          {isRecording && capturing && lastTake !== null ? (
            <>
              Recording <span className="font-semibold text-ink-primary">{takeLabel(lastTake)}</span>
              {' · '}kept {live!.kept}
            </>
          ) : isRecording && takeMode ? (
            <>
              Ready for <span className="font-semibold text-ink-primary">{takeLabel(lastTake === null ? 0 : lastTake + 1)}</span>
              {' · '}kept {live!.kept}
            </>
          ) : (
            <>Kept {live?.kept ?? rows.length} take{(live?.kept ?? rows.length) === 1 ? '' : 's'}</>
          )}
          {isRecording && takeMode && (
            <span className="hidden sm:inline"> · Space start/stop · N next · Backspace discard last</span>
          )}
        </p>

        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-tertiary" data-testid="episode-empty">
            {isRecording && takeMode ? 'No takes yet. Press Start take (or Space) when the operator is ready.' : 'No frames recorded yet. Connect an input source and move the robot.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-control border border-line-subtle">
            {rows.map((ep) => {
              const isLiveRow = capturing && ep.episodeIndex === lastTake;
              const actor = actorTag(ep.startedBy);
              const qc = ep.quickCheck;
              return (
                <li
                  key={ep.episodeIndex}
                  data-testid={`episode-row-${ep.episodeIndex}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]"
                >
                  {!isLiveRow && takeMode && (
                    <TakeThumbnail sessionId={sessionId} take={ep.episodeIndex} className="h-9 w-12" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="shrink-0 font-medium text-ink-primary">{takeLabel(ep.episodeIndex)}</span>
                      {isLiveRow && <StatusTag status="recording" dot pulse size="sm">Live</StatusTag>}
                      <span className="text-ink-tertiary">
                        {formatSeconds(ep.durationS)} · {ep.frameCount.toLocaleString(UI_DATE_LOCALE)} frames
                      </span>
                      {/* Only when there ARE drops: "0 dropped" on every healthy
                          episode teaches the operator to stop reading the line.
                          Amber (degraded), never the red of a destroyed take. */}
                      {typeof ep.droppedFrames === 'number' && ep.droppedFrames > 0 && (
                        <span className="shrink-0 text-signal-estimated" data-testid={`episode-dropped-${ep.episodeIndex}`}>
                          · {ep.droppedFrames.toLocaleString(UI_DATE_LOCALE)} dropped
                        </span>
                      )}
                      {actor && <span className="text-ink-muted" data-testid={`episode-actor-${ep.episodeIndex}`}>{actor}</span>}
                    </div>
                    {qc && (qc.groupsMoved.length > 0 || qc.warnings.length > 0) && (
                      <div className="flex flex-wrap gap-1" data-testid={`episode-chips-${ep.episodeIndex}`}>
                        {qc.groupsMoved.map((g) => (
                          <span key={g} className="rounded-tag border border-line bg-inset px-1.5 py-px text-[10px] font-medium text-ink-secondary">
                            {groupLabel(g)}
                          </span>
                        ))}
                        {qc.warnings.map((w) => (
                          <span
                            key={w}
                            className="rounded-tag border border-signal-estimated/30 bg-signal-estimated/10 px-1.5 py-px text-[10px] font-medium text-signal-estimated"
                          >
                            {warningLabel(w)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {canDiscard && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => void askDiscard(ep.episodeIndex)}
                      data-testid={`episode-discard-${ep.episodeIndex}`}
                      aria-label={isLiveRow ? `Restart ${takeLabel(ep.episodeIndex).toLowerCase()}` : `Discard ${takeLabel(ep.episodeIndex).toLowerCase()}`}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
}
