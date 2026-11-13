/**
 * @file DatasetEpisodesPage.stage.test.tsx
 * @description The episode page's first screen and what sits under it
 *              (TASK-484): no video is requested before the cameras are known,
 *              nothing of the previous episode is shown while the next one
 *              loads, and the secondary panels are tabs.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DatasetEpisodesPage } from '../DatasetEpisodesPage';
import type { Dataset, EpisodeMeta, FrameData } from '../../types';

const { trainingApiMock, datasetViewsApiMock, listRewards } = vi.hoisted(() => ({
  trainingApiMock: {
    getDataset: vi.fn(),
    getEpisodes: vi.fn(),
    getEpisodeFrames: vi.fn(),
    getDatasetModality: vi.fn(async () => null),
    getDatasetStats: vi.fn(async () => ({ datasetId: 'apple', hasStats: false })),
    getAnnotations: vi.fn(),
    getEpisodeVideoUrl: vi.fn(
      (_id: string, episode: number, camera: string) => `/video/${episode}/${camera}`,
    ),
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
}));
vi.mock('@/features/evaluation/api/evaluationApi', () => ({
  evaluationApi: { listRewards },
}));

const EGO = 'observation.images.ego_view';

const APPLE: Dataset = {
  id: 'apple',
  name: 'Apple to Plate',
  robotTypeId: 'rt-g1',
  storagePath: 'apple/',
  lerobotVersion: 'v2.1',
  fps: 30,
  totalFrames: 900,
  totalDuration: 30,
  demonstrationCount: 2,
  infoJson: {
    features: {
      [EGO]: { dtype: 'video', shape: [480, 640, 3], names: ['height', 'width', 'channel'] },
      'observation.state': { dtype: 'float32', shape: [2], names: ['a', 'b'] },
      action: { dtype: 'float32', shape: [2], names: ['a', 'b'] },
    },
  } as unknown as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
};

const EPISODES: EpisodeMeta[] = [
  { index: 0, frameCount: 590, durationSeconds: 19.7, flagged: false },
  { index: 1, frameCount: 535, durationSeconds: 17.8, flagged: false },
];

const framesOf = (count: number): FrameData[] =>
  Array.from({ length: count }, (_, i) => ({ frameIndex: i, timestamp: i / 30, action: [i, -i], observationState: [i, -i] }));

/** A promise the test settles when it chooses to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/datasets/apple/episodes${search}`]}>
      <Routes>
        <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  trainingApiMock.getDataset.mockResolvedValue(APPLE);
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
  trainingApiMock.getEpisodeFrames.mockImplementation(async (_id: string, episode: number) => {
    const frames = framesOf(episode === 0 ? 5 : 4);
    return { frames, total: frames.length };
  });
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
});

describe('the episode stage', () => {
  it('requests no video until the dataset has said which cameras it has', async () => {
    // The episodes arrive first; the dataset row — and with it the camera list — later.
    const dataset = deferred<Dataset>();
    trainingApiMock.getDataset.mockReturnValue(dataset.promise);
    const { container } = renderPage();

    await waitFor(() => expect(screen.getByTestId('episode-check-0')).toBeInTheDocument());
    // Used to guess `observation.images.wrist` here and get a 404.
    expect(container.querySelector('video')).toBeNull();
    expect(trainingApiMock.getEpisodeVideoUrl).not.toHaveBeenCalled();

    await act(async () => { dataset.resolve(APPLE); });
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
    const cameras = new Set(trainingApiMock.getEpisodeVideoUrl.mock.calls.map((call) => call[2]));
    expect([...cameras]).toEqual([EGO]);
  });

  it('shows nothing of the previous episode while the next one loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/5 samples/)).toBeInTheDocument());
    const endFrame = () => within(screen.getByTestId('curate-panel')).getByLabelText('End frame');
    expect(endFrame()).toHaveAttribute('placeholder', '590');
    fireEvent.change(endFrame(), { target: { value: '400' } });

    // Episode 1 is slow to answer.
    const slow = deferred<{ frames: FrameData[]; total: number }>();
    trainingApiMock.getEpisodeFrames.mockReturnValue(slow.promise);
    fireEvent.click(screen.getByText('Episode 1'));

    // Its own frame count at once, and no sample count that is not its own.
    expect(endFrame()).toHaveAttribute('placeholder', '535');
    expect(endFrame()).toHaveValue(null);
    expect(screen.queryByText(/samples/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('joint-chart-cursor')).not.toBeInTheDocument();
    expect(screen.getByTestId('transport-clock')).toHaveTextContent('0:00.0 / 0:17.8');

    await act(async () => { slow.resolve({ frames: framesOf(4), total: 4 }); });
    expect(await screen.findByText(/4 samples/)).toBeInTheDocument();
  });

  it('does not let a slow answer for an episode that was left overwrite the one on screen', async () => {
    const first = deferred<{ frames: FrameData[]; total: number }>();
    trainingApiMock.getEpisodeFrames.mockReturnValueOnce(first.promise);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('episode-check-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Episode 1'));
    expect(await screen.findByText(/4 samples/)).toBeInTheDocument();

    await act(async () => { first.resolve({ frames: framesOf(5), total: 5 }); });
    expect(screen.getByText(/4 samples/)).toBeInTheDocument();
    expect(screen.queryByText(/5 samples/)).not.toBeInTheDocument();
  });

  it('keeps the cursor on the chart before playback starts', async () => {
    renderPage();
    expect(await screen.findByTestId('joint-chart-cursor')).toHaveAttribute('data-position', '0.000');
  });
});

describe('the panels under the stage', () => {
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('opens on Curate and shows one panel at a time', async () => {
    renderPage();
    expect(await screen.findByTestId('curate-panel')).toBeInTheDocument();
    expect(tab('Curate')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('dataset-stats-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-views-section')).not.toBeInTheDocument();

    fireEvent.click(tab('Statistics'));
    expect(await screen.findByTestId('dataset-stats-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('curate-panel')).not.toBeInTheDocument();

    fireEvent.click(tab('Views'));
    expect(screen.getByTestId('dataset-views-section')).toBeInTheDocument();
    fireEvent.click(tab('Annotations'));
    expect(screen.getByTestId('annotate-dataset')).toBeInTheDocument();
    fireEvent.click(tab('Dataset discussion'));
    expect(await screen.findByRole('region', { name: 'Dataset discussion' })).toBeInTheDocument();
    fireEvent.click(tab('Episode discussion'));
    expect(await screen.findByRole('region', { name: 'Episode 0 discussion' })).toBeInTheDocument();
  });

  it('opens the tab named in the address', async () => {
    renderPage('?tab=views');
    expect(await screen.findByTestId('dataset-views-section')).toBeInTheDocument();
    expect(tab('Views')).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab for a name it does not have', async () => {
    renderPage('?tab=nonsense');
    expect(await screen.findByTestId('curate-panel')).toBeInTheDocument();
  });

  it('keeps the stage and the robot-type line outside the tabs', async () => {
    renderPage('?tab=statistics');
    expect(await screen.findByTestId('dataset-stats-panel')).toBeInTheDocument();
    expect(screen.getByTestId('episode-stage')).toBeInTheDocument();
    expect(screen.getByTestId('joint-chart-panel')).toBeInTheDocument();
    expect(screen.getByTestId('dataset-expectations')).toBeInTheDocument();
  });
});
