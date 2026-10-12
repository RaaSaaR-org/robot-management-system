/**
 * @file ImportProgress.test.tsx
 * @description The import progress bar (#370): bytes before files, a phase
 *              that cannot be measured shows an indeterminate bar rather than
 *              a fake 0 % or 100 %, and a failed import stops where it was —
 *              with the reason and a retry in the panel.
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api/trainingApi', () => ({
  trainingApi: { getImportLog: vi.fn().mockResolvedValue(null), getDataset: vi.fn().mockRejectedValue(new Error('n/a')) },
}));

import { ImportProgress, importProgressView } from '../ImportProgress';
import { ImportActivityPanel } from '../ImportActivity';
import { useImportJobsStore, type ImportJob } from '../../store/importJobsStore';
import { useTrainingStore } from '../../store/trainingStore';

const BASE: ImportJob = {
  datasetId: 'ds-1',
  label: 'unitree/g1',
  state: 'running',
  phase: null,
  progress: 0,
  currentFile: null,
  completedFiles: null,
  totalFiles: null,
  downloadedBytes: null,
  totalBytes: null,
  importMode: null,
  error: null,
  revision: null,
  lerobotVersion: null,
  lines: [],
  dropped: 0,
  logRetained: true,
  startedAt: '2026-10-12T10:00:00Z',
  endedAt: null,
  notify: true,
};

const job = (over: Partial<ImportJob>): ImportJob => ({ ...BASE, ...over });

beforeEach(() => {
  useImportJobsStore.setState({ jobs: {}, order: [], panelOpen: false, focusedId: null });
});

describe('importProgressView', () => {
  it('measures the download in bytes, with both counts beside it', () => {
    const view = importProgressView(job({
      phase: 'downloading', downloadedBytes: 512 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024,
      completedFiles: 12, totalFiles: 40, importMode: 'full',
    }));
    expect(view).toEqual({ phase: 'Downloading', percent: 25, counts: '512 MB / 2.0 GB · 12 / 40 files' });
  });

  it('falls back to files when the Hub did not size every file', () => {
    const view = importProgressView(job({ phase: 'downloading', completedFiles: 3, totalFiles: 4, totalBytes: null }));
    expect(view).toEqual({ phase: 'Downloading', percent: 75, counts: '3 / 4 files' });
  });

  it('says a metadata-only import leaves the videos out', () => {
    expect(importProgressView(job({ phase: 'downloading', totalFiles: 4, completedFiles: 0, importMode: 'metadata' })).phase)
      .toBe('Downloading (no videos)');
  });

  it('is unmeasured — not 0 % — while reading metadata, starting, or with nothing to count', () => {
    expect(importProgressView(job({ phase: 'metadata' })).percent).toBeNull();
    expect(importProgressView(job({ phase: null })).percent).toBeNull();
    expect(importProgressView(job({ phase: 'downloading' })).percent).toBeNull();
  });

  it('is unmeasured — not 100 % — while validating: downloaded is not valid', () => {
    const view = importProgressView(job({ phase: 'validating', completedFiles: 40, totalFiles: 40, downloadedBytes: 9, totalBytes: 9 }));
    expect(view).toEqual({ phase: 'Validating', percent: null, counts: '40 / 40 files downloaded' });
  });

  it('stops a failed import where it was', () => {
    const view = importProgressView(job({
      state: 'failed', phase: 'downloading', downloadedBytes: 300, totalBytes: 1000, error: 'terminated',
    }));
    expect(view.phase).toBe('Stopped while downloading');
    expect(view.percent).toBe(30);
  });
});

describe('ImportProgress', () => {
  it('shows an indeterminate bar while metadata is read', () => {
    render(<ImportProgress job={job({ phase: 'metadata' })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-indeterminate');
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('shows the byte percent and counts while downloading', () => {
    render(<ImportProgress job={job({ phase: 'downloading', downloadedBytes: 600, totalBytes: 1000, completedFiles: 1, totalFiles: 2 })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('data-indeterminate');
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('600 B / 1000 B · 1 / 2 files')).toBeInTheDocument();
  });
});

describe('a failed import in the panel', () => {
  it('shows the frozen bar, the persisted reason, and retries the import', async () => {
    const retryImport = vi.fn().mockResolvedValue(undefined);
    useTrainingStore.setState({ retryImport });
    act(() => {
      useImportJobsStore.setState({
        jobs: { 'ds-1': job({ state: 'failed', phase: 'downloading', downloadedBytes: 300, totalBytes: 1000, error: 'terminated' }) },
        order: ['ds-1'],
      });
    });
    render(<ImportActivityPanel />);

    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('data-indeterminate');
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getByTestId('import-job-error')).toHaveTextContent('terminated');

    fireEvent.click(screen.getByRole('button', { name: /retry import/i }));
    await waitFor(() => expect(retryImport).toHaveBeenCalledWith('ds-1'));
    await waitFor(() => expect(useImportJobsStore.getState().jobs['ds-1']!.state).toBe('running'));
  });
});
