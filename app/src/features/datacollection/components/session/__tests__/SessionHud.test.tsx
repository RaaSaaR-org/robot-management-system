/**
 * @file SessionHud.test.tsx
 * @description The HUD pieces the take dock composes (TASK-410, TASK-428):
 *              the phase pill and "Take N" (1-based), the take timer, the
 *              auto-stop track, and the readouts — frame rate measured over
 *              target (amber below 90 %), the kept count with its streak, and
 *              the Motion meter; never a target count (TASK-406).
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudAutoStop, HudHeader, HudReadouts, HudTimer, formatTakeTimer, motionLabel } from '../SessionHud';

describe('HudHeader and HudTimer', () => {
  it('reads READY and the next take, 1-based, before the first take', () => {
    render(<><HudHeader phase="between" take={null} /><HudTimer phase="between" takeElapsedS={null} /></>);
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('READY');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 1');
    expect(screen.getByTestId('hud-take-timer')).toHaveTextContent('00:00');
    expect(screen.getByTestId('hud-take-timer').className).toContain('text-ink-muted');
    expect(document.body).not.toHaveTextContent(/\bof \d/);
  });

  it('reads ● REC, the live take and its timer while capturing', () => {
    render(<><HudHeader phase="capturing" take={4} /><HudTimer phase="capturing" takeElapsedS={83.7} /><HudAutoStop inS={12.2} totalS={60} /></>);
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('● REC');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 5');
    expect(screen.getByTestId('hud-take-timer')).toHaveTextContent('01:23');
    expect(screen.getByTestId('hud-autostop')).toHaveTextContent('Auto-stop in 13 s');
  });

  it('shows the take after the last one between takes, so a discarded number is never reused', () => {
    render(<HudHeader phase="between" take={4} />);
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 6');
  });

  it('turns the auto-stop amber in the last 10 s', () => {
    render(<HudAutoStop inS={9.2} totalS={60} />);
    expect(screen.getByTestId('hud-autostop').className).toContain('text-signal-unknown');
  });

  it('draws PAUSED amber, never violet', () => {
    render(<HudHeader phase="paused" take={1} />);
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('PAUSED');
    expect(screen.getByTestId('hud-phase').className).toContain('text-signal-unknown');
  });

  it('formats the timer as mm:ss', () => {
    expect(formatTakeTimer(0)).toBe('00:00');
    expect(formatTakeTimer(59.9)).toBe('00:59');
    expect(formatTakeTimer(600)).toBe('10:00');
    expect(formatTakeTimer(null)).toBe('00:00');
  });
});

describe('HudReadouts', () => {
  it('shows the session time, frames, the measured rate over its target and the kept count, once', () => {
    render(<HudReadouts duration="4:31" frames={1740} fps={30} fpsActual={29.8} kept={2} live />);
    expect(screen.getByTestId('hud-duration')).toHaveTextContent('4:31');
    expect(screen.getByTestId('hud-frames')).toHaveTextContent('1,740');
    expect(screen.getByTestId('hud-fps')).toHaveTextContent('29.8');
    expect(screen.getByTestId('hud-fps').parentElement).toHaveTextContent('29.8/ 30');
    expect(screen.getAllByTestId('hud-kept')).toHaveLength(1);
    expect(screen.getByTestId('hud-kept')).toHaveTextContent('2');
    expect(screen.queryByTestId('hud-streak')).toBeNull();
    expect(screen.getByTestId('hud-motion')).toHaveTextContent('Scored while you record');
  });

  it('turns the frame rate amber below 90 % of its target', () => {
    render(<HudReadouts duration="0:10" frames={10} fps={30} fpsActual={25} kept={0} />);
    expect(screen.getByTestId('hud-fps').parentElement!.className).toContain('text-signal-unknown');
  });

  it('carries the streak from two kept in a row, and the Motion meter', () => {
    render(<HudReadouts duration="0:10" frames={10} fps={30} kept={5} streak={5} motion={{ currentSmoothnessScore: 0.86 } as never} />);
    expect(screen.getByTestId('hud-streak')).toHaveTextContent('5 in a row');
    expect(screen.getByTestId('hud-motion')).toHaveTextContent('Smooth');
    expect(screen.getByRole('meter', { name: 'Motion smoothness' })).toHaveAttribute('aria-valuenow', '86');
  });

  it('calls motion below 0.6 jerky', () => {
    expect(motionLabel(0.6)).toBe('Smooth');
    expect(motionLabel(0.59)).toBe('Jerky');
  });
});
