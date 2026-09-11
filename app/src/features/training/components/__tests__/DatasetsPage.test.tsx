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
import { FeedbackProvider } from '@/shared/components/ui';
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
      <FeedbackProvider>
        <DatasetsPage />
      </FeedbackProvider>
    </MemoryRouter>
  );
}

/** Opens a row's menu and picks one item. */
async function rowAction(rowName: string, item: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${rowName}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
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

describe('the counts', () => {
  it('counts ready and failed rows in the status filter', async () => {
    page();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Ready (1)' })).toBeInTheDocument()
    );
    expect(screen.getByRole('option', { name: 'Failed (1)' })).toBeInTheDocument();
  });

  it('shows frames a ready dataset has, and offers training only for ready ones', async () => {
    // 171,625 frames came from an import that downloaded nothing; the row says
    // so by being failed, and the next-step banner counts only the ready one.
    page();
    await waitFor(() => expect(screen.getByText('Ready dataset')).toBeInTheDocument());
    expect(screen.getByText('1 dataset is ready to train on.')).toBeInTheDocument();
  });
});

describe('the filters', () => {
  it('offers the robot types the server actually has', async () => {
    // The three hardcoded slugs ("humanoid", "mobile", "arm") were matched
    // against a UUID column, so every option returned zero rows.
    page();
    const select = await screen.findByLabelText('Robot type');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Unitree G1 EDU (Dex3-1)' })).toBeInTheDocument()
    );

    fireEvent.change(select, { target: { value: 'rt-g1' } });
    await waitFor(() =>
      expect(listDatasets).toHaveBeenCalledWith(expect.objectContaining({ robotTypeId: 'rt-g1' }))
    );
    expect(screen.queryByRole('option', { name: 'Humanoid' })).not.toBeInTheDocument();
  });

  it('names the robot type in the table', async () => {
    page();
    await waitFor(() => expect(screen.getAllByText('Unitree G1 EDU (Dex3-1)').length).toBeGreaterThan(1));
  });

  it('says "no match" rather than "no datasets yet" when a filter empties the list', async () => {
    page();
    const select = await screen.findByLabelText('Robot type');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'unitree_g1' })).toBeInTheDocument()
    );

    listDatasets.mockResolvedValue({
      datasets: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    fireEvent.change(select, { target: { value: 'rt-groot' } });

    expect(await screen.findByText('No datasets match')).toBeInTheDocument();
    expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// An action that did not happen, and why
//
// Both the delete and the retry used to end in `console.error` alone. The
// operator clicked, nothing moved, and the reason was visible only with
// devtools open — including the 409 that names the training jobs still
// holding a dataset. The reason now arrives as an error toast.
// ===========================================================================

describe('when a delete or a retry is refused', () => {
  it('shows the server’s reason for a refused delete', async () => {
    trainingApiMock.deleteDataset.mockRejectedValue({
      code: 'CONFLICT',
      message:
        '"GR00T-N1.7-AppleToPlate" is a member of 2 training jobs (job-a, job-b), so deleting it '
        + 'would leave those runs citing data that no longer exists.',
      statusCode: 409,
    });

    page();
    await rowAction('Ready dataset', 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete Ready dataset?');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText("Couldn't delete dataset")).toBeInTheDocument();
    expect(screen.getByText(/member of 2 training jobs \(job-a, job-b\)/)).toBeInTheDocument();
  });

  it('shows why a retry could not start', async () => {
    trainingApiMock.retryImport.mockRejectedValue({
      code: 'IN_PROGRESS',
      message: 'An import of this dataset is already running',
      statusCode: 409,
    });

    page();
    await rowAction('GR00T-N1.7-AppleToPlate', 'Retry import');

    expect(await screen.findByText("Couldn't restart the import")).toBeInTheDocument();
    expect(screen.getByText('An import of this dataset is already running')).toBeInTheDocument();
  });
});
