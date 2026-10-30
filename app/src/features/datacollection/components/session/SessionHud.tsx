/**
 * @file SessionHud.tsx
 * @description The recording HUD's pieces (TASK-410), which the Record
 *              console's take dock composes (TASK-428): the header (the phase
 *              pill ● REC / READY / PAUSED and "Take N"), the hero timer with
 *              the auto-stop track, and the readouts — a hairline grid of
 *              Session, Frames, Frame rate (measured over target) and Kept,
 *              then a Motion meter. The take timer is computed by the caller
 *              from the server's stamp, so every client shows the same time.
 *              Open-ended (TASK-406): no "of N". Keeps the hud-* test ids. The
 *              sound-cue mute (`hud-mute`) lives in the command bar (TASK-426):
 *              the header row lies under the E-STOP and holds no control.
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { QualityFeedback } from '../../types/datacollection.types';
import { takeNumber } from '../../utils/takeFormat';
import { streakLabel } from '../../utils/takeStreak';

/** `capturing` records a take; `between` is ready for the next one. */
export type HudPhase = 'capturing' | 'between' | 'paused' | 'idle';

/** 83.4 → "01:23". */
export function formatTakeTimer(seconds: number | null): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const PHASE_LABEL: Record<HudPhase, string> = {
  capturing: '● REC',
  between: 'READY',
  paused: 'PAUSED',
  idle: 'NOT STARTED',
};

const PHASE_STYLE: Record<HudPhase, string> = {
  capturing: 'text-signal-stopped bg-signal-stopped/10 border-signal-stopped/35',
  between: 'text-ink-secondary bg-inset border-line',
  // Paused is amber (statusTone warning), never violet.
  paused: 'text-signal-unknown bg-signal-unknown/10 border-signal-unknown/30',
  idle: 'text-ink-tertiary bg-inset border-line-subtle',
};

/** The number shown: the live take while capturing, else the NEXT one (what Start records). */
export function shownTakeNumber(phase: HudPhase, take: number | null): number {
  const shown = take === null ? 0 : phase === 'capturing' ? take : take + 1;
  return takeNumber(shown);
}

/** The dock's header row: the pill and "Take N". No control: it lies under the E-STOP. */
export function HudHeader({ phase, take }: { phase: HudPhase; take: number | null }) {
  return (
    <div className="flex min-h-[38px] items-center gap-3" data-phase={phase}>
      <span
        data-testid="hud-phase"
        className={cn(
          "inline-flex h-[30px] items-center whitespace-nowrap rounded-[8px] border px-[11px] font-display text-[14px] font-semibold leading-none tracking-[.08em] [font-variation-settings:'wdth'_112]",
          PHASE_STYLE[phase],
        )}
      >
        {PHASE_LABEL[phase]}
      </span>
      <span
        className="font-display text-[22px] font-semibold leading-none tracking-[-0.01em] text-ink-primary [font-variation-settings:'wdth'_104]"
        data-testid="hud-take"
      >
        Take <span data-testid="hud-episode">{shownTakeNumber(phase, take)}</span>
      </span>
    </div>
  );
}

const TIMER =
  "font-display text-[64px] font-semibold leading-[.95] tabular-nums tracking-[-0.03em] [font-variation-settings:'wdth'_116] max-[1439px]:text-[56px] max-sm:text-[44px]";

/** The hero timer; muted `00:00` between takes. */
export function HudTimer({ phase, takeElapsedS }: { phase: HudPhase; takeElapsedS: number | null }) {
  const live = phase === 'capturing';
  return (
    <div className={cn(TIMER, live ? 'text-ink-primary' : 'text-ink-muted')} data-testid="hud-take-timer" aria-label="Take time">
      {formatTakeTimer(live ? takeElapsedS : 0)}
    </div>
  );
}

/** The auto-stop track: a 3 px bar and "Auto-stop in N s", amber in the last 10 s. */
export function HudAutoStop({ inS, totalS }: { inS: number; totalS: number | null }) {
  const left = Math.max(0, Math.ceil(inS));
  const pct = totalS && totalS > 0 ? Math.min(100, Math.max(0, ((totalS - inS) / totalS) * 100)) : 0;
  const late = left <= 10;
  return (
    <div className="-mt-1 flex items-center gap-3 text-[12.5px] text-ink-tertiary">
      <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
        <span className={cn('block h-full rounded-full', late ? 'bg-signal-unknown' : 'bg-ink-secondary')} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn('tabular-nums', late && 'text-signal-unknown')} data-testid="hud-autostop">
        Auto-stop in {left} s
      </span>
    </div>
  );
}

