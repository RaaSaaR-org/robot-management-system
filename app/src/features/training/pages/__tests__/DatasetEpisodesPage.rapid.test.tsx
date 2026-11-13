/**
 * @file DatasetEpisodesPage.rapid.test.tsx
 * @description Walking quickly through the episode list — clicks or a held arrow key — loads the
 *              episode the viewer stops on and none of the ones passed on the way, drops the
 *              requests of episodes that were left, and recovers from a gateway timeout by itself
 *              (TASK-492).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DatasetEpisodesPage } from '../DatasetEpisodesPage';
import type { Dataset, EpisodeMeta, FrameData } from '../../types';

const { trainingApiMock, datasetViewsApiMock, listRewards } = vi.hoisted(() => ({
  trainingApiMock: {
    getDataset: vi.fn(),
    getEpisodes: vi.fn(),
    getEpisodeFrames: vi.fn(),
    getDatasetModality: vi.fn(async () => null),
    getDatasetStats: vi.fn(async () => ({ datasetId: 'ds', hasStats: false })),
    getAnnotations: vi.fn(),
    getEpisodeVideoUrl: vi.fn((_ds: string, episode: number, cam: string) => `/api/datasets/ds1/episodes/${episode}/video/${cam}`),
    flagEpisode: vi.fn(),
    listRobotTypes: vi.fn(async () => []),
  },
  datasetViewsApiMock: { listViews: vi.fn(), createView: vi.fn(), deleteView: vi.fn(), materializeView: vi.fn() },
  listRewards: vi.fn(),
}));

vi.mock('../../api/trainingApi', () => ({ trainingApi: trainingApiMock }));
vi.mock('../../api/datasetViewsApi', () => ({ datasetViewsApi: datasetViewsApiMock }));
vi.mock('../../api/datasetVideoApi', () => ({
  getDatasetVideoTicket: vi.fn(async (datasetId: string) => `tkt-${datasetId}`),
  probeVideoThrottle: vi.fn(async () => null),
}));
vi.mock('@/features/evaluation/api/evaluationApi', () => ({ evaluationApi: { listRewards } }));
vi.mock('@/features/social', () => ({ SocialPanel: () => null }));

const EPISODE_COUNT = 12;
const frameCountOf = (episode: number) => 200 + episode * 7;
const EPISODES: EpisodeMeta[] = Array.from({ length: EPISODE_COUNT }, (_, index) => ({
  index,
  frameCount: frameCountOf(index),
  durationSeconds: frameCountOf(index) / 30,
  flagged: false,
}));

const DATASET: Dataset = {
  id: 'ds1',
  name: 'Bottle sorting',
  robotTypeId: 'rt-g1',
  storagePath: 'ds1/',
  lerobotVersion: 'v3.0',
  fps: 30,
  totalFrames: 3000,
  totalDuration: 100,
  demonstrationCount: EPISODE_COUNT,
  infoJson: {
    features: {
      'observation.images.head': { dtype: 'video', shape: [480, 640, 3] },
      'observation.state': { dtype: 'float32', shape: [2], names: ['a', 'b'] },
      action: { dtype: 'float32', shape: [2], names: ['a', 'b'] },
    },
  } as unknown as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const framesOf = (episode: number): FrameData[] =>
  Array.from({ length: 5 }, (_, i) => ({ frameIndex: i, timestamp: i / 30, action: [episode, -i], observationState: [i, episode] }));

const rows = () => [...document.querySelectorAll<HTMLElement>('li[role="button"]')];
const currentRow = () => rows().findIndex((row) => row.getAttribute('aria-current'));
const requested = () => trainingApiMock.getEpisodeFrames.mock.calls.map((call) => call[1] as number);
const signalOf = (call: number) => (trainingApiMock.getEpisodeFrames.mock.calls[call]![4] as { signal: AbortSignal }).signal;
const videoSrc = () => document.querySelector('video')?.getAttribute('src') ?? '';
const endFrame = () => screen.getByLabelText('End frame') as HTMLInputElement;
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function openPage() {
  render(
    <MemoryRouter initialEntries={['/datasets/ds1/episodes']}>
      <Routes>
        <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
      </Routes>
    </MemoryRouter>,
  );
  // Everything the page loads on arrival (the fake clock only moves once its
  // requests have answered), and then a pause as long as a viewer's.
  for (let i = 0; i < 5; i++) await wait(1);
  await wait(2000);
  expect(rows()).toHaveLength(EPISODE_COUNT);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  trainingApiMock.getDataset.mockResolvedValue(DATASET);
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
  trainingApiMock.getEpisodeFrames.mockImplementation(async (_ds: string, episode: number) => ({
    frames: framesOf(episode),
    total: frameCountOf(episode),
  }));
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('walking quickly through the episode list', () => {
  it('opens a single click at once', async () => {
    await openPage();
    expect(requested()).toEqual([0]);

    fireEvent.click(rows()[4]!);
    await wait(0);
    expect(requested()).toEqual([0, 4]);
    expect(videoSrc()).toContain('/episodes/4/');
    expect(screen.getByText(new RegExp(`${frameCountOf(4)} samples`))).toBeInTheDocument();
  });

  it('asks for the frames and the video of the episode stopped on, and of none passed on the way', async () => {
    await openPage();
    // Ten clicks 50 ms apart, down the list.
    for (let row = 1; row <= 10; row++) {
      fireEvent.click(rows()[row]!);
      // The highlight and the Curate panel's frame count follow every click.
      expect(currentRow()).toBe(row);
      expect(endFrame().placeholder).toBe(String(frameCountOf(row)));
      await wait(50);
    }
    // Episode 1 was a click out of the blue and opened at once; 2 to 9 were passed.
    expect(requested()).toEqual([0, 1]);
    expect(videoSrc()).toContain('/episodes/1/');
    // Nothing of episode 1 is shown as episode 10's.
    expect(screen.queryByText(/samples/)).not.toBeInTheDocument();

    await wait(250);
    expect(requested()).toEqual([0, 1, 10]);
    expect(videoSrc()).toContain('/episodes/10/');
    expect(screen.getByText(new RegExp(`${frameCountOf(10)} samples`))).toBeInTheDocument();
    const urls = trainingApiMock.getEpisodeVideoUrl.mock.calls.map((call) => call[1] as number);
    expect([...new Set(urls)]).toEqual([0, 1, 10]);
  });

  it('drops the frames request of every episode that was left', async () => {
    trainingApiMock.getEpisodeFrames.mockImplementation(() => new Promise(() => undefined));
    await openPage();
    // Slower than the settle time: each click opens its episode.
    for (const row of [3, 6, 9]) {
      fireEvent.click(rows()[row]!);
      await wait(400);
    }
    expect(requested()).toEqual([0, 3, 6, 9]);
    expect([0, 1, 2, 3].map((call) => signalOf(call).aborted)).toEqual([true, true, true, false]);
  });

  it('walks the list with the arrow keys, and a held key loads only where it stops', async () => {
    await openPage();
    fireEvent.click(rows()[2]!);
    rows()[2]!.focus();
    await wait(1000);
    expect(requested()).toEqual([0, 2]);

    // A held key repeats about thirty times a second.
    for (let step = 1; step <= 8; step++) {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(currentRow()).toBe(2 + step);
      expect(document.activeElement).toBe(rows()[2 + step]);
      await wait(33);
    }
    expect(requested()).toEqual([0, 2, 3]);
    await wait(250);
    expect(requested()).toEqual([0, 2, 3, 10]);
    expect(videoSrc()).toContain('/episodes/10/');

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(currentRow()).toBe(9);
    // The ends of the list are the ends.
    rows()[EPISODE_COUNT - 1]!.focus();
    fireEvent.click(rows()[EPISODE_COUNT - 1]!);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(currentRow()).toBe(EPISODE_COUNT - 1);
  });

  it('draws the chart by itself after a gateway timeout, without an error to click away', async () => {
    await openPage();
    trainingApiMock.getEpisodeFrames.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 504'), { statusCode: 504 }),
    );
    fireEvent.click(rows()[5]!);
    await wait(100);
    expect(screen.queryByText("Couldn't load this episode's frames")).not.toBeInTheDocument();
    expect(screen.queryByText(/samples/)).not.toBeInTheDocument();

    await wait(500);
    expect(requested()).toEqual([0, 5, 5]);
    expect(screen.getByText(new RegExp(`${frameCountOf(5)} samples`))).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this episode's frames")).not.toBeInTheDocument();
  });
});
