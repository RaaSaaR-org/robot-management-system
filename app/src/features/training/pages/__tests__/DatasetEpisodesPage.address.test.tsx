/**
 * @file DatasetEpisodesPage.address.test.tsx
 * @description What TASK-501 added to the episode page: the selected episode
 *              lives in the address, the player names it, one camera sits
 *              beside the chart in a wide window, and a trim asks first.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FeedbackProvider, getToasts, dismissToast } from '@/shared/components/ui';
import { DatasetEpisodesPage } from '../DatasetEpisodesPage';
import type { Dataset, EpisodeMeta } from '../../types';

const { trainingApiMock, datasetViewsApiMock, listRewards, viewport } = vi.hoisted(() => ({
  trainingApiMock: {
    getDataset: vi.fn(),
    getEpisodes: vi.fn(),
    getEpisodeFrames: vi.fn(async () => ({ frames: [], total: 0 })),
    getDatasetModality: vi.fn(async () => null),
    getDatasetStats: vi.fn(async () => ({ datasetId: 'apple', hasStats: false })),
    getAnnotations: vi.fn(async () => []),
    getEpisodeVideoUrl: vi.fn(
      (_id: string, episode: number, camera: string) => `/video/${episode}/${camera}`,
    ),
    flagEpisode: vi.fn(),
    trimEpisode: vi.fn(),
    listRobotTypes: vi.fn(async () => []),
  },
  datasetViewsApiMock: {
    listViews: vi.fn(async () => []),
    createView: vi.fn(),
    deleteView: vi.fn(),
    materializeView: vi.fn(),
  },
  listRewards: vi.fn(async () => []),
  // What the stage measured: the height the window has left, and its width.
  viewport: { height: 580 as number | null, viewportWidth: 1440 },
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
vi.mock('../../hooks/useViewportFill', () => ({
  useViewportFill: () => ({ ref: () => undefined, ...viewport }),
}));

const EGO = 'observation.images.ego_view';
const WRIST = 'observation.images.wrist';

const datasetWith = (cameras: string[]): Dataset => ({
  id: 'apple',
  name: 'Apple to Plate',
  robotTypeId: 'rt-g1',
  storagePath: 'apple/',
  lerobotVersion: 'v2.1',
  fps: 30,
  totalFrames: 900,
  totalDuration: 30,
  demonstrationCount: 3,
  infoJson: {
    features: {
      ...Object.fromEntries(cameras.map((cam) => [cam, { dtype: 'video', shape: [480, 640, 3] }])),
      'observation.state': { dtype: 'float32', shape: [2], names: ['a', 'b'] },
      action: { dtype: 'float32', shape: [2], names: ['a', 'b'] },
    },
  } as unknown as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
});

/** Indices with a gap, as a view or a curated dataset has them. */
const EPISODES: EpisodeMeta[] = [0, 1, 5].map((index) => ({
  index,
  frameCount: 100 + index,
  durationSeconds: 3 + index,
  flagged: false,
}));

/** Every address the page has been at, in order. */
const addressesSeen: string[] = [];

function Address() {
  const location = useLocation();
  const at = location.pathname + location.search;
  if (addressesSeen[addressesSeen.length - 1] !== at) addressesSeen.push(at);
  return <output data-testid="address">{location.pathname + location.search}</output>;
}

function renderPage(search = '') {
  return render(
    <FeedbackProvider>
      <MemoryRouter initialEntries={[`/datasets/apple/episodes${search}`]}>
        <Address />
        <Routes>
          <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
        </Routes>
      </MemoryRouter>
    </FeedbackProvider>,
  );
}

const address = () => screen.getByTestId('address').textContent;
const row = (index: number) => screen.getByTestId(`episode-check-${index}`).closest('li')!;
const stage = () => screen.getByTestId('episode-stage');

beforeEach(() => {
  vi.clearAllMocks();
  for (const t of getToasts()) dismissToast(t.id);
  viewport.height = 580;
  viewport.viewportWidth = 1440;
  trainingApiMock.getDataset.mockResolvedValue(datasetWith([EGO]));
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
});

