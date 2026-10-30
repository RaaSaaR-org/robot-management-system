/**
 * @file TakesList.tsx
 * @description The Record console's takes (TASK-428), the old EpisodePanel's
 *              list: a panel that fills the rest of the dock's column and
 *              scrolls inside, newest first. Each row is a 64×48 thumbnail (a
 *              ● REC box for the live take), "Take N" with its length and
 *              frames (or "Recording 00:12"), the moved groups and warnings,
 *              dropped frames, who started it, and its trash button — Discard
 *              on a finished take, "Restart take N?" on the live one, each
 *              through its confirm. Row ids are unchanged.
 * @feature datacollection
 */

import { Trash2 } from 'lucide-react';
import { Button, confirm } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { EpisodeSummary, LiveState } from '../../types/datacollection.types';
import { actorTag, groupLabel, takeLabel, warningLabel } from '../../utils/takeFormat';
import { TakeThumbnail } from '../session/TakeThumbnail';
import { formatTakeTimer } from '../session/SessionHud';

export interface TakesListProps {
  sessionId: string;
  episodes: EpisodeSummary[];
  /** The session's live state; `phase: null` means the recorder has no explicit takes */
  live: LiveState | null;
  /** True while the session is recording (takes can start and stop) */
  isRecording: boolean;
  /** True while created / recording / paused — a row may be discarded */
  canDiscard: boolean;
  /** Seconds the live take has run (server clock), for its row */
  takeElapsedS?: number | null;
  /** Discard one take by its number (or restart the live one). */
  onDiscardTake: (take: number) => unknown | Promise<unknown>;
  className?: string;
}

function formatSeconds(s: number): string {
  return `${s.toFixed(1)} s`;
}

/** "by Anna Keller" → "Anna"; "by headset" → "headset". */
function actorName(tag: string): string {
  return tag.replace(/^by /, '').split(' ')[0];
}

export function TakesList({ sessionId, episodes, live, isRecording, canDiscard, takeElapsedS = null, onDiscardTake, className }: TakesListProps) {
  const takeMode = !!live && live.phase !== null;
  const capturing = takeMode && live!.phase === 'capturing';
  const lastTake = live?.take ?? null;

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

  // Newest first.
  const rows = episodes.filter((e) => !e.discarded).sort((a, b) => b.episodeIndex - a.episodeIndex);

  return (
    <section
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-panel border border-line-subtle bg-panel', className)}
      data-testid="episode-panel"
      aria-label="Takes"
    >
      <header className="flex flex-none items-baseline justify-between gap-3 px-[18px] pb-2 pt-3.5">
        <h2 className="m-0 font-display text-base font-semibold leading-tight [font-variation-settings:'wdth'_106]">Takes</h2>
        {rows.length > 1 && <span className="text-[12.5px] text-ink-tertiary">Newest first</span>}
      </header>
      {rows.length === 0 ? (
        <p className="px-[18px] pb-4 text-[13px] text-ink-tertiary" data-testid="episode-empty">
          {isRecording && takeMode ? 'No takes yet. Space starts the first one.' : 'No frames recorded yet. Connect an input source and move the robot.'}
        </p>
      ) : (
        <ol className="m-0 min-h-0 list-none overflow-auto px-2 pb-2 max-lg:overflow-visible">
          {rows.map((ep) => {
            const isLiveRow = capturing && ep.episodeIndex === lastTake;
            const actor = actorTag(ep.startedBy);
            const qc = ep.quickCheck;
            const chips = qc && (qc.groupsMoved.length > 0 || qc.warnings.length > 0);
            return (
              <li
                key={ep.episodeIndex}
                data-testid={`episode-row-${ep.episodeIndex}`}
                className="group grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-control px-2.5 py-1.5 transition-colors duration-150 hover:bg-inset"
              >
                {isLiveRow ? (
                  <span
                    className="grid h-12 w-16 place-items-center rounded-[6px] border border-signal-stopped/55 bg-signal-stopped/[0.07] font-display text-[11px] font-semibold tracking-[.08em] text-signal-stopped"
                    aria-label="Recording"
                  >
                    ● REC
                  </span>
                ) : takeMode ? (
                  <TakeThumbnail sessionId={sessionId} take={ep.episodeIndex} className="h-12 w-16 rounded-[6px]" />
                ) : (
                  <span className="h-12 w-16 rounded-[6px] border border-line-subtle bg-inset" aria-hidden />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug text-ink-primary">{takeLabel(ep.episodeIndex)}</div>
                  <div className="mt-px flex min-w-0 items-center gap-x-2.5 overflow-hidden whitespace-nowrap text-[12.5px] tabular-nums text-ink-tertiary">
                    {isLiveRow ? (
                      <>
                        <span>Recording</span>
                        <span>{formatTakeTimer(takeElapsedS)}</span>
                      </>
                    ) : (
                      <>
                        <span>{formatSeconds(ep.durationS)}</span>
                        <span>{ep.frameCount.toLocaleString(UI_DATE_LOCALE)} frames</span>
                      </>
                    )}
                    {/* Only when there ARE drops: "0 dropped" on every healthy
                        take teaches the operator to stop reading the line.
                        Amber (degraded), never the red of a destroyed take. */}
                    {typeof ep.droppedFrames === 'number' && ep.droppedFrames > 0 && (
                      <span className="text-signal-unknown" data-testid={`episode-dropped-${ep.episodeIndex}`}>
                        {ep.droppedFrames.toLocaleString(UI_DATE_LOCALE)} dropped
                      </span>
                    )}
                    {chips && (
                      <span className="inline-flex min-w-0 gap-1" data-testid={`episode-chips-${ep.episodeIndex}`}>
                        {qc!.warnings.map((w) => (
                          <span
                            key={w}
                            className="rounded-tag border border-signal-unknown/30 bg-signal-unknown/10 px-1.5 py-px text-[10.5px] font-medium text-signal-unknown"
                          >
                            {warningLabel(w)}
                          </span>
                        ))}
                        {qc!.groupsMoved.map((g) => (
                          <span key={g} className="rounded-tag border border-line bg-inset px-1.5 py-px text-[10.5px] font-medium text-ink-secondary">
                            {groupLabel(g)}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {actor && (
                    <span className="max-w-[6rem] truncate text-xs text-ink-muted" data-testid={`episode-actor-${ep.episodeIndex}`} title={actor}>
                      {actorName(actor)}
                    </span>
                  )}
                  {canDiscard && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => void askDiscard(ep.episodeIndex)}
                      data-testid={`episode-discard-${ep.episodeIndex}`}
                      aria-label={isLiveRow ? `Restart ${takeLabel(ep.episodeIndex).toLowerCase()}` : `Discard ${takeLabel(ep.episodeIndex).toLowerCase()}`}
                      // Quiet until the row is pointed at or focused; always there on touch.
                      className="lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
