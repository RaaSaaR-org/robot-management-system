/**
 * @file DatasetEpisodesPage.errors.test.tsx
 * @description A failed episodes or frames read is shown, not drawn as an
 *              empty chart (TASK-354).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ApiRequestError } from '@/api/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DatasetEpisodesPage } from '../DatasetEpisodesPage';
import type { Dataset, EpisodeMeta } from '../../types';

const { trainingApiMock, datasetViewsApiMock, listRewards } = vi.hoisted(() => ({
  trainingApiMock: {
    getDataset: vi.fn(),
    getEpisodes: vi.fn(),
    getEpisodeFrames: vi.fn(),
    getAnnotations: vi.fn(),
    getEpisodeVideoUrl: () => 'about:blank',
    flagEpisode: vi.fn(),
    // The expectations panel (TASK-353) lists robot types on mount.
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
vi.mock('@/features/evaluation/api/evaluationApi', () => ({
  evaluationApi: { listRewards },
}));

const DATASET: Dataset = {
  id: 'ds1',
  name: 'Warehouse picks',
  robotTypeId: 'rt-g1',
  storagePath: '/data/ds1/',
  lerobotVersion: 'v3.0',
  fps: 30,
  totalFrames: 1200,
  totalDuration: 40,
  demonstrationCount: 4,
  // No `observation.images.*`, so the viewer renders its state-only panel
  // instead of four <video> elements jsdom cannot play.
  infoJson: { features: {} } as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const EPISODES: EpisodeMeta[] = [0, 1, 2, 3].map((index) => ({
  index,
  frameCount: 300,
  durationSeconds: 10,
  flagged: false,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/datasets/ds1/episodes']}>
      <Routes>
        <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  trainingApiMock.getDataset.mockResolvedValue(DATASET);
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
  trainingApiMock.getEpisodeFrames.mockResolvedValue({ frames: [], total: 0 });
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
  datasetViewsApiMock.createView.mockImplementation(async (_id: string, input: unknown) => ({
    ...DATASET,
    id: 'view-new',
    kind: 'view',
    ...(input as { name: string }),
  }));
});

describe('episode read failures', () => {
  it("shows the server's reason when an episode's frames cannot be read, and retries", async () => {
    const message = 'Episode 0 has no data file: data/chunk-000/episode_000000.parquet is missing';
    trainingApiMock.getEpisodeFrames.mockRejectedValueOnce(
      new ApiRequestError({ code: 'UNKNOWN_ERROR', message, statusCode: 422 }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Couldn't load this episode's frames")).toBeInTheDocument());
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('No trajectory data for this episode')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(trainingApiMock.getEpisodeFrames).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('No trajectory data for this episode')).toBeInTheDocument());
  });

  it("shows the server's reason when the episode list cannot be read", async () => {
    const message = 'No episode metadata in storage: meta/episodes.jsonl is missing';
    trainingApiMock.getEpisodes.mockRejectedValueOnce(
      new ApiRequestError({ code: 'UNKNOWN_ERROR', message, statusCode: 422 }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Couldn't load the episodes")).toBeInTheDocument());
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
