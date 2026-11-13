/**
 * @file useEpisodeFrames.test.tsx
 * @description The frames request of the episode on screen is dropped when the episode changes
 *              and tried again by itself after a passing failure (TASK-492).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../api/trainingApi', () => ({ trainingApi: { getEpisodeFrames: vi.fn() } }));

import { trainingApi } from '../../api/trainingApi';
import { CHART_POINTS, FRAMES_PAGE, FRAMES_RETRY_DELAYS_MS, useEpisodeFrames } from '../useEpisodeFrames';
import type { FrameData } from '../../types';

const getFrames = vi.mocked(trainingApi.getEpisodeFrames);

const framesOf = (n: number): FrameData[] =>
  Array.from({ length: n }, (_, i) => ({ frameIndex: i, timestamp: i / 30, action: [i], observationState: [i] }));

/** What `apiClient` rejects with. */
const failure = (statusCode: number, message = `Request failed with status code ${statusCode}`) =>
  Object.assign(new Error(message), { statusCode });

/** The signal the hook passed with its n-th request. */
const signalOf = (call: number): AbortSignal => getFrames.mock.calls[call]![4]!.signal!;

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useEpisodeFrames', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getFrames.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (episode: number | null) =>
    renderHook(({ ep }: { ep: number | null }) => useEpisodeFrames('ds1', ep), { initialProps: { ep: episode } });

  it('asks for a chart-sized selection of the page and reports the episode\'s real length', async () => {
    getFrames.mockResolvedValue({ frames: framesOf(400), total: 688 });
    const { result } = setup(3);
    expect(result.current).toMatchObject({ isLoading: true, frames: [], total: null, error: null });
    await flush();
    expect(getFrames).toHaveBeenCalledWith('ds1', 3, 0, FRAMES_PAGE, { maxPoints: CHART_POINTS, signal: expect.any(AbortSignal) });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.frames).toHaveLength(400);
    expect(result.current.total).toBe(688);
  });

  it('aborts the request of the episode that was left', async () => {
    getFrames.mockReturnValue(new Promise(() => undefined));
    const { rerender, unmount } = setup(0);
    expect(signalOf(0).aborted).toBe(false);

    rerender({ ep: 1 });
    expect(signalOf(0).aborted).toBe(true);
    expect(signalOf(1).aborted).toBe(false);

    rerender({ ep: 2 });
    expect(signalOf(1).aborted).toBe(true);
    unmount();
    expect(signalOf(2).aborted).toBe(true);
    expect(getFrames).toHaveBeenCalledTimes(3);
  });

  it('shows nothing of an answer that arrives for an episode that was left', async () => {
    let answerFirst!: (value: { frames: FrameData[]; total: number }) => void;
    getFrames.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    getFrames.mockReturnValueOnce(new Promise(() => undefined));
    const { result, rerender } = setup(0);
    rerender({ ep: 1 });
    answerFirst({ frames: framesOf(5), total: 5 });
    await flush();
    expect(result.current).toMatchObject({ isLoading: true, frames: [], total: null });
  });

  it.each([504, 502, 503, 0])('tries again by itself after a %s and shows the frames, never the error', async (status) => {
    getFrames.mockRejectedValueOnce(failure(status));
    getFrames.mockResolvedValueOnce({ frames: framesOf(7), total: 7 });
    const { result } = setup(4);
    await flush();
    // Still loading: no error state, no Retry button to press.
    expect(result.current).toMatchObject({ isLoading: true, error: null });
    expect(getFrames).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(FRAMES_RETRY_DELAYS_MS[0]!); });
    expect(getFrames).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ isLoading: false, error: null, total: 7 });
  });

  it('gives up after three further tries and then says what failed, with a retry that starts over', async () => {
    getFrames.mockRejectedValue(failure(504));
    const { result } = setup(4);
    await flush();
    for (const delay of FRAMES_RETRY_DELAYS_MS) {
      expect(result.current.error).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
    }
    expect(getFrames).toHaveBeenCalledTimes(1 + FRAMES_RETRY_DELAYS_MS.length);
    expect(result.current).toMatchObject({ isLoading: false, error: 'Request failed with status code 504' });

    getFrames.mockResolvedValue({ frames: framesOf(2), total: 2 });
    act(() => result.current.retry());
    expect(result.current).toMatchObject({ isLoading: true, error: null });
    await flush();
    expect(result.current).toMatchObject({ isLoading: false, error: null, total: 2 });
  });

  it('does not repeat a request the server answered with a reason', async () => {
    getFrames.mockRejectedValue(failure(422, "Episode 4's data file data/chunk-000/file-000.parquet is missing"));
    const { result } = setup(4);
    await flush();
    expect(result.current.error).toMatch(/is missing/);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getFrames).toHaveBeenCalledTimes(1);
  });

  it('does not try again for an episode the viewer has left in the meantime', async () => {
    getFrames.mockRejectedValueOnce(failure(504));
    getFrames.mockReturnValue(new Promise(() => undefined));
    const { rerender } = setup(4);
    await flush();
    rerender({ ep: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    // One request for episode 4, one for episode 5 — no second for 4.
    expect(getFrames.mock.calls.map((call) => call[1])).toEqual([4, 5]);
  });

  it('loads nothing while no episode is selected', () => {
    const { result } = setup(null);
    expect(getFrames).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ isLoading: false, frames: [], error: null });
  });
});
