/**
 * @file DatasetEpisodesPage.views.test.tsx
 * @description The episode multi-select builds the selection it claims, and
 *              sends it resolved (TASK-240).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('creating a view from the episode selection', () => {
  it('sends exactly the episodes that were ticked, sorted, and nothing else', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('episode-check-0')).toBeInTheDocument());

    // Ticked out of order on purpose: the stored selection must not depend on
    // the order somebody clicked.
    fireEvent.click(screen.getByTestId('episode-check-3'));
    fireEvent.click(screen.getByTestId('episode-check-1'));

    expect(screen.getByTestId('episode-selection-bar')).toHaveTextContent('2 of 4 selected');

    fireEvent.click(screen.getByTestId('create-view-from-selection'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Two good takes' } });

    // The dialog states what it is about to store before it stores it.
    expect(screen.getByTestId('create-view-count')).toHaveTextContent('2 of 4 episodes');

    fireEvent.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(datasetViewsApiMock.createView).toHaveBeenCalledTimes(1));
    expect(datasetViewsApiMock.createView).toHaveBeenCalledWith('ds1', {
      name: 'Two good takes',
      description: undefined,
      selection: {
        episodes: [{ episodeIndex: 1 }, { episodeIndex: 3 }],
        origin: { kind: 'manual' },
      },
    });
  });

  it('un-ticking removes the episode from what would be sent', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('episode-check-0')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('episode-check-0'));
    fireEvent.click(screen.getByTestId('episode-check-2'));
    fireEvent.click(screen.getByTestId('episode-check-0'));

    fireEvent.click(screen.getByTestId('create-view-from-selection'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'One take' } });
    fireEvent.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(datasetViewsApiMock.createView).toHaveBeenCalled());
    expect(datasetViewsApiMock.createView.mock.calls[0][1]).toMatchObject({
      selection: { episodes: [{ episodeIndex: 2 }] },
    });
  });

  it('does not load an episode just because it was ticked', async () => {
    // The checkbox is a selection, not a navigation. Without the click guard
    // every tick also loaded that episode's frames.
    renderPage();
    await waitFor(() => expect(screen.getByTestId('episode-check-0')).toBeInTheDocument());
    await waitFor(() => expect(trainingApiMock.getEpisodeFrames).toHaveBeenCalled());
    const before = trainingApiMock.getEpisodeFrames.mock.calls.length;

    fireEvent.click(screen.getByTestId('episode-check-3'));

    expect(trainingApiMock.getEpisodeFrames.mock.calls.length).toBe(before);
  });

  it('builds the flag-based selection out of what is flagged on this page', async () => {
    trainingApiMock.getEpisodes.mockResolvedValue(
      EPISODES.map((ep) => ({ ...ep, flagged: ep.index === 2 })),
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId('episode-check-0')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('views-create'));
    fireEvent.click(screen.getByTestId('view-source-flags'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unflagged only' } });
    fireEvent.click(screen.getByTestId('create-view-submit'));

    await waitFor(() => expect(datasetViewsApiMock.createView).toHaveBeenCalled());
    expect(datasetViewsApiMock.createView.mock.calls[0][1]).toMatchObject({
      selection: {
        episodes: [{ episodeIndex: 0 }, { episodeIndex: 1 }, { episodeIndex: 3 }],
        origin: { kind: 'flags', decision: 'remove' },
      },
    });
  });
});

describe('a dataset that IS a view', () => {
  it('names its parent, and offers a duplicate rather than an edit when frozen', async () => {
    trainingApiMock.getDataset.mockImplementation(async (id: string) =>
      id === 'ds1'
        ? {
            ...DATASET,
            name: 'Clean takes only',
            kind: 'view',
            parentDatasetId: 'ds-parent',
            frozenAt: '2026-09-05T10:00:00.000Z',
            demonstrationCount: 2,
            selection: {
              episodes: [{ episodeIndex: 1 }, { episodeIndex: 3 }],
              origin: { kind: 'manual' },
            },
          }
        : { ...DATASET, id: 'ds-parent', name: 'Warehouse picks', demonstrationCount: 4 },
    );

    renderPage();

    const banner = await screen.findByTestId('view-banner');
    await waitFor(() => expect(banner).toHaveTextContent('Warehouse picks'));
    expect(banner).toHaveTextContent('2 of 4 episodes');
    expect(screen.getByTestId('view-banner-frozen')).toHaveTextContent('Frozen');
    expect(screen.getByTestId('view-banner-duplicate')).toBeInTheDocument();
  });
});
