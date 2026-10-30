/**
 * @file useTakeHotkeys.test.tsx
 * @description The take hotkeys and the Backspace discard's Undo window,
 *              moved unchanged out of the old EpisodePanel (TASK-410, TASK-428):
 *              Space starts and stops, N moves to the next take, Backspace
 *              discards after 5 s and Undo cancels before anything is sent;
 *              ignored while typing, under an open dialog, while a take action
 *              is in flight and when the session is not recording. Driven
 *              through the take dock, as the page wires it.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getToasts, dismissToast } from '@/shared/components/ui';
import { DISCARD_UNDO_MS, useTakeHotkeys, type UseTakeHotkeysOptions } from '../useTakeHotkeys';
import { TakeDock } from '../../components/console/TakeDock';
import type { LiveState } from '../../types/datacollection.types';

vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: { fetchThumbnail: vi.fn().mockResolvedValue(null) },
}));

function live(over: Partial<LiveState> = {}): LiveState {
  return {
    sessionId: 's1', status: 'recording', phase: 'between', take: null, takeStartedAt: null, takeElapsedS: null,
    takeFrames: 0, totalFrames: 0, kept: 0, discarded: 0, fpsTarget: 30, fpsActual: 30, degraded: false,
    lastDropReason: null, elapsedS: 3, autoStopS: null, lastTake: null, at: new Date().toISOString(), ...over,
  };
}

type Props = UseTakeHotkeysOptions;

/** The page's wiring: the hook, and the dock that shares its Undo state. */
function Harness(props: Props) {
  const controls = useTakeHotkeys(props);
  const capturing = props.live?.phase === 'capturing';
  return (
    <TakeDock
      phase={capturing ? 'capturing' : 'between'}
      take={props.live?.take ?? null}
      takeElapsedS={0}
      readouts={{ duration: '0:03', frames: 0, fps: 30, kept: props.live?.kept ?? 0 }}
      controls={controls}
      pending={props.pending}
      onStartTake={props.onStartTake}
      onStopTake={props.onStopTake}
      onNextTake={props.onNextTake}
    />
  );
}

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    live: live(),
    isRecording: true,
    onStartTake: vi.fn(),
    onStopTake: vi.fn(),
    onNextTake: vi.fn(),
    onDiscardLast: vi.fn(),
    onDiscardTake: vi.fn(),
    ...over,
  };
  return { ...render(<Harness {...props} />), props };
}

beforeEach(() => dismissToast());
afterEach(() => vi.useRealTimers());

describe('useTakeHotkeys', () => {
  it('Space starts between takes and stops while recording; N moves to the next', () => {
    const { rerender, props } = setup();
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStartTake).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'n' });
    expect(props.onNextTake).not.toHaveBeenCalled(); // nothing to move on from

    rerender(<Harness {...props} live={live({ phase: 'capturing', take: 0 })} />);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStopTake).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'N' });
    expect(props.onNextTake).toHaveBeenCalledTimes(1);
  });

  it("works beside the shell's closed navigation drawer, but not under an open dialog", () => {
    const { props } = setup();
    const drawer = document.createElement('aside');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    document.body.appendChild(drawer);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStartTake).toHaveBeenCalledTimes(1);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStartTake).toHaveBeenCalledTimes(1);
    drawer.remove();
    dialog.remove();
  });

  it('ignores every hotkey while typing', () => {
    const { props } = setup({ live: live({ phase: 'capturing', take: 0 }) });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { code: 'Space', key: ' ' });
    fireEvent.keyDown(input, { key: 'n' });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(props.onStopTake).not.toHaveBeenCalled();
    expect(props.onNextTake).not.toHaveBeenCalled();
    expect(getToasts()).toHaveLength(0);
    input.remove();
  });

  it('ignores the hotkeys when the session is not recording, while a take action is in flight, and when unbound', () => {
    const { rerender, props } = setup({ isRecording: false });
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    rerender(<Harness {...props} isRecording pending="start" />);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    rerender(<Harness {...props} isRecording hotkeys={false} />);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStartTake).not.toHaveBeenCalled();
  });

  it('Backspace discards the last finished take after 5 s, by its number', () => {
    vi.useFakeTimers();
    const { props } = setup({ live: live({ take: 0, kept: 1 }) });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(getToasts()[0]?.title).toBe('Discarding take 1…');
    expect(getToasts()[0]?.action?.label).toBe('Undo');
    // The dock's Discard turns into Undo while the window is open.
    expect(screen.getByTestId('take-discard-last')).toHaveTextContent('Undo discard');
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS - 1); });
    expect(props.onDiscardTake).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(props.onDiscardTake).toHaveBeenCalledWith(0);
    expect(props.onDiscardLast).not.toHaveBeenCalled();
  });

  it('still discards the named take by index when the headset starts the next one inside the Undo window (TASK-416)', () => {
    vi.useFakeTimers();
    const { props, rerender } = setup({ live: live({ take: 8, kept: 9 }) });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(getToasts()[0]?.title).toBe('Discarding take 9…');
    act(() => { vi.advanceTimersByTime(1500); });
    // Take 10 starts from the headset.
    rerender(<Harness {...props} live={live({ phase: 'capturing', take: 9, kept: 9 })} />);
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS); });
    expect(props.onDiscardTake).toHaveBeenCalledTimes(1);
    expect(props.onDiscardTake).toHaveBeenCalledWith(8);
    expect(props.onDiscardLast).not.toHaveBeenCalled();
  });

  it('ends and discards the named take when it is still recording when the window closes', () => {
    vi.useFakeTimers();
    const { props } = setup({ live: live({ phase: 'capturing', take: 2, kept: 2 }) });
    fireEvent.keyDown(window, { key: 'Backspace' });
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS); });
    expect(props.onDiscardLast).toHaveBeenCalledWith(2);
    expect(props.onDiscardTake).not.toHaveBeenCalled();
  });

  it('Undo within 5 s cancels the discard before anything is sent, from the toast or the dock', () => {
    vi.useFakeTimers();
    const { props } = setup({ live: live({ take: 0, kept: 1 }) });
    fireEvent.keyDown(window, { key: 'Backspace' });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { getToasts()[0]!.action!.onClick(); });
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS * 2); });
    expect(props.onDiscardLast).not.toHaveBeenCalled();
    expect(props.onDiscardTake).not.toHaveBeenCalled();
    expect(getToasts()).toHaveLength(0);

    // The dock's button opens the same window, and pressing it again is Undo.
    fireEvent.click(screen.getByTestId('take-discard-last'));
    expect(getToasts()[0]?.title).toBe('Discarding take 1…');
    fireEvent.click(screen.getByTestId('take-discard-last'));
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS * 2); });
    expect(props.onDiscardTake).not.toHaveBeenCalled();
    expect(getToasts()).toHaveLength(0);
  });
});
