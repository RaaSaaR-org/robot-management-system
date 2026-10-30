/**
 * @file TakeDock.test.tsx
 * @description The Record console's take dock (TASK-428): one primary that
 *              follows the phase (Start take / Stop take, D1) with its Space
 *              hint outside the button's name; Next take and Discard while
 *              capturing; the slot's priority — recovery over a blocker over
 *              the quick check — with the quick check owning Discard and the
 *              "Starting take N keeps take N−1." hint; the legacy recorder's
 *              Resume / Pause / Next episode; and no control in the header row,
 *              which lies under the E-STOP.
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TakeDock, dockSlotKind, type TakeDockProps } from '../TakeDock';
import type { TakeControls } from '../../../hooks/useTakeHotkeys';

const controls = (over: Partial<TakeControls> = {}): TakeControls => ({
  takeMode: true, capturing: false, lastTake: null, canTake: true, canDiscardLast: false, undoTake: null,
  requestDiscardLast: vi.fn(), cancelUndo: vi.fn(), ...over,
});

function setup(over: Partial<TakeDockProps> = {}) {
  const props: TakeDockProps = {
    phase: 'between',
    take: null,
    takeElapsedS: null,
    readouts: { duration: '0:12', frames: 360, fps: 30, fpsActual: 29.8, kept: 2 },
    controls: controls(),
    onStartTake: vi.fn(),
    onStopTake: vi.fn(),
    onNextTake: vi.fn(),
    ...over,
  };
  return { ...render(<TakeDock {...props} />), props };
}

const primaries = () => [...document.querySelectorAll('button.bg-primary')].filter((b) => !(b as HTMLButtonElement).disabled);

describe('TakeDock primary (D1)', () => {
  it('is Start take between takes and Stop take while capturing, one lit button each', () => {
    const { props, rerender } = setup();
    const primary = screen.getByTestId('take-primary');
    expect(primary).toHaveAccessibleName('Start take');
    // The Space hint is drawn by CSS: not part of the text the e2e reads.
    expect(primary.textContent).toBe('Start take');
    expect(primaries()).toHaveLength(1);
    expect(screen.queryByTestId('take-next')).toBeNull();
    fireEvent.click(primary);
    expect(props.onStartTake).toHaveBeenCalledTimes(1);

    rerender(<TakeDock {...props} phase="capturing" take={0} takeElapsedS={12.4} controls={controls({ capturing: true, lastTake: 0, canDiscardLast: true })} />);
    expect(screen.getByTestId('take-primary').textContent).toBe('Stop take');
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('● REC');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 1');
    expect(screen.getByTestId('hud-take-timer')).toHaveTextContent('00:12');
    expect(primaries()).toHaveLength(1);
    fireEvent.click(screen.getByTestId('take-primary'));
    expect(props.onStopTake).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('take-next'));
    expect(props.onNextTake).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('take-discard-last')).toHaveTextContent('Discard');
  });

  it('holds no control in its header row: it lies right under the E-STOP', () => {
    setup({ phase: 'capturing', take: 2, controls: controls({ capturing: true, lastTake: 2 }) });
    const header = screen.getByTestId('hud-phase').parentElement!;
    expect(within(header).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('hud-mute')).toBeNull();
  });

  it('shows the auto-stop track while capturing', () => {
    setup({ phase: 'capturing', take: 0, takeElapsedS: 12, autoStop: { inS: 47.2, totalS: 60 }, controls: controls({ capturing: true, lastTake: 0 }) });
    expect(screen.getByTestId('hud-autostop')).toHaveTextContent('Auto-stop in 48 s');
  });
});

describe('TakeDock slot priority', () => {
  it('ranks recovery over a blocker over the quick check', () => {
    expect(dockSlotKind({ recovery: 'r', blocker: 'b', quickCheck: 'q' })).toBe('recovery');
    expect(dockSlotKind({ blocker: 'b', quickCheck: 'q' })).toBe('blocker');
    expect(dockSlotKind({ quickCheck: 'q' })).toBe('check');
    expect(dockSlotKind({})).toBeNull();
  });

  it('renders the recovery when all three are there, red, and keeps the take buttons', () => {
    setup({
      phase: 'between', take: 2,
      controls: controls({ lastTake: 2, canDiscardLast: true }),
      recovery: <p>E-stop is latched.</p>,
      blocker: <p>Frames are being missed.</p>,
      quickCheck: <div data-testid="quick-check">check</div>,
    });
    const slot = screen.getByTestId('take-dock-slot');
    expect(slot).toHaveAttribute('data-kind', 'recovery');
    expect(slot).toHaveAttribute('data-tone', 'fault');
    expect(slot).toHaveTextContent('E-stop is latched.');
    expect(screen.queryByText('Frames are being missed.')).toBeNull();
    expect(screen.queryByTestId('quick-check')).toBeNull();
    // The timer shows in the hero again, and the take buttons stay.
    expect(screen.getByTestId('hud-take-timer')).toHaveTextContent('00:00');
    expect(screen.getByTestId('take-primary')).toBeEnabled();
    expect(screen.getByTestId('take-discard-last')).toBeInTheDocument();
  });

  it('renders a blocker over the quick check, amber unless told otherwise', () => {
    setup({ blocker: <p>Frames are being missed.</p>, quickCheck: <div data-testid="quick-check" /> });
    expect(screen.getByTestId('take-dock-slot')).toHaveAttribute('data-kind', 'blocker');
    expect(screen.getByTestId('take-dock-slot')).toHaveAttribute('data-tone', 'warn');
    expect(screen.queryByTestId('quick-check')).toBeNull();
  });

  it('puts the quick check in the hero between takes: it owns Discard, and Start keeps it', () => {
    setup({
      take: 2,
      controls: controls({ lastTake: 2, canDiscardLast: true }),
      quickCheck: <div data-testid="quick-check" />,
      keepsTake: 2,
    });
    expect(screen.getByTestId('quick-check')).toBeInTheDocument();
    expect(screen.queryByTestId('hud-take-timer')).toBeNull();
    expect(screen.queryByTestId('take-dock-slot')).toBeNull();
    expect(screen.queryByTestId('take-discard-last')).toBeNull();
    expect(screen.getByTestId('take-keeps-hint')).toHaveTextContent('Starting take 4 keeps take 3.');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 4');
  });

  it('never shows the quick check while a take records', () => {
    setup({ phase: 'capturing', take: 3, controls: controls({ capturing: true, lastTake: 3 }), quickCheck: <div data-testid="quick-check" /> });
    expect(screen.queryByTestId('quick-check')).toBeNull();
    expect(screen.getByTestId('hud-take-timer')).toBeInTheDocument();
  });
});

describe('TakeDock legacy recorder', () => {
  it('keeps Pause and Next episode while recording, with no take buttons', () => {
    const onPause = vi.fn();
    const onNextEpisode = vi.fn();
    setup({
      phase: 'capturing',
      controls: controls({ takeMode: false }),
      legacy: { recording: true, paused: false, pending: null, nextPending: false, onPause, onResume: vi.fn(), onNextEpisode },
    });
    expect(screen.queryByTestId('take-primary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('episode-next'));
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
  });

  it('makes Resume the one primary while paused', () => {
    const onResume = vi.fn();
    setup({
      phase: 'paused',
      controls: controls({ takeMode: false }),
      legacy: { recording: false, paused: true, pending: null, nextPending: false, onPause: vi.fn(), onResume },
    });
    expect(screen.getByTestId('hud-phase')).toHaveTextContent('PAUSED');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(primaries()).toHaveLength(1);
  });
});

describe('TakeDock fits its column (TASK-428 review)', () => {
  it('lets only the slot give way: the slot scrolls inside, every other part keeps its height', () => {
    setup({ phase: 'capturing', take: 0, controls: controls({ capturing: true, lastTake: 0 }), recovery: <p>The robot is standing.</p> });
    const dock = screen.getByTestId('session-hud');
    expect(dock.className).toContain('lg:min-h-0');
    expect(dock.className).toContain('lg:*:flex-none');
    const slot = screen.getByTestId('take-dock-slot');
    expect(slot.className).toContain('overflow-y-auto');
    expect(slot.className).toContain('min-h-0');
    expect(slot.style.flexShrink).toBe('1');
  });

  it('on a short screen with a slot, the timer joins the header row; without one it stays the hero', () => {
    const { props, rerender } = setup({ phase: 'capturing', take: 0, takeElapsedS: 7, controls: controls({ capturing: true, lastTake: 0 }), blocker: <p>Frames are being missed.</p> });
    const hero = screen.getByTestId('take-dock-hero');
    expect(hero).toContainElement(screen.getByTestId('hud-take'));
    expect(hero).toContainElement(screen.getByTestId('hud-take-timer'));
    expect(hero.className).toContain('lg:[@media(max-height:899px)]:flex-row');
    expect(screen.getByTestId('hud-take-timer').className).toContain('lg:[@media(max-height:899px)]:text-[36px]');
    expect(screen.getByTestId('session-hud').className).toContain('lg:[@media(max-height:899px)]:gap-2');

    rerender(<TakeDock {...props} blocker={undefined} />);
    expect(screen.getByTestId('take-dock-hero').className).not.toContain('flex-row');
    expect(screen.getByTestId('hud-take-timer').className).not.toContain('text-[36px]');
    expect(screen.getByTestId('session-hud').className).not.toContain('gap-2');
  });
});
