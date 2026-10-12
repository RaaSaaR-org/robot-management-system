/**
 * @file ImportActivity.test.tsx
 * @description The top-bar import indicator and its panel (TASK-352).
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const cancelImport = vi.fn();
vi.mock('../../api/trainingApi', () => ({
  trainingApi: {
    getImportLog: vi.fn(),
    getDataset: vi.fn().mockRejectedValue(new Error('n/a')),
    cancelImport: (...a: unknown[]) => cancelImport(...a),
  },
}));

import { ImportActivity, describeJob } from '../ImportActivity';
import { useImportJobsStore } from '../../store/importJobsStore';

const store = () => useImportJobsStore.getState();

beforeEach(() => {
  cancelImport.mockReset();
  useImportJobsStore.setState({ jobs: {}, order: [], panelOpen: false, focusedId: null });
});

describe('ImportActivity', () => {
  it('renders nothing while no import is tracked', () => {
    const { container } = render(<ImportActivity />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts running imports on the button and opens the panel with the live log', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().applyMessage({
        type: 'dataset:import:progress',
        datasetId: 'ds-1',
        importProgress: { status: 'importing', phase: 'downloading', progress: 50, completedFiles: 2, totalFiles: 4 },
      });
      store().applyMessage({
        type: 'dataset:import:log',
        datasetId: 'ds-1',
        log: { at: '2026-10-12T10:00:00Z', level: 'info', message: 'Downloaded data/chunk-000/file-000.parquet (2/4)' },
      });
    });
    render(<ImportActivity />);

    const button = screen.getByTestId('import-activity-button');
    expect(button).toHaveAccessibleName('1 dataset import running');
    fireEvent.click(button);

    expect(screen.getByTestId('import-activity-panel')).toBeInTheDocument();
    expect(screen.getByText('Downloading 2 / 4 files')).toBeInTheDocument();
    // The job just tracked is the focused one, so its log is open.
    expect(screen.getByTestId('import-job-log')).toHaveTextContent('Downloaded data/chunk-000/file-000.parquet (2/4)');
  });

  it('shows how a failed import ended, with the reason, and lets it be dismissed', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().applyMessage({ type: 'dataset:import:failed', datasetId: 'ds-1', error: 'Failed to download: 500' });
      store().openPanel();
    });
    render(<ImportActivity />);

    expect(screen.getByTestId('import-job-error')).toHaveTextContent('Failed to download: 500');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss lerobot/pusht' }));
    expect(store().order).toEqual([]);
  });

  it('names the pinned commit and LeRobot version, and says the cause of a failure first (TASK-358)', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht', { revision: '89d5752c021e580d26d90ceec7e8192ef01e7c30', lerobotVersion: 'v3.0' });
      store().applyMessage({
        type: 'dataset:import:failed',
        datasetId: 'ds-1',
        error: 'File data/chunk-000/file-000.parquet: write to rustfs failed after 3 attempt(s): connect ECONNREFUSED 10.0.0.1:9000',
      });
      store().openPanel();
    });
    render(<ImportActivity />);

    expect(screen.getByTestId('import-job-revision')).toHaveTextContent('@89d5752c');
    expect(screen.getByTestId('import-job-version')).toHaveTextContent('LeRobot v3.0');
    expect(screen.getByTestId('import-job-error')).toHaveTextContent(/^Storage unreachable \(ECONNREFUSED\)$/);
  });

  it('closes the panel on Escape', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().openPanel();
    });
    render(<ImportActivity />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(store().panelOpen).toBe(false);
  });
});

describe('describeJob', () => {
  it('says "Starting" before the first progress frame', () => {
    act(() => store().track('ds-1', 'x'));
    expect(describeJob(store().jobs['ds-1']!)).toBe('Starting');
  });

  it('cancels a running import from its row and then offers a retry (TASK-371)', async () => {
    cancelImport.mockResolvedValue({ datasetId: 'ds-1', status: 'cancelled' });
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().openPanel();
    });
    render(<ImportActivity />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel lerobot/pusht' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-job-cancel-confirm-confirm'));
    });

    expect(cancelImport).toHaveBeenCalledWith('ds-1');
    expect(screen.getByTestId('import-job-ds-1')).toHaveTextContent('Cancelled');
    expect(screen.queryByTestId('import-job-cancel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry import' })).toBeInTheDocument();
    expect(screen.queryByTestId('import-job-error')).not.toBeInTheDocument();
  });

  it('asks before cancelling: one click does not cancel (TASK-378)', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().openPanel();
    });
    render(<ImportActivity />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel lerobot/pusht' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Cancel the import of lerobot/pusht?');
    expect(dialog).toHaveTextContent('The files downloaded so far are discarded.');
    expect(cancelImport).not.toHaveBeenCalled();
    expect(screen.getByTestId('import-job-ds-1')).not.toHaveTextContent('Cancelled');
  });

  it('keeps importing when the confirmation is dismissed (TASK-378)', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().openPanel();
    });
    render(<ImportActivity />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel lerobot/pusht' }));
    fireEvent.pointerDown(screen.getByTestId('import-job-cancel-confirm-cancel'));
    fireEvent.click(screen.getByTestId('import-job-cancel-confirm-cancel'));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cancelImport).not.toHaveBeenCalled();
    // The click inside the dialog did not count as a click outside the panel.
    expect(store().panelOpen).toBe(true);
    expect(screen.getByTestId('import-job-cancel')).toBeInTheDocument();
  });

  it('Escape dismisses the confirmation without closing the panel (TASK-378)', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().openPanel();
    });
    render(<ImportActivity />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel lerobot/pusht' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cancelImport).not.toHaveBeenCalled();
    expect(store().panelOpen).toBe(true);
  });

  it('offers no cancel once the import is validating (TASK-371)', () => {
    act(() => {
      store().track('ds-1', 'lerobot/pusht');
      store().applyMessage({
        type: 'dataset:import:progress',
        datasetId: 'ds-1',
        importProgress: { status: 'validating', phase: 'validating', progress: 90 },
      });
      store().openPanel();
    });
    render(<ImportActivity />);

    expect(screen.queryByTestId('import-job-cancel')).not.toBeInTheDocument();
  });
});