describe('the selected episode and the address', () => {
  it('leaves the address alone until an episode is picked', async () => {
    renderPage('?tab=views');
    await waitFor(() => expect(row(0)).toHaveAttribute('aria-current', 'true'));
    expect(address()).toBe('/datasets/apple/episodes?tab=views');
  });

  it('writes the picked episode into the address and keeps the other parameters', async () => {
    renderPage('?tab=views');
    await waitFor(() => expect(row(0)).toHaveAttribute('aria-current', 'true'));

    fireEvent.click(row(5));
    await waitFor(() => expect(address()).toBe('/datasets/apple/episodes?tab=views&episode=5'));
    expect(row(5)).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Curate' }));
    await waitFor(() => expect(address()).toBe('/datasets/apple/episodes?tab=curate&episode=5'));
  });

  it('writes only the episode a run of quick picks ends on (a held arrow key)', async () => {
    renderPage();
    await waitFor(() => expect(row(0)).toHaveAttribute('aria-current', 'true'));
    // past the settle window of the page opening its first episode
    await new Promise((resolve) => setTimeout(resolve, 300));
    addressesSeen.length = 0;

    fireEvent.click(row(1));
    fireEvent.click(row(5));
    fireEvent.click(row(0));
    fireEvent.click(row(1));
    fireEvent.click(row(5));
    expect(row(5)).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(address()).toBe('/datasets/apple/episodes?episode=5'));
    // the first pick is written at once, the ones passed on the way never
    expect(addressesSeen).toEqual(['/datasets/apple/episodes?episode=1', '/datasets/apple/episodes?episode=5']);
  });

  it('opens the episode the address names', async () => {
    renderPage('?episode=5');
    await waitFor(() => expect(row(5)).toHaveAttribute('aria-current', 'true'));
    expect(address()).toBe('/datasets/apple/episodes?episode=5');
    expect(getToasts()).toHaveLength(0);
  });

  it('falls back to the first episode for one the dataset does not have, and says so', async () => {
    renderPage('?episode=9999');
    await waitFor(() => expect(row(0)).toHaveAttribute('aria-current', 'true'));
    await waitFor(() => expect(address()).toBe('/datasets/apple/episodes?episode=0'));
    expect(getToasts().map((t) => t.title)).toEqual(['Episode 9999 is not in this dataset']);
    expect(await screen.findByTestId('viewer-episode')).toHaveTextContent('Episode 0 · 1 of 3');
  });

  it('does the same for an episode that is not a number', async () => {
    renderPage('?episode=abc');
    await waitFor(() => expect(address()).toBe('/datasets/apple/episodes?episode=0'));
    expect(row(0)).toHaveAttribute('aria-current', 'true');
  });
});

describe('the player says which episode it plays', () => {
  it('names the index and the place among the episodes', async () => {
    renderPage('?episode=5');
    expect(await screen.findByTestId('viewer-episode')).toHaveTextContent('Episode 5 · 3 of 3');
  });
});

describe('the stage layout by camera count', () => {
  const layout = async () => {
    await screen.findByTestId('episode-viewer');
    return stage().getAttribute('data-layout');
  };

  it('puts one camera beside the chart in a tall, wide window (1440×900)', async () => {
    renderPage();
    expect(await layout()).toBe('side');
    expect(stage().style.getPropertyValue('--stage-height')).toBe('580px');
  });

  it('does the same at 1920×1080', async () => {
    viewport.height = 760;
    viewport.viewportWidth = 1920;
    renderPage();
    expect(await layout()).toBe('side');
  });

  it('keeps one camera beside the chart in a short window, as before (1280×720)', async () => {
    viewport.height = 400;
    viewport.viewportWidth = 1280;
    renderPage();
    expect(await layout()).toBe('side');
  });

  it('keeps the chart under one camera in a narrow window', async () => {
    viewport.viewportWidth = 1100;
    renderPage();
    expect(await layout()).toBe('stacked');
    expect(stage().style.getPropertyValue('--stage-height')).toBe('620px');
  });

  it('leaves two cameras as they were: across the width when there is height', async () => {
    trainingApiMock.getDataset.mockResolvedValue(datasetWith([EGO, WRIST]));
    renderPage();
    expect(await layout()).toBe('stacked');
  });

  it('leaves two cameras as they were: beside the chart in a short window', async () => {
    trainingApiMock.getDataset.mockResolvedValue(datasetWith([EGO, WRIST]));
    viewport.height = 400;
    viewport.viewportWidth = 1280;
    renderPage();
    expect(await layout()).toBe('side');
  });
});

describe('trimming an episode', () => {
  const trim = async () => {
    const panel = await screen.findByTestId('curate-panel');
    fireEvent.change(within(panel).getByLabelText('Start frame'), { target: { value: '2' } });
    fireEvent.change(within(panel).getByLabelText('End frame'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('curate-trim'));
    return screen.findByRole('alertdialog');
  };

  it('asks before it writes a new dataset', async () => {
    renderPage('?episode=1');
    const dialog = await trim();
    expect(dialog).toHaveTextContent('Trim episode 1?');
    expect(dialog).toHaveTextContent('Frames 2 up to 15 are kept (frame 15 itself is not).');
    expect(trainingApiMock.trimEpisode).not.toHaveBeenCalled();
    // The question outlives the page in the kit's queue: answer it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('writes nothing when the question is cancelled', async () => {
    renderPage('?episode=1');
    const dialog = await trim();
    expect(dialog).toHaveTextContent('Trim episode 1?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trainingApiMock.trimEpisode).not.toHaveBeenCalled();
    expect(screen.queryByTestId('curation-message')).not.toBeInTheDocument();
  });

  it('trims once it is confirmed', async () => {
    trainingApiMock.trimEpisode.mockResolvedValue({
      total_episodes: 3, total_frames: 290, newDatasetId: 'apple-2', newDatasetName: 'Apple to Plate (curated)',
    });
    renderPage('?episode=1');
    const dialog = await trim();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trim' }));
    await waitFor(() => expect(trainingApiMock.trimEpisode).toHaveBeenCalledWith('apple', 1, 2, 15));
    expect(await screen.findByTestId('curation-message')).toHaveTextContent('Trimmed');
  });
});
