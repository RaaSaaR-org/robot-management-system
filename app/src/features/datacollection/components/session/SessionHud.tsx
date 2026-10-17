/**
 * @file SessionHud.tsx
 * @description Live recording HUD for a session: duration, frames, fps and
 *              current take as StatTiles (keeps the hud-* test ids). A
 *              session is open-ended (TASK-406), so the take tile reads
 *              "Take N" with how many takes are kept — never "of N".
 * @feature datacollection
 */

import { StatRow, StatTile, type Tone } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface SessionHudProps {
  duration: string;
  frames: number;
  fps: number;
  fpsActual?: number;
  /** 1-based take being recorded */
  episode: number;
  /** Takes kept so far (the listed episodes) */
  kept: number;
  tone?: Tone;
  hint?: string;
}

export function SessionHud({ duration, frames, fps, fpsActual, episode, kept, tone, hint }: SessionHudProps) {
  return (
    <StatRow columns={4}>
      <StatTile label="Duration" value={<span data-testid="hud-duration">{duration}</span>} tone={tone} hint={hint} />
      <StatTile label="Frames" value={<span data-testid="hud-frames">{frames.toLocaleString(UI_DATE_LOCALE)}</span>} tone={tone} />
      <StatTile
        label="Frame rate"
        value={<span data-testid="hud-fps">{fps}</span>}
        unit="fps"
        hint={typeof fpsActual === 'number' ? `${fpsActual.toFixed(1)} fps measured` : 'Target rate'}
      />
      <StatTile
        label="Take"
        value={<span data-testid="hud-episode">{episode}</span>}
        unit={<span data-testid="hud-kept">kept {kept}</span>}
        hint="Press N for the next one"
      />
    </StatRow>
  );
}
