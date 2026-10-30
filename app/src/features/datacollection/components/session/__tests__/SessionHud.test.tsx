/**
 * @file SessionHud.test.tsx
 * @description The live HUD: the phase pill, "Take N" (1-based) with its
 *              timer, the auto-stop countdown and the DEGRADED chip; never a
 *              target count (TASK-406, TASK-410).
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionHud, formatTakeTimer, type SessionHudProps } from '../SessionHud';

const base: SessionHudProps = {
  phase: 'between', take: null, takeElapsedS: null, duration: '0:12', frames: 360, fps: 30, kept: 2,
};

describe('SessionHud', () => {
  it('reads READY and the next take, 1-based, before the first take', () => {
    render(<SessionHud {...base} />);
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('READY');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 1');
    expect(screen.getByTestId('hud-take-timer')).toHaveTextContent('00:00');
    expect(screen.getByTestId('hud-kept')).toHaveTextContent('2');
    expect(document.body).not.toHaveTextContent(/\bof \d/);
  });

  it('reads ● REC, the live take and its timer while capturing', () => {
    render(<SessionHud {...base} phase="capturing" take={4} takeElapsedS={83.7} autoStopInS={12.2} />);
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('● REC');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 5');
    expect(screen.getByTestId('hud-take-timer')).toHaveTextContent('01:23');
    expect(screen.getByTestId('hud-autostop')).toHaveTextContent('auto-stop in 13s');
  });

  it('shows the take after the last one between takes, so a discarded number is never reused', () => {
    render(<SessionHud {...base} take={4} />);
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 6');
  });

  it('shows DEGRADED, and no mute: that lives in the command bar (TASK-426)', () => {
    render(<SessionHud {...base} degraded />);
    expect(screen.getByTestId('hud-degraded')).toBeInTheDocument();
    expect(screen.queryByTestId('hud-mute')).toBeNull();
  });

  it('formats the timer as mm:ss', () => {
    expect(formatTakeTimer(0)).toBe('00:00');
    expect(formatTakeTimer(59.9)).toBe('00:59');
    expect(formatTakeTimer(600)).toBe('10:00');
    expect(formatTakeTimer(null)).toBe('00:00');
  });
});
