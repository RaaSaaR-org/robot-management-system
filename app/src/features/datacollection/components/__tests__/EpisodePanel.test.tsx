/**
 * @file EpisodePanel.test.tsx
 * @description The take panel: dropped frames reported only when there are
 *              any; "Take N" numbering (1-based); one primary button that
 *              follows the phase; the Space / N / Backspace hotkeys, ignored
 *              while typing; and the Backspace discard that Undo cancels
 *              before anything is sent (TASK-410).
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EpisodePanel, DISCARD_UNDO_MS, type EpisodePanelProps } from '../EpisodePanel';
import { getToasts, dismissToast } from '@/shared/components/ui';
import type { EpisodeSummary, LiveState } from '../../types/datacollection.types';

vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: { fetchThumbnail: vi.fn().mockResolvedValue(null) },
}));

function episode(over: Partial<EpisodeSummary> = {}): EpisodeSummary {
  return { episodeIndex: 0, frameCount: 1200, startTime: 0, endTime: 40, durationS: 40, ...over };
}

function live(over: Partial<LiveState> = {}): LiveState {
  return {
    sessionId: 's1', status: 'recording', phase: 'between', take: null, takeStartedAt: null, takeElapsedS: null,
    takeFrames: 0, totalFrames: 0, kept: 0, discarded: 0, fpsTarget: 30, fpsActual: 30, degraded: false,
    lastDropReason: null, elapsedS: 3, autoStopS: null, lastTake: null, at: new Date().toISOString(), ...over,
  };
}

function renderPanel(over: Partial<EpisodePanelProps> = {}) {
  const props: EpisodePanelProps = {
    sessionId: 's1',
    episodes: [],
    live: live(),
    isRecording: true,
    canDiscard: true,
    onStartTake: vi.fn(),
    onStopTake: vi.fn(),
    onNextTake: vi.fn(),
    onDiscardLast: vi.fn(),
    onDiscardTake: vi.fn(),
    ...over,
  };
  return { ...render(<EpisodePanel {...props} />), props };
}

beforeEach(() => dismissToast());
afterEach(() => vi.useRealTimers());

describe('EpisodePanel dropped frames', () => {
  it('reports the drops on the take that lost frames', () => {
    renderPanel({ episodes: [episode({ droppedFrames: 143 })], live: live({ take: 0 }) });
    expect(screen.getByTestId('episode-dropped-0')).toHaveTextContent('143 dropped');
  });

  it('says nothing at all when the recorder kept up', () => {
    renderPanel({ episodes: [episode({ droppedFrames: 0 })], live: live({ take: 0 }) });
    expect(screen.queryByTestId('episode-dropped-0')).toBeNull();
    expect(screen.getByTestId('episode-row-0')).not.toHaveTextContent('dropped');
  });

  it('renders a session recorded before drops were counted', () => {
    renderPanel({ episodes: [episode()], live: null, isRecording: false });
    expect(screen.queryByTestId('episode-dropped-0')).toBeNull();
    expect(screen.getByTestId('episode-row-0')).toHaveTextContent('1,200 frames');
  });
});

describe('EpisodePanel numbering (TASK-410 D2)', () => {
  it('names every row "Take N", 1-based, and keeps a discarded number unused', () => {
    renderPanel({
      episodes: [episode({ episodeIndex: 0 }), episode({ episodeIndex: 1, discarded: true }), episode({ episodeIndex: 2 })],
      live: live({ take: 2, kept: 2 }),
    });
    expect(screen.getByTestId('episode-row-0')).toHaveTextContent('Take 1');
    expect(screen.queryByTestId('episode-row-1')).toBeNull();
    expect(screen.getByTestId('episode-row-2')).toHaveTextContent('Take 3');
    expect(screen.getByTestId('episode-discard-2')).toHaveAccessibleName('Discard take 3');
    expect(document.body).not.toHaveTextContent(/Episode \d/);
  });

  it('shows moved body parts, warnings and who started the take', () => {
    renderPanel({
      episodes: [episode({
        startedBy: { userId: null, displayName: null, source: 'vr', clientId: 'q' },
        quickCheck: { jointsMoved: [], groupsMoved: ['left_arm', 'right_hand'], warnings: ['short'] },
      })],
      live: live({ take: 0, kept: 1 }),
    });
    expect(screen.getByTestId('episode-chips-0')).toHaveTextContent('L arm');
    expect(screen.getByTestId('episode-chips-0')).toHaveTextContent('R hand');
    expect(screen.getByTestId('episode-chips-0')).toHaveTextContent('Short');
    expect(screen.getByTestId('episode-actor-0')).toHaveTextContent('by headset');
  });

  it('names the take being recorded and the kept count, with no target', () => {
    renderPanel({ episodes: [episode({ episodeIndex: 0 }), episode({ episodeIndex: 1 })], live: live({ phase: 'capturing', take: 1, kept: 1 }) });
    const line = screen.getByTestId('episode-progress');
    expect(line).toHaveTextContent('Recording Take 2 · kept 1');
    expect(line).not.toHaveTextContent(/\bof \d/);
  });
});

describe('EpisodePanel primary button (D1)', () => {
  it('is Start take between takes and Stop take while recording', () => {
    const { rerender, props } = renderPanel();
    expect(screen.getByTestId('take-primary')).toHaveTextContent('Start take');
    expect(screen.queryByTestId('take-next')).toBeNull();
    fireEvent.click(screen.getByTestId('take-primary'));
    expect(props.onStartTake).toHaveBeenCalledTimes(1);

    rerender(<EpisodePanel {...props} live={live({ phase: 'capturing', take: 0 })} />);
    expect(screen.getByTestId('take-primary')).toHaveTextContent('Stop take');
    expect(screen.getByTestId('take-next')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('take-primary'));
    expect(props.onStopTake).toHaveBeenCalledTimes(1);
  });

  it('keeps the old Next episode button for a recorder without explicit takes', () => {
    const onNextEpisode = vi.fn();
    renderPanel({ live: live({ phase: null }), onNextEpisode });
    expect(screen.queryByTestId('take-primary')).toBeNull();
    fireEvent.click(screen.getByTestId('episode-next'));
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
  });
});

describe('EpisodePanel hotkeys', () => {
  it('Space starts between takes and stops while recording; N moves to the next', () => {
    const { rerender, props } = renderPanel();
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStartTake).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'n' });
    expect(props.onNextTake).not.toHaveBeenCalled(); // nothing to move on from

    rerender(<EpisodePanel {...props} live={live({ phase: 'capturing', take: 0 })} />);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStopTake).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'N' });
    expect(props.onNextTake).toHaveBeenCalledTimes(1);
  });

  it("works beside the shell's closed navigation drawer, but not under an open dialog", () => {
    const { props } = renderPanel();
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
    const { props } = renderPanel({ live: live({ phase: 'capturing', take: 0 }) });
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

  it('ignores the hotkeys when the session is not recording, and while a take action is in flight', () => {
    const { rerender, props } = renderPanel({ isRecording: false });
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    rerender(<EpisodePanel {...props} isRecording pending="start" />);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(props.onStartTake).not.toHaveBeenCalled();
  });

  it('Backspace discards the last take after 5 s, sending the take it was asked for', () => {
    vi.useFakeTimers();
    const { props } = renderPanel({ episodes: [episode()], live: live({ take: 0, kept: 1 }) });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(getToasts()[0]?.title).toBe('Discarding take 1…');
    expect(getToasts()[0]?.action?.label).toBe('Undo');
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS - 1); });
    expect(props.onDiscardLast).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(props.onDiscardLast).toHaveBeenCalledWith(0);
  });

  it('Undo within 5 s cancels the discard before anything is sent', () => {
    vi.useFakeTimers();
    const { props } = renderPanel({ episodes: [episode()], live: live({ take: 0, kept: 1 }) });
    fireEvent.keyDown(window, { key: 'Backspace' });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { getToasts()[0]!.action!.onClick(); });
    act(() => { vi.advanceTimersByTime(DISCARD_UNDO_MS * 2); });
    expect(props.onDiscardLast).not.toHaveBeenCalled();
    expect(getToasts()).toHaveLength(0);
  });
});
