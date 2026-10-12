/**
 * @file ImportActivity.test.tsx
 * @description The top-bar import indicator and its panel (TASK-352).
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api/trainingApi', () => ({
  trainingApi: { getImportLog: vi.fn(), getDataset: vi.fn().mockRejectedValue(new Error('n/a')) },
}));

import { ImportActivity, describeJob } from '../ImportActivity';
import { useImportJobsStore } from '../../store/importJobsStore';

const store = () => useImportJobsStore.getState();

beforeEach(() => {
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
});
