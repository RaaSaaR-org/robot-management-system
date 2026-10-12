/**
 * @file DatasetList.test.tsx
 * @description The status filter's missing option, the difference between an
 *              empty list and a filtered one, and the mixture picker.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DatasetList } from '../DatasetList';
import { useImportJobsStore } from '../../store/importJobsStore';
import { CompatibilityModal } from '../datasets/CompatibilityModal';
import type { Dataset } from '../../types';

vi.mock('../../api/trainingApi', () => ({
  trainingApi: { getEpisodeVideoUrl: () => 'about:blank' },
}));

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds1',
    name: 'GR00T AppleToPlate',
    robotTypeId: 'rt1',
    storagePath: '/data/ds1/',
    lerobotVersion: 'v2.1',
    fps: 30,
    totalFrames: 1000,
    totalDuration: 33,
    demonstrationCount: 5,
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

describe('the status filter', () => {
  it('can filter to importing, which is a status a dataset really has', () => {
    // `importing` was missing from the options, so a row stuck mid-import was
    // reachable only by "All Status".
    render(
      <DatasetList
        datasets={[
          dataset({ id: 'a', name: 'Ready one' }),
          dataset({ id: 'b', name: 'Importing one', status: 'importing' }),
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'importing' } });
    expect(screen.getByText('Importing one')).toBeInTheDocument();
    expect(screen.queryByText('Ready one')).not.toBeInTheDocument();
  });
});

describe('an empty table', () => {
  it('says "no match" when a filter is what emptied it', () => {
    // Otherwise the page tells someone with eleven datasets to import their
    // first one.
    render(<DatasetList datasets={[]} filtersActive />);
    expect(screen.getByText('No datasets match')).toBeInTheDocument();
    expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  });

  it('still offers the first-run copy when there is genuinely nothing', () => {
    render(<DatasetList datasets={[]} />);
    expect(screen.getByText('No datasets yet')).toBeInTheDocument();
  });
});

describe('mixture selection', () => {
  const two = [dataset(), dataset({ id: 'ds2', name: 'G1 Dex3 ObjectPlacement' })];

  it('cannot check compatibility until two are picked', () => {
    render(<CompatibilityModal isOpen onClose={() => {}} datasets={two} onContinue={() => {}} />);
    expect(screen.getByTestId('mixture-count')).toHaveTextContent('0 selected');
    expect(screen.getByRole('button', { name: /^Check/ })).toBeDisabled();
  });

  it('counts the selection and offers the next step', () => {
    render(
      <CompatibilityModal isOpen onClose={() => {}} datasets={two} initialIds={['ds1', 'ds2']} onContinue={() => {}} />
    );
    expect(screen.getByTestId('mixture-count')).toHaveTextContent('2 selected');
    expect(screen.getByRole('button', { name: 'Check 2 datasets' })).toBeEnabled();
  });

  it('reports a click on a checkbox as a selection', () => {
    render(<CompatibilityModal isOpen onClose={() => {}} datasets={two} onContinue={() => {}} />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select GR00T AppleToPlate for a training mixture' })
    );
    expect(screen.getByTestId('mixture-count')).toHaveTextContent('1 selected — pick another to compare them');
  });
});

describe('a Hub import in the list (#370)', () => {
  it('shows a live bar with bytes and files on the importing row', () => {
    useImportJobsStore.setState({ jobs: {}, order: [], panelOpen: false, focusedId: null });
    useImportJobsStore.getState().track('imp', 'unitree/g1');
    useImportJobsStore.getState().applyMessage({
      type: 'dataset:import:progress',
      datasetId: 'imp',
      importProgress: {
        status: 'importing', phase: 'downloading', progress: 50,
        downloadedBytes: 512, totalBytes: 1024, completedFiles: 1, totalFiles: 2,
      },
    });
    render(<DatasetList datasets={[dataset({ id: 'imp', status: 'importing', huggingFaceRepoId: 'unitree/g1' })]} />);

    const cell = screen.getByTestId('import-progress-imp');
    expect(within(cell).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(cell).toHaveTextContent('Downloading 50% · 512 B / 1.0 KB · 1 / 2 files');
  });

  it('shows an indeterminate bar, not 0 %, for an import with nothing measured yet', () => {
    useImportJobsStore.setState({ jobs: {}, order: [], panelOpen: false, focusedId: null });
    render(<DatasetList datasets={[dataset({ id: 'imp', status: 'importing', huggingFaceRepoId: 'unitree/g1' })]} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-indeterminate');
  });

  it('puts the persisted failure reason on a failed row', () => {
    render(
      <DatasetList
        datasets={[dataset({
          id: 'f',
          status: 'failed',
          huggingFaceRepoId: 'unitree/g1',
          importError: { phase: 'downloading', error: 'terminated', repoId: 'unitree/g1', failedAt: '2026-10-12T00:00:00Z' },
        })]}
      />,
    );
    expect(screen.getByTestId('dataset-import-error')).toHaveTextContent('terminated');
  });

  it('says the cause of a storage failure first (TASK-358)', () => {
    render(
      <DatasetList
        datasets={[dataset({
          id: 'f',
          status: 'failed',
          huggingFaceRepoId: 'unitree/g1',
          importError: {
            phase: 'downloading',
            error: 'File data/chunk-000/file-000.parquet: write to rustfs failed after 3 attempt(s): connect ECONNREFUSED 10.0.0.1:9000',
            repoId: 'unitree/g1',
            failedAt: '2026-10-12T00:00:00Z',
          },
        })]}
      />,
    );
    expect(screen.getByTestId('dataset-import-error')).toHaveTextContent('Storage unreachable (ECONNREFUSED)');
    expect(screen.getByTestId('dataset-import-error')).not.toHaveTextContent('file-000.parquet');
  });

  it('names the pinned commit and LeRobot version of a Hub import (TASK-358)', () => {
    render(
      <DatasetList
        datasets={[dataset({
          id: 'h', huggingFaceRepoId: 'lerobot/pusht', lerobotVersion: 'v3.0',
          sourceRevision: '89d5752c021e580d26d90ceec7e8192ef01e7c30',
        })]}
      />,
    );
    expect(screen.getByText('lerobot/pusht@89d5752c · LeRobot v3.0')).toBeInTheDocument();
  });
});
