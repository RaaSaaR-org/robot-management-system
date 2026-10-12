/**
 * @file DatasetEpisodesPage.pusht.test.tsx
 * @description The episode page renders lerobot/pusht: object-shaped feature
 *              names and a singular `observation.image` camera (TASK-361).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DatasetEpisodesPage } from '../DatasetEpisodesPage';
import type { Dataset, EpisodeMeta } from '../../types';

const { trainingApiMock, datasetViewsApiMock, listRewards } = vi.hoisted(() => ({
  trainingApiMock: {
    getDataset: vi.fn(),
    getEpisodes: vi.fn(),
    getEpisodeFrames: vi.fn(),
    getAnnotations: vi.fn(),
    getEpisodeVideoUrl: vi.fn(() => 'about:blank'),
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

// lerobot/pusht meta/info.json (v3.0), trimmed to its features.
const PUSHT: Dataset = {
  id: 'pusht',
  name: 'pusht',
  robotTypeId: 'rt-pusht',
  storagePath: 'pusht/',
  lerobotVersion: 'v3.0',
  fps: 10,
  totalFrames: 300,
  totalDuration: 30,
  demonstrationCount: 2,
  infoJson: {
    features: {
      'observation.image': { dtype: 'video', shape: [96, 96, 3], names: ['height', 'width', 'channel'] },
      'observation.state': { dtype: 'float32', shape: [2], names: { motors: ['motor_0', 'motor_1'] } },
      action: { dtype: 'float32', shape: [2], names: { motors: ['motor_0', 'motor_1'] } },
    },
  } as unknown as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

const WINDOW = { from: 12.5, to: 27.5, chunk: 0, file: 0 };
const EPISODES: EpisodeMeta[] = [0, 1].map((index) => ({
  index,
  frameCount: 150,
  durationSeconds: 15,
  flagged: false,
  videoWindows: { 'observation.image': WINDOW },
}));

beforeEach(() => {
  vi.clearAllMocks();
  trainingApiMock.getDataset.mockResolvedValue(PUSHT);
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
  trainingApiMock.getEpisodeFrames.mockResolvedValue({ frames: [], total: 0 });
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
});

describe('the episode page on lerobot/pusht', () => {
  it('renders, and asks for the singular camera by its full key with its window', async () => {
    render(
      <MemoryRouter initialEntries={['/datasets/pusht/episodes']}>
        <Routes>
          <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(trainingApiMock.getEpisodeVideoUrl).toHaveBeenCalled());
    expect(trainingApiMock.getEpisodeVideoUrl).toHaveBeenCalledWith('pusht', 0, 'observation.image', WINDOW);
    expect(screen.queryByTestId('no-cameras')).not.toBeInTheDocument();
    expect(screen.getByText(/1 camera\b/)).toBeInTheDocument();
  });
});
