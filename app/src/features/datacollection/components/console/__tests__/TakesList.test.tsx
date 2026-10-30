/**
 * @file TakesList.test.tsx
 * @description The Record console's takes (TASK-428), the old EpisodePanel's
 *              rows: "Take N" 1-based with a discarded number left unused,
 *              newest first, dropped frames only when there are any, moved
 *              groups and warnings, who started the take, the live take as a
 *              ● REC box with its timer, and each row's trash button with its
 *              confirm (Discard, or Restart on the live take).
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { confirm } from '@/shared/components/ui';
import { TakesList, type TakesListProps } from '../TakesList';
import type { EpisodeSummary, LiveState } from '../../../types/datacollection.types';

vi.mock('@/shared/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/components/ui')>()),
  confirm: vi.fn(),
}));
vi.mock('../../../api/datacollectionApi', () => ({
  datacollectionApi: { fetchThumbnail: vi.fn().mockResolvedValue(null) },
}));
const confirmMock = vi.mocked(confirm);

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

function setup(over: Partial<TakesListProps> = {}) {
  const props: TakesListProps = {
    sessionId: 's1', episodes: [], live: live(), isRecording: true, canDiscard: true, onDiscardTake: vi.fn(), ...over,
  };
  return { ...render(<TakesList {...props} />), props };
}

beforeEach(() => confirmMock.mockReset());

describe('TakesList', () => {
  it('reports the drops only on the take that lost frames', () => {
    setup({ episodes: [episode({ episodeIndex: 0, droppedFrames: 143 }), episode({ episodeIndex: 1, droppedFrames: 0 })], live: live({ take: 1 }) });
    expect(screen.getByTestId('episode-dropped-0')).toHaveTextContent('143 dropped');
    expect(screen.queryByTestId('episode-dropped-1')).toBeNull();
    expect(screen.getByTestId('episode-row-1')).not.toHaveTextContent('dropped');
  });

  it('renders a session recorded before drops were counted', () => {
    setup({ episodes: [episode()], live: null, isRecording: false });
    expect(screen.getByTestId('episode-row-0')).toHaveTextContent('1,200 frames');
  });

  it('names every row "Take N", 1-based, newest first, and keeps a discarded number unused', () => {
    setup({
      episodes: [episode({ episodeIndex: 0 }), episode({ episodeIndex: 1, discarded: true }), episode({ episodeIndex: 2 })],
      live: live({ take: 2, kept: 2 }),
    });
    expect(screen.getByTestId('episode-row-0')).toHaveTextContent('Take 1');
    expect(screen.queryByTestId('episode-row-1')).toBeNull();
    expect(screen.getByTestId('episode-row-2')).toHaveTextContent('Take 3');
    const order = [...document.querySelectorAll('[data-testid^="episode-row-"]')].map((r) => r.getAttribute('data-testid'));
    expect(order).toEqual(['episode-row-2', 'episode-row-0']);
    expect(screen.getByTestId('episode-discard-2')).toHaveAccessibleName('Discard take 3');
    expect(document.body).not.toHaveTextContent(/Episode \d/);
  });

  it('shows moved body parts, warnings and who started the take', () => {
    setup({
      episodes: [episode({
        startedBy: { userId: null, displayName: null, source: 'vr', clientId: 'q' },
        quickCheck: { jointsMoved: [], groupsMoved: ['left_arm', 'right_hand'], warnings: ['short'] },
      })],
      live: live({ take: 0, kept: 1 }),
    });
    expect(screen.getByTestId('episode-chips-0')).toHaveTextContent('L arm');
    expect(screen.getByTestId('episode-chips-0')).toHaveTextContent('R hand');
    expect(screen.getByTestId('episode-chips-0')).toHaveTextContent('Short');
    expect(screen.getByTestId('episode-actor-0')).toHaveTextContent('headset');
  });

  it('shows the live take as ● REC with its timer, and Restart through a confirm', async () => {
    confirmMock.mockResolvedValue(true);
    const { props } = setup({ episodes: [episode({ episodeIndex: 0 }), episode({ episodeIndex: 1 })], live: live({ phase: 'capturing', take: 1, kept: 1 }), takeElapsedS: 12.3 });
    const row = screen.getByTestId('episode-row-1');
    expect(row).toHaveTextContent('● REC');
    expect(row).toHaveTextContent('Recording');
    expect(row).toHaveTextContent('00:12');
    expect(screen.getByTestId('episode-discard-1')).toHaveAccessibleName('Restart take 2');
    fireEvent.click(screen.getByTestId('episode-discard-1'));
    await waitFor(() => expect(props.onDiscardTake).toHaveBeenCalledWith(1));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restart take 2?', testId: 'episode-discard-confirm' }));
  });

  it('discards a finished take only through its confirm', async () => {
    confirmMock.mockResolvedValue(false);
    const { props } = setup({ episodes: [episode()], live: live({ take: 0, kept: 1 }) });
    fireEvent.click(screen.getByTestId('episode-discard-0'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard take 1?', tone: 'danger' })));
    expect(props.onDiscardTake).not.toHaveBeenCalled();
  });

  it('says how to start when there is no take yet', () => {
    setup();
    expect(screen.getByTestId('episode-empty')).toHaveTextContent('No takes yet. Space starts the first one.');
  });
});
