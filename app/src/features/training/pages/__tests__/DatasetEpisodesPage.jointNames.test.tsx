/**
 * @file DatasetEpisodesPage.jointNames.test.tsx
 * @description The episode page on a dataset that has joint groups AND a real
 *              name per joint: the names win inside a group. And its header
 *              says a Hub import as provenance (TASK-494).
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

// g1-dex3-bottle-sorting-sim meta/info.json: 31 named joints, left and right alternating.
const NAMES = [
  'waist_yaw_joint', 'waist_roll_joint', 'waist_pitch_joint',
  'left_shoulder_pitch_joint', 'right_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'right_shoulder_roll_joint',
  'left_shoulder_yaw_joint', 'right_shoulder_yaw_joint', 'left_elbow_joint', 'right_elbow_joint',
  'left_wrist_roll_joint', 'right_wrist_roll_joint', 'left_wrist_pitch_joint', 'right_wrist_pitch_joint',
  'left_wrist_yaw_joint', 'right_wrist_yaw_joint',
  'left_hand_index_0_joint', 'left_hand_middle_0_joint', 'left_hand_thumb_0_joint',
  'right_hand_index_0_joint', 'right_hand_middle_0_joint', 'right_hand_thumb_0_joint',
  'left_hand_index_1_joint', 'left_hand_middle_1_joint', 'left_hand_thumb_1_joint',
  'right_hand_index_1_joint', 'right_hand_middle_1_joint', 'right_hand_thumb_1_joint',
  'left_hand_thumb_2_joint', 'right_hand_thumb_2_joint',
];
const WIDTH = NAMES.length;
const REVISION = '37cb1d6e0c5a4b8f9e2d1a3b4c5d6e7f80912345';

const features = (names: string[]) => ({
  'observation.images.head': { dtype: 'video', shape: [480, 640, 3], names: ['height', 'width', 'channel'] },
  'observation.state': { dtype: 'float32', shape: [WIDTH], names },
  action: { dtype: 'float32', shape: [WIDTH], names },
});

const BOTTLES: Dataset = {
  id: 'bottles',
  name: 'g1-dex3-bottle-sorting-sim',
  robotTypeId: 'rt-g1',
  storagePath: 'bottles/',
  lerobotVersion: 'v3.0',
  fps: 30,
  totalFrames: 55695,
  totalDuration: 1856.5,
  demonstrationCount: 80,
  infoJson: { features: features(NAMES) } as unknown as Dataset['infoJson'],
  statsJson: {} as Dataset['statsJson'],
  status: 'ready',
  kind: 'materialized',
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
};

// Its meta/modality.json, as the server answers it.
const GROUPS = [
  { name: 'waist', start: 0, end: 3 },
  { name: 'arms', start: 3, end: 17 },
  { name: 'hands', start: 17, end: 31 },
];
const MODALITY: DatasetModality = { state: GROUPS, action: GROUPS };

const EPISODES: EpisodeMeta[] = [{ index: 0, frameCount: 3, durationSeconds: 0.1, flagged: false }];
// Only the arms (channels 3..16) move.
const FRAMES: FrameData[] = [0, 1, 2].map((i) => {
  const vector = Array.from({ length: WIDTH }, (_, c) => (c >= 3 && c < 17 ? i * (c - 2) : 0.5));
  return { frameIndex: i, timestamp: i / 30, action: vector, observationState: vector };
});

const ramp = (offset: number) => Array.from({ length: WIDTH }, (_, c) => c + offset);
const STATS = {
  'observation.state': { min: ramp(-1), max: ramp(1), mean: ramp(0), std: ramp(0).map(() => 0.25), count: [55695] },
  action: { min: ramp(99), max: ramp(101), mean: ramp(100), std: ramp(0).map(() => 0.5), count: [55695] },
};

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/datasets/bottles/episodes${search}`]}>
      <Routes>
        <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  trainingApiMock.getDataset.mockResolvedValue(BOTTLES);
  trainingApiMock.getEpisodes.mockResolvedValue(EPISODES);
  trainingApiMock.getEpisodeFrames.mockResolvedValue({ frames: FRAMES, total: FRAMES.length });
  trainingApiMock.getDatasetModality.mockResolvedValue(MODALITY);
  trainingApiMock.getDatasetStats.mockResolvedValue({ datasetId: 'bottles', hasStats: true, stats: STATS });
  trainingApiMock.getAnnotations.mockResolvedValue([]);
  listRewards.mockResolvedValue([]);
  datasetViewsApiMock.listViews.mockResolvedValue([]);
});

describe('the episode page on a dataset with joint groups and joint names (TASK-494)', () => {
  it('names the joints of the group on screen instead of numbering them', async () => {
    renderPage();

    const picker = await screen.findByRole('group', { name: 'Joint group' });
    expect(within(picker).getByRole('button', { name: 'arms' })).toHaveAttribute('aria-pressed', 'true');
    const legend = within(screen.getByTestId('joint-chart-legend'));
    // Seven joints, each once for both sides, without the suffix they all share.
    expect(legend.getAllByRole('button').map((b) => b.textContent)).toEqual(
      ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow', 'wrist_roll', 'wrist_pitch', 'wrist_yaw'],
    );
    expect(legend.getByRole('button', { name: 'elbow' })).toHaveAttribute('title', 'left_elbow_joint · right_elbow_joint');
    expect(legend.queryByText(/arms\[/)).not.toBeInTheDocument();

    await userEvent.click(within(picker).getByRole('button', { name: 'waist' }));
    expect(legend.getAllByRole('button').map((b) => b.textContent)).toEqual(['waist_yaw', 'waist_roll', 'waist_pitch']);

    await userEvent.click(within(picker).getByRole('button', { name: 'hands' }));
    expect(legend.getAllByRole('button').map((b) => b.textContent)).toEqual(
      ['hand_index_0', 'hand_middle_0', 'hand_thumb_0', 'hand_index_1', 'hand_middle_1', 'hand_thumb_1', 'hand_thumb_2'],
    );
  });

  it('names them in the statistics table too', async () => {
    renderPage('?tab=statistics');
    const panel = within(await screen.findByTestId('dataset-stats-panel'));
    await waitFor(() => expect(panel.getByTestId('stats-row-0')).toBeInTheDocument());
    await userEvent.click(panel.getByRole('button', { name: 'arms' }));
    // Channel 8 is "arms[5]" by position.
    expect(within(panel.getByTestId('stats-row-8')).getAllByRole('cell')[0]).toHaveTextContent('right_shoulder_yaw_joint');
  });

  it('falls back to group and index when the names are placeholders', async () => {
    trainingApiMock.getDataset.mockResolvedValue({
      ...BOTTLES,
      infoJson: { features: features(NAMES.map((_, i) => `motor_${i}`)) } as unknown as Dataset['infoJson'],
    });
    renderPage();
    const legend = within(await screen.findByTestId('joint-chart-legend'));
    expect(legend.getByText('arms[5]')).toBeInTheDocument();
    expect(legend.getAllByRole('button')).toHaveLength(14);
    expect(legend.queryByText(/motor_/)).not.toBeInTheDocument();
  });

  it('falls back to group and index when state and action name a channel differently', async () => {
    // The chart draws state and action of a channel as one pair under one label.
    const stateNames = [...NAMES];
    [stateNames[4], stateNames[5]] = [stateNames[5]!, stateNames[4]!];
    trainingApiMock.getDataset.mockResolvedValue({
      ...BOTTLES,
      infoJson: {
        features: { ...features(NAMES), 'observation.state': { dtype: 'float32', shape: [WIDTH], names: stateNames } },
      } as unknown as Dataset['infoJson'],
    });
    renderPage();
    const legend = within(await screen.findByTestId('joint-chart-legend'));
    expect(legend.getByText('arms[1]')).toBeInTheDocument();
    expect(legend.queryByText(/shoulder/)).not.toBeInTheDocument();
  });

  it('reads names that info.json nests under a key', async () => {
    trainingApiMock.getDataset.mockResolvedValue({
      ...BOTTLES,
      infoJson: {
        features: {
          ...features(NAMES),
          'observation.state': { dtype: 'float32', shape: [WIDTH], names: { motors: NAMES } },
          action: { dtype: 'float32', shape: [WIDTH], names: { motors: NAMES } },
        },
      } as unknown as Dataset['infoJson'],
    });
    renderPage();
    const legend = within(await screen.findByTestId('joint-chart-legend'));
    expect(legend.getByRole('button', { name: 'elbow' })).toHaveAttribute('title', 'left_elbow_joint · right_elbow_joint');
  });
});

describe('the header of the episode page (TASK-494)', () => {
  it('says where a Hub import came from, linked at its commit, the whole commit on hover', async () => {
    trainingApiMock.getDataset.mockResolvedValue({
      ...BOTTLES,
      huggingFaceRepoId: 'ycchen0106/g1-apple-to-plate',
      sourceRevision: REVISION,
    });
    renderPage();

    const source = await screen.findByTestId('dataset-source');
    expect(source).toHaveTextContent(/Imported from Hugging Face:\s*ycchen0106\/g1-apple-to-plate/);
    expect(source).toHaveTextContent('at revision 37cb1d6e');
    expect(source).not.toHaveTextContent(`@${REVISION.slice(0, 8)}`);
    expect(within(source).getByRole('link')).toHaveAttribute(
      'href',
      `https://huggingface.co/datasets/ycchen0106/g1-apple-to-plate/tree/${REVISION}`,
    );
    expect(within(source).getByTitle(REVISION)).toBeInTheDocument();
  });

  it('shows no source line for a dataset that was not imported', async () => {
    renderPage();
    await screen.findByTestId('joint-chart-legend');
    expect(screen.queryByTestId('dataset-source')).not.toBeInTheDocument();
  });
});
