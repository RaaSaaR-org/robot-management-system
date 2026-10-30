/**
 * @file SessionCompleted.test.tsx
 * @description Wrap up (TASK-429): one summary band with exactly one dataset
 *              action, in the epic's order — exported → Open dataset, 0 frames
 *              → New session, otherwise Create dataset — the failed variant
 *              with its reason, and the Details "Dataset" row without a second
 *              button. The review table names takes the way the session page
 *              did while recording: "Take N", 1-based (TASK-410 D2). TASK-418:
 *              a session whose takes hold frames never reads FRAMES 0 — it
 *              refetches and shows "…" until the count is final.
 * @feature datacollection
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { FRAME_REFETCH_MS, FRAME_REFETCH_TRIES, SessionCompleted, wrapAction } from '../SessionCompleted';
import type { EpisodeSummary, TeleoperationSession } from '../../../types/datacollection.types';

// The thumbnails are fetched through the API client; these tests are about the band, not the frames.
vi.mock('../../../utils/takeThumbnailCache', () => ({ loadThumbnail: vi.fn(async () => null), forgetThumbnail: vi.fn() }));

const session = {
  id: 'sess-1', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'completed', startedAt: null, endedAt: null,
  frameCount: 900, duration: 60, fps: 30, languageInstr: 'Wave', qualityScore: null, exportedDatasetId: null,
  errorMessage: null, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

const ep = (episodeIndex: number, over: Partial<EpisodeSummary> = {}): EpisodeSummary => ({
  episodeIndex, frameCount: 300, startTime: 0, endTime: 10, durationS: 10, ...over,
});

const render = (over: Partial<TeleoperationSession> = {}, episodes: EpisodeSummary[] = [ep(0), ep(1)], handlers = {}) => {
  const props = {
    session: { ...session, ...over } as TeleoperationSession,
    robotName: 'G1',
    episodes,
    onEditTask: vi.fn(),
    onCreateDataset: vi.fn(),
    ...handlers,
  };
  renderWithProviders(<SessionCompleted {...props} />);
  return props;
};

/** Every control that opens, creates or starts something from a dataset point of view. */
const datasetControls = () =>
  screen.queryAllByRole('button', { name: /dataset/i }).length + screen.queryAllByRole('link', { name: /dataset|new session/i }).length;

describe('SessionCompleted', () => {
  it('lists the kept takes as "Take N", 1-based, with no discarded take and no 0', () => {
    render({}, [ep(0), ep(1, { discarded: true }), ep(2)]);
    const table = screen.getByTestId('review-episodes');
    expect(table).toHaveTextContent('Take 1');
    expect(table).not.toHaveTextContent('Take 2');
    expect(table).toHaveTextContent('Take 3');
    expect(table).not.toHaveTextContent(/Episode \d/);
    expect(screen.getByTestId('session-kept')).toHaveTextContent('2');
    expect(screen.getByTestId('session-summary')).toHaveTextContent('2 takes kept, 1 discarded.');
  });

  it('shows how each take was driven (episode-input-N)', () => {
    render({}, [ep(0, { retargetModes: ['ik'] }), ep(1)]);
    expect(screen.getByTestId('episode-input-0')).toBeInTheDocument();
    expect(screen.getByTestId('episode-input-1')).toBeInTheDocument();
  });
});

describe('SessionCompleted — the one dataset action (TASK-429)', () => {
  it('orders the action: exported → Open dataset, 0 frames → New session, else Create dataset', () => {
    expect(wrapAction({ exportedDatasetId: 'ds-1', frameCount: 0 }, false)).toBe('open-dataset');
    expect(wrapAction({ exportedDatasetId: null, frameCount: 0 }, false)).toBe('new-session');
    expect(wrapAction({ exportedDatasetId: null, frameCount: 0 }, true)).toBe('create-dataset');
    expect(wrapAction({ exportedDatasetId: null, frameCount: 12 }, false)).toBe('create-dataset');
  });

  it('a failed session with frames offers New session, never Create dataset (the server packages only completed ones)', () => {
    expect(wrapAction({ exportedDatasetId: null, frameCount: 12, status: 'failed' }, false)).toBe('new-session');
    render({ status: 'failed', frameCount: 12 });
    expect(screen.queryByTestId('create-dataset')).toBeNull();
    expect(screen.getByTestId('wrap-new-session')).toBeInTheDocument();
    expect(screen.getByTestId('session-summary')).toHaveTextContent('A failed session cannot be packaged');
  });

  it('an exported session opens its dataset, and the Details row names it without a button', () => {
    render({ exportedDatasetId: 'e3553405-aaaa' });
    const open = screen.getByTestId('open-dataset');
    expect(open).toHaveAttribute('href', expect.stringContaining('/datasets/e3553405-aaaa/episodes'));
    expect(within(screen.getByTestId('session-summary')).getByTestId('open-dataset')).toBe(open);
    const row = screen.getByTestId('dataset-card');
    expect(row).toHaveTextContent('Exported');
    expect(row).toHaveTextContent('e3553405');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(datasetControls()).toBe(1);
  });

  it('a session with no frames offers New session and nothing to package', () => {
    render({ frameCount: 0 }, [ep(0, { discarded: true })]);
    expect(screen.getByRole('link', { name: 'New session' })).toHaveAttribute('href', expect.stringContaining('/data-collection/new'));
    expect(screen.getByTestId('session-summary')).toHaveTextContent('nothing to package');
    expect(screen.queryByTestId('create-dataset')).toBeNull();
    expect(screen.queryByTestId('open-dataset')).toBeNull();
    expect(screen.queryByTestId('dataset-card')).toBeNull();
    expect(datasetControls()).toBe(1);
  });

  it('otherwise Create dataset opens the existing modal, and it is the only dataset button in the DOM', async () => {
    const p = render();
    expect(screen.getByText('Not created yet')).toBeInTheDocument();
    expect(datasetControls()).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Create dataset' }));
    expect(p.onCreateDataset).toHaveBeenCalledTimes(1);
  });

  it('Edit task is one click from Details', async () => {
    const p = render();
    await userEvent.click(screen.getByRole('button', { name: 'Edit task' }));
    expect(p.onEditTask).toHaveBeenCalledTimes(1);
  });

  it('a completed session with a warning shows it once, under the sentence', () => {
    render({ errorMessage: 'The right hand stopped answering.' });
    expect(screen.getByTestId('session-warning')).toHaveTextContent('The right hand stopped answering.');
    expect(screen.getAllByText(/right hand stopped answering/)).toHaveLength(1);
    expect(screen.getByTestId('session-summary')).toHaveAttribute('data-result', 'completed');
  });

  it('a failed session says so, with its reason, once', () => {
    render({ status: 'failed', errorMessage: 'The recorder lost the robot.' });
    const band = screen.getByTestId('session-summary');
    expect(band).toHaveAttribute('data-result', 'failed');
    expect(within(band).getByRole('heading', { level: 2 })).toHaveTextContent('Session failed');
    expect(screen.getByTestId('session-warning')).toHaveTextContent('The recorder lost the robot.');
    expect(screen.getAllByText(/recorder lost the robot/)).toHaveLength(1);
    expect(datasetControls()).toBe(1);
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
    expect(screen.queryByText(/nothing to package/)).toBeNull();
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
    expect(screen.getByText(/nothing to package/)).toBeInTheDocument();
    expect(onRefetch).not.toHaveBeenCalled();
  });
});
