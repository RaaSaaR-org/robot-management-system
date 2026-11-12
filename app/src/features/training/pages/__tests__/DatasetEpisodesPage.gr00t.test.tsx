/**
 * @file DatasetEpisodesPage.gr00t.test.tsx
 * @description The episode page on a GR00T-style v2.1 dataset: channels labelled
 *              from meta/modality.json instead of the placeholder name in
 *              info.json, and the statistics panel filled (TASK-476).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DatasetEpisodesPage } from '../DatasetEpisodesPage';
import type { Dataset, DatasetModality, EpisodeMeta, FrameData } from '../../types';

const { trainingApiMock, datasetViewsApiMock, listRewards } = vi.hoisted(() => ({
  trainingApiMock: {
    getDataset: vi.fn(),
    getEpisodes: vi.fn(),
    getEpisodeFrames: vi.fn(),
    getDatasetModality: vi.fn(),
    getDatasetStats: vi.fn(),
    getAnnotations: vi.fn(),
    getEpisodeVideoUrl: vi.fn(() => 'about:blank'),
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
vi.mock('@/features/evaluation/api/evaluationApi', () => ({
  evaluationApi: { listRewards },
}));

const WIDTH = 43;

// nvidia/GR00T-N1.7-AppleToPlate meta/info.json (v2.1), trimmed to its features:
// one placeholder name for 43 channels.
const APPLE: Dataset = {
  id: 'apple',
  name: 'GR00T-N1.7-AppleToPlate',
  robotTypeId: 'rt-g1',
  storagePath: 'apple/',
  lerobotVersion: 'v2.1',
  fps: 30,
  totalFrames: 171625,
  totalDuration: 5720.8,
  demonstrationCount: 402,
  infoJson: {
    features: {
      'observation.images.ego_view': { dtype: 'video', shape: [480, 640, 3], names: ['height', 'width', 'channel'] },
      'observation.state': { dtype: 'float32', shape: [WIDTH], names: ['observation_to_policy'] },
      action: { dtype: 'float32', shape: [WIDTH], names: ['action_from_policy'] },
    },
  } as unknown as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
};

// Its meta/modality.json, as the server answers it.
const GROUPS = [
  { name: 'left_leg', start: 0, end: 6 },
  { name: 'right_leg', start: 6, end: 12 },
  { name: 'waist', start: 12, end: 15 },
  { name: 'left_arm', start: 15, end: 22 },
  { name: 'right_arm', start: 22, end: 29 },
  { name: 'left_hand', start: 29, end: 36 },
  { name: 'right_hand', start: 36, end: 43 },
];
const MODALITY: DatasetModality = { state: GROUPS, action: GROUPS };

const EPISODES: EpisodeMeta[] = [{ index: 0, frameCount: 3, durationSeconds: 0.1, flagged: false }];
// Only the right arm (channels 22..28) moves.
const FRAMES: FrameData[] = [0, 1, 2].map((i) => {
  const vector = Array.from({ length: WIDTH }, (_, c) => (c >= 22 && c < 29 ? i * (c - 21) : 0.5));
  return { frameIndex: i, timestamp: i / 30, action: vector, observationState: vector };
});

const ramp = (offset: number) => Array.from({ length: WIDTH }, (_, c) => c + offset);
const STATS = {
  'observation.state': { min: ramp(-1), max: ramp(1), mean: ramp(0), std: ramp(0).map(() => 0.25), count: [171625] },
  action: { min: ramp(99), max: ramp(101), mean: ramp(100), std: ramp(0).map(() => 0.5), count: [171625] },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/datasets/apple/episodes']}>
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
  trainingApiMock.getEpisodeFrames.mockResolvedValue({ frames: FRAMES, total: FRAMES.length });
  trainingApiMock.getDatasetModality.mockResolvedValue(MODALITY);
  trainingApiMock.getDatasetStats.mockResolvedValue({ datasetId: 'apple', hasStats: true, stats: STATS });
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
});

describe('the episode page on a GR00T v2.1 dataset', () => {
  it('labels the joint chart by body part and index, one group at a time', async () => {
    renderPage();

    const picker = await screen.findByRole('group', { name: 'Joint group' });
    expect(trainingApiMock.getDatasetModality).toHaveBeenCalledWith('apple');
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(
      ['left leg', 'right leg', 'waist', 'left arm', 'right arm', 'left hand', 'right hand'],
    );
    // The arm that moves in this episode is the one on screen.
    expect(within(picker).getByRole('button', { name: 'right arm' })).toHaveAttribute('aria-pressed', 'true');
    const legend = within(screen.getByTestId('joint-chart-legend'));
    expect(legend.getByText('right_arm[3]')).toBeInTheDocument();
    expect(legend.queryByText('action_from_policy')).not.toBeInTheDocument();

    await userEvent.click(within(picker).getByRole('button', { name: 'left arm' }));
    expect(legend.getByText('left_arm[3]')).toBeInTheDocument();
    expect(legend.queryByText('right_arm[3]')).not.toBeInTheDocument();
  });

  it('fills the statistics panel, by joint group', async () => {
    renderPage();

    const panel = within(await screen.findByTestId('dataset-stats-panel'));
    await waitFor(() => expect(panel.getByTestId('stats-row-0')).toBeInTheDocument());
    expect(trainingApiMock.getDatasetStats).toHaveBeenCalledWith('apple');
    expect(panel.getByText(/171,625 frames/)).toBeInTheDocument();
    expect(panel.queryByText('No statistics for this dataset')).not.toBeInTheDocument();

    await userEvent.click(panel.getByRole('button', { name: 'left arm' }));
    const cells = within(panel.getByTestId('stats-row-18')).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['left_arm[3]', '17', '19', '18', '0.25']);
  });

  it('keeps the info.json names and an empty panel when the dataset has neither file', async () => {
    trainingApiMock.getDatasetModality.mockResolvedValue(null);
    trainingApiMock.getDatasetStats.mockResolvedValue({ datasetId: 'apple', hasStats: false });
    renderPage();

    expect(await screen.findByText('No statistics for this dataset')).toBeInTheDocument();
    const legend = within(await screen.findByTestId('joint-chart-legend'));
    expect(legend.getByText('action_from_policy')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Joint group' })).not.toBeInTheDocument();
  });

  it('still renders when the two requests fail', async () => {
    trainingApiMock.getDatasetModality.mockRejectedValue(new Error('503'));
    trainingApiMock.getDatasetStats.mockRejectedValue(new Error('503'));
    renderPage();

    expect(await screen.findByText('No statistics for this dataset')).toBeInTheDocument();
    expect(await screen.findByTestId('joint-chart-legend')).toBeInTheDocument();
  });
});
