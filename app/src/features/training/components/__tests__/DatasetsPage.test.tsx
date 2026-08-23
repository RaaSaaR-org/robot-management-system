/**
 * @file DatasetsPage.test.tsx
 * @description The page's three counting-and-filtering bugs, from the outside.
 * @feature training
 *
 * Lives beside the component tests rather than under `pages/` because this
 * track owns `components/__tests__/**`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DatasetsPage } from '../../pages/DatasetsPage';
import { useTrainingStore } from '../../store';
import type { Dataset } from '../../types';

// `vi.mock` factories are hoisted above every `const` in the file, so the spies
// they close over have to be hoisted with them.
const { listDatasets, listRobotTypes, trainingApiMock } = vi.hoisted(() => {
  const listDatasetsFn = vi.fn();
  const listRobotTypesFn = vi.fn();
  return {
    listDatasets: listDatasetsFn,
    listRobotTypes: listRobotTypesFn,
    trainingApiMock: {
      listDatasets: listDatasetsFn,
      listRobotTypes: listRobotTypesFn,
      getEpisodeVideoUrl: () => 'about:blank',
      listTrainingJobs: vi.fn().mockResolvedValue({ jobs: [], pagination: {} }),
      checkCompatibility: vi.fn(),
      retryImport: vi.fn(),
      deleteDataset: vi.fn(),
    },
  };
});

vi.mock('../../api', () => ({ trainingApi: trainingApiMock }));
vi.mock('../../api/trainingApi', () => ({ trainingApi: trainingApiMock }));
vi.mock('../../api/syntheticApi', () => ({
  syntheticApi: {
    getConfig: vi.fn().mockResolvedValue({
      available: false, hasToken: false, embodiment: 'g1', maxEpisodes: 4,
      python: '', scriptPath: '', outRoot: '',
    }),
  },
}));

vi.mock('@/features/simulation/store/simulationStore', () => {
  const state = { scenes: [], scenesLoading: false, fetchScenes: async () => {} };
  return {
    useSimulationStore: (selector: (s: typeof state) => unknown) => selector(state),
    selectScenes: (s: typeof state) => s.scenes,
    selectScenesLoading: (s: typeof state) => s.scenesLoading,
  };
});

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-ready',
    name: 'Ready dataset',
    robotTypeId: 'rt-g1',
    storagePath: '/data/ds/',
    lerobotVersion: 'v3.0',
    fps: 30,
    totalFrames: 400,
    totalDuration: 13,
    demonstrationCount: 4,
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

/** The real pair on this machine: one good dataset and one failed import. */
const DATASETS = [
  dataset(),
  dataset({
    id: 'ds-groot',
    name: 'GR00T-N1.7-AppleToPlate',
    status: 'failed',
    totalFrames: 171625,
    huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
  }),
];

function page() {
  return render(
    <MemoryRouter>
      <DatasetsPage />
    </MemoryRouter>
  );
}

/** The value rendered under a stat tile's label. */
function stat(label: string): string {
  return screen.getByTestId(`stat-${label}`).textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  useTrainingStore.getState().reset();
  listDatasets.mockResolvedValue({
    datasets: DATASETS,
    pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
  });
  listRobotTypes.mockResolvedValue([
    { id: 'rt-g1', name: 'Unitree G1 EDU (Dex3-1)' },
    { id: 'rt-groot', name: 'unitree_g1' },
  ]);
});

describe('the stat tiles', () => {
  it('counts frames that exist, not frames a failed import read out of info.json', async () => {
    // 171,625 of the old total came from an import that downloaded nothing.
    page();
    await waitFor(() => expect(screen.getByTestId('stat-Total Frames')).toBeInTheDocument());
    expect(stat('Total Frames')).toBe('400');
    expect(stat('Total Frames')).not.toContain('171,625');
  });

  it('has a tile for the failed ones', async () => {
    page();
    await waitFor(() => expect(screen.getByTestId('stat-Failed')).toBeInTheDocument());
    expect(stat('Failed')).toBe('1');
    expect(stat('Ready')).toBe('1');
  });
});

describe('the filters', () => {
  it('offers the robot types the server actually has', async () => {
    // The three hardcoded slugs ("humanoid", "mobile", "arm") were matched
    // against a UUID column, so every option returned zero rows.
    page();
    const select = await screen.findByLabelText('Filter by robot type');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Unitree G1 EDU (Dex3-1)' })).toBeInTheDocument()
    );

    fireEvent.change(select, { target: { value: 'rt-g1' } });
    await waitFor(() =>
      expect(listDatasets).toHaveBeenCalledWith(expect.objectContaining({ robotTypeId: 'rt-g1' }))
    );
    expect(screen.queryByRole('option', { name: 'Humanoid' })).not.toBeInTheDocument();
  });

  it('hides the skill filter when no dataset carries a skill', async () => {
    page();
    await waitFor(() => expect(screen.getByLabelText('Filter by robot type')).toBeInTheDocument());
    expect(screen.queryByLabelText('Filter by skill')).not.toBeInTheDocument();
  });

  it('says "no match" rather than "no datasets yet" when a filter empties the list', async () => {
    page();
    const select = await screen.findByLabelText('Filter by robot type');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'unitree_g1' })).toBeInTheDocument()
    );

    listDatasets.mockResolvedValue({
      datasets: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    fireEvent.change(select, { target: { value: 'rt-groot' } });

    expect(await screen.findByText('No datasets match your filters.')).toBeInTheDocument();
    expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  });
});


// ===========================================================================
// An action that did not happen, and why
//
// Both `handleConfirmDelete` and `handleRetryImport` used to end in
// `console.error` alone. The operator clicked, nothing moved, and the reason
// was visible only with devtools open — including the 409 that names the
// training jobs still holding a dataset, which is the whole point of that
// refusal being written carefully.
// ===========================================================================

describe('when a delete or a retry is refused', () => {
  it('shows the server\u2019s reason for a refused delete', async () => {
    trainingApiMock.deleteDataset.mockRejectedValue({
      code: 'CONFLICT',
      message:
        '"GR00T-N1.7-AppleToPlate" is a member of 2 training jobs (job-a, job-b), so deleting it '
        + 'would leave those runs citing data that no longer exists.',
      statusCode: 409,
    });

    page();
    await waitFor(() => expect(screen.getAllByText('Ready dataset').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));

    const banner = await screen.findByTestId('dataset-action-error');
    expect(banner).toHaveTextContent('member of 2 training jobs');
    expect(banner).toHaveTextContent('job-a, job-b');
  });

  it('shows why a retry could not start', async () => {
    trainingApiMock.retryImport.mockRejectedValue({
      code: 'IN_PROGRESS',
      message: 'An import of this dataset is already running',
      statusCode: 409,
    });

    // The Retry button only appears on a row that carries a recorded reason,
    // which is the row this whole feature exists for.
    listDatasets.mockResolvedValue({
      datasets: [
        DATASETS[0],
        dataset({
          id: 'ds-groot',
          name: 'GR00T-N1.7-AppleToPlate',
          status: 'failed',
          huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
          importError: {
            phase: 'download',
            error: 'RustFS is unreachable at http://localhost:9000',
            repoId: 'nvidia/GR00T-N1.7-AppleToPlate',
            failedAt: '2026-08-23T01:20:11.361Z',
          },
        }),
      ],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });

    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry import' }));

    expect(await screen.findByTestId('dataset-action-error')).toHaveTextContent(
      'already running'
    );
  });
});
