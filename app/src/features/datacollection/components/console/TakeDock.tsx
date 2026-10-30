/**
 * @file TakeDock.tsx
 * @description The Record console's take dock (TASK-428), under the E-STOP's
 *              column: the header (the phase pill and "Take N", no control —
 *              it lies right under the E-STOP), the hero (the take timer and
 *              the auto-stop track while capturing; the quick check between
 *              takes; a muted 00:00 otherwise), the slot, the one 52 px
 *              primary (Stop take / Start take, or Resume on a paused legacy
 *              recorder), Next take and Discard, and the readouts with the
 *              Motion meter. The slot shows one thing, by priority: recovery
 *              (the E-stop latched, or the robot not balancing) over a blocker
 *              (missed frames, a blocking readiness reason, jerky motion) over
 *              the quick check. The hotkeys, toasts and confirms are the old
 *              take panel's, through `useTakeHotkeys`. The root keeps
 *              `session-hud`.
 * @feature datacollection
 */

import type { ReactNode } from 'react';
import { Pause, Play, SkipForward, Square, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { TakeAction } from '../../types/datacollection.types';
import type { TakeControls } from '../../hooks/useTakeHotkeys';
import { takeLabel } from '../../utils/takeFormat';
import { HudAutoStop, HudHeader, HudReadouts, HudTimer, type HudPhase, type HudReadoutsProps } from '../session/SessionHud';

/**
 * A key hint inside a button. Drawn from `data-key` by a pseudo-element, so it
 * is no part of the button's text or accessible name ("Stop take", not
 * "Stop takeSpace").
 */
export function KeyHint({ k, onPrimary = false, className }: { k: string; onPrimary?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      data-key={k}
      className={cn(
        'rounded-[5px] border px-[5px] py-[3px] font-sans text-[11px] font-medium leading-none tracking-[.02em] after:content-[attr(data-key)]',
        onPrimary ? 'border-on-primary/30 text-on-primary/70' : 'border-line-strong text-ink-tertiary',
        className,
      )}
    />
  );
}

/** Which slot content shows: recovery over a blocker over the quick check. */
export type DockSlotKind = 'recovery' | 'blocker' | 'check' | null;

export function dockSlotKind({ recovery, blocker, quickCheck }: { recovery?: ReactNode; blocker?: ReactNode; quickCheck?: ReactNode }): DockSlotKind {
  if (recovery) return 'recovery';
  if (blocker) return 'blocker';
  if (quickCheck) return 'check';
  return null;
}

export interface TakeDockProps {
  phase: HudPhase;
  /** 0-based wire take: the live one while capturing, else the last one; null before the first */
  take: number | null;
  /** Seconds the live take has run (server clock) */
  takeElapsedS: number | null;
  /** Seconds until the robot stops the take on its own, and the whole auto-stop; null without one */
  autoStop?: { inS: number; totalS: number | null } | null;
  readouts: HudReadoutsProps;
  /** The take buttons' state and the Undo window, shared with the hotkeys */
  controls: TakeControls;
  pending?: TakeAction | null;
  onStartTake: () => unknown;
  onStopTake: () => unknown;
  onNextTake: () => unknown;
  /** Slot 1: the E-stop is latched, or the robot is not balancing */
  recovery?: ReactNode;
  /** Slot 2: missed frames, a blocking readiness reason, jerky motion */
  blocker?: ReactNode;
  /** The slot's colour: `fault` red, `warn` amber (default: recovery red, blocker amber) */
  slotTone?: 'fault' | 'warn';
  /** Slot 3, between takes: `QuickCheckCard variant="dock"` */
  quickCheck?: ReactNode;
  /** The take a Start now keeps (the quick check's), for "Starting take 4 keeps take 3." */
  keepsTake?: number | null;
  /** A recorder without explicit takes (SO-101 sidecar): Pause / Resume and Next episode */
  legacy?: {
    recording: boolean;
    paused: boolean;
    pending: 'start' | 'pause' | null;
    nextPending: boolean;
    onPause: () => unknown;
    onResume: () => unknown;
    onNextEpisode?: () => unknown;
  } | null;
  className?: string;
}

const SLOT_TONE: Record<'fault' | 'warn', string> = {
  fault: 'border-signal-stopped/40 bg-signal-stopped/[0.06]',
  warn: 'border-signal-unknown/35 bg-signal-unknown/[0.06]',
};

/** The 52 px primary's extra classes: Space pushed to the right edge. */
const PRIMARY = 'h-[52px] justify-start gap-2.5 px-[18px] text-base [&>span.truncate]:flex-1 [&>span.truncate]:text-left';

export function TakeDock({
  phase, take, takeElapsedS, autoStop = null, readouts, controls, pending = null,
  onStartTake, onStopTake, onNextTake, recovery, blocker, slotTone, quickCheck, keepsTake = null, legacy = null, className,
}: TakeDockProps) {
  const { takeMode, capturing, lastTake, canDiscardLast, undoTake, requestDiscardLast, cancelUndo } = controls;
  const kind = dockSlotKind({ recovery, blocker, quickCheck: phase === 'between' ? quickCheck : null });
  const takeButtons = takeMode && (phase === 'capturing' || phase === 'between');
  const checkShows = kind === 'check';

  const slot = (kind === 'recovery' || kind === 'blocker') && (
    <div
      className={cn('rounded-control border px-3.5 py-3 text-[13.5px]', SLOT_TONE[slotTone ?? (kind === 'recovery' ? 'fault' : 'warn')])}
      data-testid="take-dock-slot"
      data-kind={kind}
      data-tone={slotTone ?? (kind === 'recovery' ? 'fault' : 'warn')}
      role="status"
    >
      {kind === 'recovery' ? recovery : blocker}
    </div>
  );

  return (
    <section
      className={cn('flex flex-none flex-col gap-3.5 rounded-panel border border-line-subtle bg-panel p-4 pb-[18px] max-[1439px]:gap-3 max-sm:p-3.5', className)}
      data-testid="session-hud"
      data-slot={kind ?? undefined}
      aria-label="Take"
    >
      <HudHeader phase={phase} take={take} />

      {/* The hero: the timer, the quick check, or a muted 00:00. */}
      {checkShows ? quickCheck : (
        <>
          <HudTimer phase={phase} takeElapsedS={takeElapsedS} />
          {phase === 'capturing' && autoStop && <HudAutoStop inS={autoStop.inS} totalS={autoStop.totalS} />}
        </>
      )}

      {slot}

      {takeButtons && (
        <div className="flex flex-col gap-2" data-testid="take-controls">
          {capturing ? (
            <Button
              fullWidth
              className={PRIMARY}
              onClick={() => void onStopTake()}
              disabled={!!pending}
              isLoading={pending === 'stop'}
              data-testid="take-primary"
              data-action="stop"
              title="Stop this take (Space)"
              leftIcon={<Square className="h-[18px] w-[18px]" strokeWidth={1.75} />}
              rightIcon={<KeyHint k="Space" onPrimary />}
            >
              Stop take
            </Button>
          ) : (
            <Button
              fullWidth
              className={PRIMARY}
              onClick={() => void onStartTake()}
              disabled={!!pending}
              isLoading={pending === 'start'}
              data-testid="take-primary"
              data-action="start"
              title="Start a take (Space)"
              leftIcon={<Play className="h-[18px] w-[18px]" strokeWidth={1.75} />}
              rightIcon={<KeyHint k="Space" onPrimary />}
            >
              Start take
            </Button>
          )}
          {!capturing && checkShows && keepsTake !== null && (
            <p className="m-0 text-center text-[12.5px] text-ink-tertiary" data-testid="take-keeps-hint">
              Starting {takeLabel((lastTake ?? keepsTake) + 1).toLowerCase()} keeps {takeLabel(keepsTake).toLowerCase()}.
            </p>
          )}
          {/* While a quick check shows, it owns Discard. */}
          {!checkShows && (capturing || lastTake !== null) && (
            <div className="flex gap-2">
              {capturing && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => void onNextTake()}
                  disabled={!!pending}
                  isLoading={pending === 'next'}
                  data-testid="take-next"
                  title="Stop this take and start the next one (N)"
                  leftIcon={<SkipForward className="h-4 w-4" strokeWidth={1.75} />}
                  rightIcon={<KeyHint k="N" className="max-[1439px]:hidden" />}
                >
                  Next take
                </Button>
              )}
              {lastTake !== null && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => (undoTake !== null ? cancelUndo() : requestDiscardLast())}
                  disabled={(!canDiscardLast && undoTake === null) || pending === 'discard'}
                  isLoading={pending === 'discard'}
                  data-testid="take-discard-last"
                  title="Discard the last take (Backspace). You can undo for 5 s."
                  leftIcon={undoTake !== null ? <Undo2 className="h-4 w-4" strokeWidth={1.75} /> : <Trash2 className="h-4 w-4" strokeWidth={1.75} />}
                  rightIcon={undoTake !== null ? undefined : <KeyHint k="⌫" className="max-[1439px]:hidden" />}
                >
                  {undoTake !== null ? 'Undo discard' : 'Discard'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {legacy && (legacy.recording || legacy.paused) && (
        <div className="flex flex-col gap-2" data-testid="session-legacy-actions">
          {legacy.paused && (
            <Button
              fullWidth
              className={PRIMARY}
              isLoading={legacy.pending === 'start'}
              onClick={() => void legacy.onResume()}
              leftIcon={<Play className="h-[18px] w-[18px]" strokeWidth={1.75} />}
            >
              Resume
            </Button>
          )}
          <div className="flex gap-2">
            {legacy.recording && legacy.onNextEpisode && (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void legacy.onNextEpisode!()}
                isLoading={legacy.nextPending}
                data-testid="episode-next"
                title="Finish the current episode and start the next one"
                leftIcon={<SkipForward className="h-4 w-4" strokeWidth={1.75} />}
              >
                Next episode
              </Button>
            )}
            {legacy.recording && (
              <Button
                variant="secondary"
                className="flex-1"
                isLoading={legacy.pending === 'pause'}
                onClick={() => void legacy.onPause()}
                leftIcon={<Pause className="h-4 w-4" strokeWidth={1.75} />}
              >
                Pause
              </Button>
            )}
          </div>
        </div>
      )}

      <HudReadouts {...readouts} />
    </section>
  );
}