export interface HudReadoutsProps {
  /** Session total time, already formatted */
  duration: string;
  frames: number;
  /** The target rate */
  fps: number;
  /** The measured rate, while recording */
  fpsActual?: number | null;
  kept: number;
  /** Takes kept in a row (TASK-414); shown from two. */
  streak?: number;
  /** The live smoothness score, while recording */
  motion?: QualityFeedback | null;
  /** Values in the live colour while recording */
  live?: boolean;
}

const DD = "mt-0.5 whitespace-nowrap font-display text-[19px] font-semibold leading-[1.15] tabular-nums [font-variation-settings:'wdth'_108] max-sm:text-[17px]";
const DT = 'whitespace-nowrap text-[11.5px] text-ink-tertiary';
const SMALL = 'ml-0.5 font-sans text-[11.5px] font-normal text-ink-tertiary';
const CELL = 'min-w-0 bg-panel px-2.5 pb-2.5 pt-[9px]';

/** A smoothness score is "Smooth" from 0.6, else "Jerky" (the quality panel's Good / Fair line). */
export function motionLabel(score: number): 'Smooth' | 'Jerky' {
  return score >= 0.6 ? 'Smooth' : 'Jerky';
}

/** The readouts: a hairline grid, four cells and the Motion row. */
export function HudReadouts({ duration, frames, fps, fpsActual, kept, streak = 0, motion = null, live = false }: HudReadoutsProps) {
  const streakText = streakLabel(streak);
  const measured = typeof fpsActual === 'number' && Number.isFinite(fpsActual) ? fpsActual : null;
  const slow = measured !== null && measured < fps * 0.9;
  const score = motion ? Math.round(Math.min(1, Math.max(0, motion.currentSmoothnessScore)) * 100) : null;
  const label = motion ? motionLabel(motion.currentSmoothnessScore) : null;
  const value = live ? 'text-ink-primary' : 'text-ink-secondary';
  return (
    <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-control border border-line-subtle bg-line-subtle max-sm:grid-cols-2">
      <div className={CELL}>
        <dt className={DT}>Session</dt>
        <dd className={cn(DD, value)} data-testid="hud-duration">{duration}</dd>
      </div>
      <div className={CELL}>
        <dt className={DT}>Frames</dt>
        <dd className={cn(DD, value)} data-testid="hud-frames">{frames.toLocaleString(UI_DATE_LOCALE)}</dd>
      </div>
      <div className={CELL} title={`target ${fps} fps`}>
        <dt className={DT}>Frame rate</dt>
        <dd className={cn(DD, slow ? 'text-signal-unknown' : 'text-ink-primary')}>
          <span data-testid="hud-fps">{measured !== null ? measured.toFixed(1) : fps}</span>
          <small className={SMALL}>{measured !== null ? `/ ${fps}` : 'fps'}</small>
        </dd>
      </div>
      <div className={CELL} title={streakText ?? undefined}>
        <dt className={DT}>Kept</dt>
        <dd className={cn(DD, 'text-ink-primary')}>
          <span data-testid="hud-kept">{kept}</span>
          <small className={SMALL}>{kept === 1 ? 'take' : 'takes'}</small>
        </dd>
        {streakText && (
          <span className="mt-0.5 block truncate text-[11px] text-signal-measured" data-testid="hud-streak">
            {streak} in a row
          </span>
        )}
      </div>
      <div className="col-span-full flex min-w-0 items-center gap-3 bg-panel px-2.5 py-2" data-testid="hud-motion">
        <dt className={cn(DT, 'flex-none')}>Motion</dt>
        <span
          className="h-1 flex-1 overflow-hidden rounded-full bg-line"
          role="meter"
          aria-label="Motion smoothness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score ?? 0}
        >
          <span
            className={cn('block h-full rounded-full', label === 'Jerky' ? 'bg-signal-unknown' : 'bg-signal-measured')}
            style={{ width: `${score ?? 0}%` }}
          />
        </span>
        <dd
          className={cn(
            'm-0 whitespace-nowrap text-[12.5px] font-medium',
            label === null ? 'text-ink-muted' : label === 'Jerky' ? 'text-signal-unknown' : 'text-signal-measured',
          )}
        >
          {label ?? 'Scored while you record'}
        </dd>
      </div>
    </dl>
  );
}
