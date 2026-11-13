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
import { useDatasetUploadStore } from '../../store/datasetUploadStore';
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
    // Said as provenance, not as a second name under the title (TASK-493).
    expect(screen.getByText('From Hugging Face: lerobot/pusht@89d5752c · LeRobot v3.0')).toBeInTheDocument();
  });
});

describe('the table fits its panel (TASK-493)', () => {
  // The four names on the demo instance, and the robot type an import minted.
  const LIVE_NAMES = [
    'Apple to Plate — NVIDIA GR00T reference',
    'Apple to Plate — our G1 recording',
    'Object in Box — SO-101 community set',
    'Bottle Sorting — our G1 Dex3 simulation',
  ];
  const AUTO_TYPE = 'unitree_g1_dex3 (action 31, state 31)';
  const rows = LIVE_NAMES.map((name, i) => dataset({ id: `d${i}`, name }));
  const types = [{ id: 'rt1', name: AUTO_TYPE } as never];
  const headerOf = (label: string) => screen.getByRole('columnheader', { name: new RegExp(label) });

  it('gives the name column the slack and lets it shrink, with the whole name on hover', () => {
    render(<DatasetList datasets={rows} robotTypes={types} rowActions={() => [{ label: 'Delete', onSelect: () => {} }]} />);
    for (const name of LIVE_NAMES) {
      const label = screen.getByText(name);
      expect(label).toHaveAttribute('title', name);
      expect(label).toHaveClass('line-clamp-2');
      // `width: 100%; max-width: 0` on the cell: it takes what is left and never more.
      expect(label.closest('td')).toHaveClass('sm:w-full', 'sm:max-w-0');
    }
    expect(screen.getAllByRole('button', { name: /^Actions for / })).toHaveLength(4);
  });

  it('keeps a long robot type to two lines of a fixed width, whole on hover', () => {
    render(<DatasetList datasets={rows.slice(0, 1)} robotTypes={types} />);
    const cell = screen.getByText(AUTO_TYPE);
    expect(cell).toHaveAttribute('title', AUTO_TYPE);
    expect(cell).toHaveClass('line-clamp-2', 'w-40');
  });

  it('folds the low-value columns away as the window narrows, status and name last', () => {
    render(<DatasetList datasets={rows} robotTypes={types} />);
    expect(headerOf('Frames')).toHaveClass('hidden', '2xl:table-cell');
    expect(headerOf('Duration')).toHaveClass('hidden', 'min-[1440px]:table-cell');
    expect(headerOf('Robot type')).toHaveClass('hidden', 'xl:table-cell');
    expect(headerOf('Updated')).toHaveClass('hidden', 'xl:table-cell');
    expect(headerOf('Episodes')).toHaveClass('hidden', 'sm:table-cell');
    expect(headerOf('Name')).not.toHaveClass('hidden');
    expect(headerOf('Status')).not.toHaveClass('hidden');
  });

  it('shows the duration under the episode count until it has a column of its own', () => {
    render(<DatasetList datasets={[dataset({ totalDuration: 1857, demonstrationCount: 80 })]} />);
    const inline = screen.getByTestId('dataset-duration-inline');
    expect(inline).toHaveTextContent('30m 57s');
    expect(inline).toHaveClass('min-[1440px]:hidden');
    expect(inline.closest('td')).toHaveTextContent('80');
  });

  it('keeps an upload inside the same fixed-width status cell as a bare tag', () => {
    useDatasetUploadStore.setState({
      job: { datasetId: 'up', phase: 'uploading', sentBytes: 55_100_000, totalBytes: 425_000_000 } as never,
    });
    render(
      <DatasetList
        datasets={[dataset({ id: 'up', name: 'Uploading one', status: 'uploading' }), dataset({ id: 'ok', name: 'Ready one' })]}
      />,
    );
    const cells = screen.getAllByTestId('dataset-status-cell');
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect(cell).toHaveClass('w-28', 'sm:w-36', 'min-w-0');

    const progress = screen.getByTestId('upload-progress-up');
    expect(progress.closest('[data-testid="dataset-status-cell"]')).not.toBeNull();
    // As wide as its cell, never a width of its own; the byte line truncates.
    expect(progress).toHaveClass('w-full', 'min-w-0');
    expect(progress.className).not.toMatch(/w-44/);
    const line = within(progress).getByText(/MB/);
    expect(line).toHaveClass('truncate');
    expect(line).toHaveAttribute('title', line.textContent);
    useDatasetUploadStore.setState({ job: null });
  });

  it('keeps a failed import’s reason inside the status cell, however long it is', () => {
    render(
      <DatasetList
        datasets={[dataset({
          id: 'f',
          status: 'failed',
          huggingFaceRepoId: 'some-org/broken',
          importError: {
            phase: 'downloading',
            error: 'Hub answered 404 for meta/episodes/chunk-000/file-000.parquet at revision 37cb1d6e',
            repoId: 'some-org/broken',
            failedAt: '2026-10-12T00:00:00Z',
          },
        })]}
      />,
    );
    const box = screen.getByTestId('dataset-import-error');
    // The tooltip's wrappers shrink to fit, so `w-full` there is the text's own
    // width: the box carries the cell's width itself and the line truncates in it.
    expect(box).toHaveClass('w-28', 'sm:w-36', 'min-w-0');
    expect(box).not.toHaveClass('w-full');
    expect(within(box).getByText(/Hub answered 404/)).toHaveClass('truncate', 'max-w-full');
  });
});
