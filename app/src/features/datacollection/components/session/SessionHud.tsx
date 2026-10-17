/**
 * @file SessionHud.tsx
 * @description Live recording HUD (TASK-410): a big phase pill (● REC /
 *              READY / PAUSED), "Take N" with its own timer, the auto-stop
 *              countdown, a DEGRADED chip and the sound-cue mute, over a row
 *              of session totals (time, frames, frame rate, kept). The take
 *              timer is computed by the caller from the server's stamp, so
 *              every client shows the same time. Open-ended (TASK-406): no
 *              "of N". Keeps the hud-* test ids.
 * @feature datacollection
 */

import { Volume2, VolumeX } from 'lucide-react';
import { Button, StatRow, StatTile, type Tone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { takeNumber } from '../../utils/takeFormat';

/** `capturing` records a take; `between` is ready for the next one. */
export type HudPhase = 'capturing' | 'between' | 'paused' | 'idle';

export interface SessionHudProps {
  phase: HudPhase;
  /** 0-based wire take: the live one while capturing, else the last one; null before the first */
  take: number | null;
  /** Seconds the live take has run (server clock); null between takes */
  takeElapsedS: number | null;
  /** Session total time, already formatted */
  duration: string;
  frames: number;
  fps: number;
  fpsActual?: number | null;
  kept: number;
  degraded?: boolean;
  /** Seconds until the robot stops the take on its own; null when there is no auto-stop */
  autoStopInS?: number | null;
  muted?: boolean;
  onToggleMute?: () => void;
  tone?: Tone;
}

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
  capturing: 'text-signal-stopped bg-signal-stopped/10 border-signal-stopped/30',
  between: 'text-ink-secondary bg-inset border-line',
  paused: 'text-signal-estimated bg-signal-estimated/10 border-signal-estimated/30',
  idle: 'text-ink-tertiary bg-inset border-line-subtle',
};

export function SessionHud({
  phase, take, takeElapsedS, duration, frames, fps, fpsActual, kept, degraded, autoStopInS, muted, onToggleMute, tone,
}: SessionHudProps) {
  // Between takes the number shown is the NEXT take: that is what Start records.
  const shownTake = take === null ? 0 : phase === 'capturing' ? take : take + 1;
  return (
    <div className="flex flex-col gap-3" data-testid="session-hud">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line-subtle bg-panel px-4 py-3"
        data-phase={phase}
      >
        <span
          data-testid="hud-phase"
          className={cn(
            'inline-flex h-9 items-center rounded-control border px-3 font-display text-lg font-semibold tracking-[0.08em]',
            PHASE_STYLE[phase],
          )}
        >
          {PHASE_LABEL[phase]}
        </span>
        <span className="font-display text-2xl font-semibold text-ink-primary" data-testid="hud-take">
          Take <span data-testid="hud-episode">{takeNumber(shownTake)}</span>
        </span>
        <span
          className={cn('font-display text-2xl tabular-nums', phase === 'capturing' ? 'text-ink-primary' : 'text-ink-muted')}
          data-testid="hud-take-timer"
          aria-label="Take time"
        >
          {formatTakeTimer(phase === 'capturing' ? takeElapsedS : 0)}
        </span>
        {phase === 'capturing' && typeof autoStopInS === 'number' && (
          <span className="text-[13px] tabular-nums text-ink-secondary" data-testid="hud-autostop">
            auto-stop in {Math.max(0, Math.ceil(autoStopInS))}s
          </span>
        )}
        {degraded && (
          <span
            data-testid="hud-degraded"
            className="inline-flex h-6 items-center rounded-tag border border-signal-estimated/30 bg-signal-estimated/10 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-signal-estimated"
            title="The robot agent is unreachable; frames are being missed"
          >
            Degraded
          </span>
        )}
        {onToggleMute && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className="ml-auto"
            onClick={onToggleMute}
            data-testid="hud-mute"
            aria-pressed={!!muted}
            aria-label={muted ? 'Unmute sound cues' : 'Mute sound cues'}
            title={muted ? 'Sound cues are off' : 'Sound cues are on'}
          >
            {muted ? <VolumeX className="h-4 w-4" strokeWidth={1.75} /> : <Volume2 className="h-4 w-4" strokeWidth={1.75} />}
          </Button>
        )}
      </div>
      <StatRow columns={4}>
        <StatTile label="Session time" value={<span data-testid="hud-duration">{duration}</span>} tone={tone} />
        <StatTile label="Frames" value={<span data-testid="hud-frames">{frames.toLocaleString(UI_DATE_LOCALE)}</span>} tone={tone} />
        <StatTile
          label="Frame rate"
          value={<span data-testid="hud-fps">{fps}</span>}
          unit="fps"
          hint={typeof fpsActual === 'number' ? `${fpsActual.toFixed(1)} fps measured` : 'Target rate'}
        />
        <StatTile
          label="Kept"
          value={<span data-testid="hud-kept">{kept}</span>}
          unit={kept === 1 ? 'take' : 'takes'}
          hint="Space starts and stops a take"
        />
      </StatRow>
    </div>
  );
}
