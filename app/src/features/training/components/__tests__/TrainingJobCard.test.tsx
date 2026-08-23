/**
 * @file TrainingJobCard.test.tsx
 * @description What a run says it was trained on, and what the export says will
 *              not travel with it.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TrainingJobCard } from '../TrainingJobCard';
import type { TrainingJob, TrainingRunManifest } from '../../types';

const exportTrainingRun = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    exportTrainingRun: (...a: unknown[]) => exportTrainingRun(...a),
  },
}));

function job(over: Partial<TrainingJob> = {}): TrainingJob {
  return {
    id: 'job-1',
    kind: 'supervised',
    datasetId: 'ds-groot',
    baseModel: 'groot_n1_7',
    fineTuneMethod: 'lora',
    hyperparameters: { learning_rate: 1e-4, batch_size: 16, epochs: 20 },
    gpuRequirements: { count: 1, memory: 40 },
    status: 'completed',
    progress: 100,
    metrics: {},
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

function manifest(warnings: string[]): TrainingRunManifest {
  return {
    schemaVersion: 'neodem.training.run/v1',
    runId: 'job-1',
    createdAt: '2026-08-23T02:00:00.000Z',
    sourceServer: 'http://localhost:3001',
    job: { kind: 'supervised', baseModel: 'groot_n1_7', fineTuneMethod: 'lora', status: 'completed' },
    datasets: [],
    compatibility: {
      datasetIds: ['ds-groot'],
      verdict: 'identical',
      headline: 'One dataset.',
      recommendation: 'Nothing to reconcile.',
      axes: [],
    },
    hyperparameters: {},
    gpu: { count: 1, memory: 40 },
    runtime: { image: 'neodem/trainer:dev', command: ['train'] },
    compliance: { datasetLicenses: ['cc-by-4.0'], residency: null, notes: [] },
    warnings,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  exportTrainingRun.mockResolvedValue(manifest([]));
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(),
  });
});

describe('the mixture a job trains on', () => {
  it('lists every member with its weight and share', () => {
    render(<TrainingJobCard job={job({
      datasets: [
        { datasetId: 'ds-groot', name: 'GR00T AppleToPlate', weight: 3, position: 0 },
        { datasetId: 'ds-dex3', name: 'G1 Dex3 ObjectPlacement', weight: 1, position: 1 },
      ],
    })} />);

    const mixture = screen.getByTestId('job-mixture');
    expect(mixture).toHaveTextContent('Mixture · 2 datasets');
    expect(mixture).toHaveTextContent('GR00T AppleToPlate');
    expect(mixture).toHaveTextContent('weight 3 · 75%');
    expect(mixture).toHaveTextContent('weight 1 · 25%');
  });

  it('does not label a single dataset a mixture', () => {
    render(<TrainingJobCard job={job({
      datasets: [{ datasetId: 'ds-groot', name: 'GR00T AppleToPlate', weight: 1, position: 0 }],
    })} />);
    const mixture = screen.getByTestId('job-mixture');
    expect(mixture).toHaveTextContent('Dataset');
    expect(mixture).not.toHaveTextContent('Mixture');
  });
});

describe('exporting a run', () => {
  it('surfaces the manifest warnings on the card', async () => {
    // The warning that a `file://` dataset cannot be reached from a cluster is
    // the whole point of the manifest carrying warnings. Leaving it inside the
    // downloaded JSON means it is read after the run has already failed.
    exportTrainingRun.mockResolvedValue(
      manifest(['Dataset "TASK-217 v3.0 post-fix" is a file:// path — a cluster elsewhere cannot read it.'])
    );

    render(<TrainingJobCard job={job()} />);
    fireEvent.click(screen.getByRole('button', { name: /Export run/ }));

    expect(await screen.findByTestId('export-warnings')).toHaveTextContent(
      'a cluster elsewhere cannot read it'
    );
    expect(exportTrainingRun).toHaveBeenCalledWith('job-1');
  });

  it('hands the manifest to the browser as a file', async () => {
    // jsdom does not perform downloads, so asserting `createObjectURL` was
    // called proves almost nothing — deleting `anchor.click()` entirely leaves
    // that assertion green. What CAN be observed is the state of the anchor at
    // the moment it is clicked, and both of the ways this silently produces no
    // file are visible there.
    const state: Array<{ inDocument: boolean; download: string; href: string }> = [];
    // True only for as long as the synchronous stack that ran `click()` is
    // still unwound. A microtask is the earliest thing that can run after it.
    let inClickStack = false;
    let revokedInClickStack = false;
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      if (inClickStack) revokedInClickStack = true;
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        state.push({
          inDocument: document.body.contains(this),
          download: this.download,
          href: this.href,
        });
        inClickStack = true;
        queueMicrotask(() => { inClickStack = false; });
      });

    render(<TrainingJobCard job={job()} />);
    fireEvent.click(screen.getByRole('button', { name: /Export run/ }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    await screen.findByTestId('export-clean');

    // Firefox does not download from a detached anchor — it just does nothing,
    // while Chrome and Safari do, which is how this ships looking fine.
    expect(state[0].inDocument).toBe(true);
    // Revoking in the same tick as the click cancels the download before the
    // browser has fetched the blob.
    expect(revokedInClickStack).toBe(false);
    expect(state[0].download).toMatch(/\.json$/);
    expect(state[0].href).toMatch(/^blob:/);

    // …and it is still cleaned up afterwards, rather than leaking for the life
    // of the document.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('says so when the export fails instead of failing silently', async () => {
    // A plain object, which is what `createApiError` in api/client.ts rejects
    // with — not an Error. See the note in DatasetCompatibilityPanel.test.tsx.
    exportTrainingRun.mockRejectedValue({
      code: 'NOT_FOUND',
      message: 'job has no dataset',
      statusCode: 404,
    });
    render(<TrainingJobCard job={job()} />);
    fireEvent.click(screen.getByRole('button', { name: /Export run/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('job has no dataset');
  });

  it('does not open the job while exporting it', async () => {
    const onClick = vi.fn();
    render(<TrainingJobCard job={job()} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Export run/ }));

    await waitFor(() => expect(exportTrainingRun).toHaveBeenCalled());
    expect(onClick).not.toHaveBeenCalled();
  });
});
