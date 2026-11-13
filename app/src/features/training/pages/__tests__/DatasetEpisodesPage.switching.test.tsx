/**
 * @file DatasetEpisodesPage.switching.test.tsx
 * @description While another episode's data is still on its way — slow, or
 *              waiting out a rate limit — nothing on the page shows the
 *              previous episode's numbers as if they were current, and the
 *              panels fill in by themselves when it arrives (TASK-482).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  datasetViewsApiMock: {
    listViews: vi.fn(),
    createView: vi.fn(),
    deleteView: vi.fn(),
    materializeView: vi.fn(),
  },
  listRewards: vi.fn(),
}));

vi.mock('../../api/trainingApi', () => ({ trainingApi: trainingApiMock }));
vi.mock('../../api/datasetViewsApi', () => ({ datasetViewsApi: datasetViewsApiMock }));
vi.mock('../../api/datasetVideoApi', () => ({
  getDatasetVideoTicket: vi.fn(async (datasetId: string) => `tkt-${datasetId}`),
  probeVideoThrottle: vi.fn(async () => null),
}));
vi.mock('@/features/evaluation/api/evaluationApi', () => ({
  evaluationApi: { listRewards },
}));
// The comments and rating panel makes its own requests; not what is under test.
vi.mock('@/features/social', () => ({ SocialPanel: () => null }));

const DATASET: Dataset = {
  id: 'ds1',
  name: 'Apple to plate',
  robotTypeId: 'rt-g1',
  storagePath: '/data/ds1/',
  lerobotVersion: 'v2.1',
  fps: 30,
  totalFrames: 900,
  totalDuration: 30,
  demonstrationCount: 3,
  infoJson: {
    features: {
      'observation.images.ego_view': { dtype: 'video', shape: [480, 640, 3] },
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

/** Each episode a different length, so a stale number is recognisable. */
const FRAME_COUNTS = [211, 347, 158];
const EPISODES: EpisodeMeta[] = FRAME_COUNTS.map((frameCount, index) => ({
  index,
  frameCount,
  durationSeconds: frameCount / 30,
  flagged: false,
}));

const framesOf = (episode: number): FrameData[] =>
  Array.from({ length: FRAME_COUNTS[episode]! }, (_, i) => ({
    frameIndex: i,
    timestamp: i / 30,
    action: [i, -i],
    observationState: [i, -i],
  }));

/** Frames requests the test answers by hand, per episode. */
let pending: Record<number, (frames: FrameData[]) => void>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/datasets/ds1/episodes']}>
      <Routes>
        <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const endFrame = () => screen.getByLabelText('End frame') as HTMLInputElement;
const startFrame = () => screen.getByLabelText('Start frame') as HTMLInputElement;
const openEpisode = (index: number) =>
  fireEvent.click(document.querySelectorAll('li[role="button"]')[index]!);

beforeEach(() => {
  vi.clearAllMocks();
  pending = {};
  trainingApiMock.getDataset.mockResolvedValue(DATASET);
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
  trainingApiMock.getEpisodeFrames.mockImplementation(
    (_ds: string, episode: number) =>
      new Promise((resolve) => {
        pending[episode] = (frames) => resolve({ frames, total: frames.length });
      }),
  );
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
});

describe('switching episodes while the next one is still loading', () => {
  it('never shows the previous episode\'s sample count or end frame as current', async () => {
    renderPage();
    await waitFor(() => expect(pending[0]).toBeDefined());
    pending[0]!(framesOf(0));
    await waitFor(() => expect(screen.getByText(/211 samples/)).toBeInTheDocument());
    expect(endFrame().placeholder).toBe('211');

    openEpisode(1);

    // Episode 1's frames have not arrived (think: a 429 being waited out).
    await waitFor(() => expect(pending[1]).toBeDefined());
    expect(screen.queryByText(/211 samples/)).not.toBeInTheDocument();
    expect(screen.queryByText(/samples/)).not.toBeInTheDocument();
    expect(screen.queryByText('No trajectory data for this episode')).not.toBeInTheDocument();
    // The end frame is already episode 1's own length, from the episode list.
    expect(endFrame().placeholder).toBe('347');
    expect(screen.getByText(/^Episode 1 ·/)).toBeInTheDocument();

    // ...and when they do arrive, the chart fills in without a click.
    pending[1]!(framesOf(1));
    await waitFor(() => expect(screen.getByText(/347 samples/)).toBeInTheDocument());
    expect(endFrame().placeholder).toBe('347');
  });

  it('ignores an earlier episode\'s frames that arrive late', async () => {
    renderPage();
    await waitFor(() => expect(pending[0]).toBeDefined());
    openEpisode(2);
    await waitFor(() => expect(pending[2]).toBeDefined());

    pending[0]!(framesOf(0));
    await Promise.resolve();
    expect(screen.queryByText(/211 samples/)).not.toBeInTheDocument();
    expect(endFrame().placeholder).toBe('158');

    pending[2]!(framesOf(2));
    await waitFor(() => expect(screen.getByText(/158 samples/)).toBeInTheDocument());
  });

  it('does not carry a typed trim range over to another episode', async () => {
    renderPage();
    await waitFor(() => expect(pending[0]).toBeDefined());
    pending[0]!(framesOf(0));
    await waitFor(() => expect(endFrame().placeholder).toBe('211'));
    fireEvent.change(startFrame(), { target: { value: '20' } });
    fireEvent.change(endFrame(), { target: { value: '180' } });
    expect(endFrame().value).toBe('180');

    openEpisode(1);

    await waitFor(() => expect(endFrame().placeholder).toBe('347'));
    expect(endFrame().value).toBe('');
    expect(startFrame().value).toBe('0');
  });

  it('shows Play, not a stuck Pause, on the episode just opened', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    fireEvent.play(document.querySelector('video')!);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    openEpisode(1);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/episodes/1/'));
  });
});
