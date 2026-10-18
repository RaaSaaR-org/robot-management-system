/**
 * @file SessionCompleted.test.tsx
 * @description The review table names takes the way the session page did
 *              while recording: "Take N", 1-based (TASK-410 D2). TASK-418:
 *              a session whose takes hold frames never reads FRAMES 0 — it
 *              refetches and shows "…" until the count is final.
 * @feature datacollection
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { FRAME_REFETCH_MS, FRAME_REFETCH_TRIES, SessionCompleted } from '../SessionCompleted';
import type { EpisodeSummary, TeleoperationSession } from '../../../types/datacollection.types';

const session = {
  id: 'sess-1', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'completed', startedAt: null, endedAt: null,
  frameCount: 900, duration: 60, fps: 30, languageInstr: 'Wave', qualityScore: null, exportedDatasetId: null,
  errorMessage: null, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

const ep = (episodeIndex: number, over: Partial<EpisodeSummary> = {}): EpisodeSummary => ({
  episodeIndex, frameCount: 300, startTime: 0, endTime: 10, durationS: 10, ...over,
});

describe('SessionCompleted', () => {
  it('lists the kept takes as "Take N", 1-based, with no discarded take and no 0', () => {
    renderWithProviders(
      <SessionCompleted
        session={session}
        robotName="G1"
        episodes={[ep(0), ep(1, { discarded: true }), ep(2)]}
        onEditTask={vi.fn()}
        onCreateDataset={vi.fn()}
      />,
    );
    const table = screen.getByTestId('review-episodes');
    expect(table).toHaveTextContent('Take 1');
    expect(table).not.toHaveTextContent('Take 2');
    expect(table).toHaveTextContent('Take 3');
    expect(table).not.toHaveTextContent(/Episode \d/);
    expect(screen.getByText('Takes kept').nextSibling ?? screen.getByText('Takes kept').parentElement).toHaveTextContent('2');
  });
});

describe('SessionCompleted frame count (TASK-418)', () => {
  afterEach(() => { vi.useRealTimers(); });

  const props = (over: Partial<TeleoperationSession>, episodes: EpisodeSummary[], onRefetch = vi.fn()) => ({
    session: { ...session, ...over } as TeleoperationSession,
    robotName: 'G1',
    episodes,
    onEditTask: vi.fn(),
    onCreateDataset: vi.fn(),
    onRefetch,
  });

  it('shows "…", not 0, and refetches while the kept takes hold frames', async () => {
    vi.useFakeTimers();
    const onRefetch = vi.fn();
    const p = props({ frameCount: 0 }, [ep(0), ep(1)], onRefetch);
    const { rerender } = renderWithProviders(<SessionCompleted {...p} />);
    expect(screen.getByTestId('session-frames')).toHaveTextContent('…');
    expect(screen.queryByText('Nothing to package')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(onRefetch).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(FRAME_REFETCH_MS); });
    expect(onRefetch).toHaveBeenCalledTimes(2);
    // The final count arrives: shown, and no more refetches.
    rerender(<SessionCompleted {...p} session={{ ...p.session, frameCount: 1523 }} />);
    expect(screen.getByTestId('session-frames')).toHaveTextContent(/1[,.]?523/);
    await act(async () => { vi.advanceTimersByTime(FRAME_REFETCH_MS * 3); });
    expect(onRefetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after its tries and shows the server\'s 0', async () => {
    vi.useFakeTimers();
    const onRefetch = vi.fn();
    renderWithProviders(<SessionCompleted {...props({ frameCount: 0 }, [ep(0)], onRefetch)} />);
    for (let i = 0; i <= FRAME_REFETCH_TRIES; i += 1) {
      await act(async () => { vi.advanceTimersByTime(FRAME_REFETCH_MS); });
    }
    expect(onRefetch).toHaveBeenCalledTimes(FRAME_REFETCH_TRIES);
    expect(screen.getByTestId('session-frames')).toHaveTextContent('0');
  });

  it('shows 0 at once for a session with no kept frames, and never refetches', () => {
    const onRefetch = vi.fn();
    renderWithProviders(<SessionCompleted {...props({ frameCount: 0 }, [ep(0, { discarded: true })], onRefetch)} />);
    expect(screen.getByTestId('session-frames')).toHaveTextContent('0');
    expect(screen.getByText('Nothing to package')).toBeInTheDocument();
    expect(onRefetch).not.toHaveBeenCalled();
  });
});
