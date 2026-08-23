/**
 * @file TrainingJobWizard.test.tsx
 * @description What the wizard actually submits — including the two answers it
 *              used to collect and then drop.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TrainingJobWizard } from '../TrainingJobWizard';
import type { CompatibilityReport, Dataset } from '../../types';

const checkCompatibility = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    checkCompatibility: (...a: unknown[]) => checkCompatibility(...a),
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

function dataset(id: string, name: string): Dataset {
  return {
    id,
    name,
    robotTypeId: 'rt1',
    storagePath: `/data/${id}/`,
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
  };
}

const DATASETS = [
  dataset('ds-groot', 'GR00T AppleToPlate'),
  dataset('ds-dex3', 'G1 Dex3 ObjectPlacement'),
];

function report(verdict: CompatibilityReport['verdict']): CompatibilityReport {
  return {
    datasetIds: ['ds-groot', 'ds-dex3'],
    verdict,
    headline: 'headline',
    recommendation: 'recommendation',
    axes: [
      {
        axis: 'actionWidth',
        label: 'Action width',
        verdict: 'differs',
        values: [
          { datasetId: 'ds-groot', datasetName: 'GR00T AppleToPlate', value: '43' },
          { datasetId: 'ds-dex3', datasetName: 'G1 Dex3 ObjectPlacement', value: '28' },
        ],
        note: 'note',
      },
    ],
  };
}

/** Click Continue until the review step is on screen. */
async function advanceToReview(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const next = screen.queryByRole('button', { name: 'Continue' });
    if (!next) break;
    fireEvent.click(next);
    await waitFor(() => expect(document.body).toBeTruthy());
  }
  await screen.findByRole('button', { name: 'Submit Training Job' });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkCompatibility.mockResolvedValue(report('multi_embodiment'));
});

describe('what reaches the server', () => {
  it('sends the GPU type the wizard asked for', async () => {
    // It was collected on the Resources step and never put in the body, so
    // every job silently took the server default.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TrainingJobWizard isOpen onClose={() => {}} onSubmit={onSubmit} datasets={DATASETS} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));       // type → dataset
    fireEvent.click(screen.getByRole('button', { name: /GR00T AppleToPlate/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));       // dataset → model
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));       // model → hyperparams
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));       // hyperparams → gpu
    fireEvent.click(screen.getByRole('button', { name: 'A100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));       // gpu → review
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Training Job' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ gpuRequirements: { type: 'a100' } })
    );
  });

  it('leaves a single-dataset job exactly as it was', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TrainingJobWizard isOpen onClose={() => {}} onSubmit={onSubmit} datasets={DATASETS} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: /GR00T AppleToPlate/ }));
    await advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0][0];
    expect(body.datasetId).toBe('ds-groot');
    // One dataset is not a mixture, and the server's old path must stay the
    // path it takes.
    expect(body).not.toHaveProperty('mixture');
    expect(checkCompatibility).not.toHaveBeenCalled();
  });

  it('sends the mixture with the weights that were typed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TrainingJobWizard
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        datasets={DATASETS}
        initialMixture={[{ datasetId: 'ds-groot' }, { datasetId: 'ds-dex3' }]}
      />
    );

    // Pre-filled from the Datasets page, and open on the step that shows it.
    const weight = await screen.findByLabelText('Weight for G1 Dex3 ObjectPlacement');
    fireEvent.change(weight, { target: { value: '3' } });

    await advanceToReview();
    await screen.findByTestId('compatibility-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: 'ds-groot',
        mixture: [
          { datasetId: 'ds-groot', weight: 1 },
          { datasetId: 'ds-dex3', weight: 3 },
        ],
      })
    );
  });

  it('shows the mixture and its shares on the review step', async () => {
    render(
      <TrainingJobWizard
        isOpen
        onClose={() => {}}
        onSubmit={vi.fn()}
        datasets={DATASETS}
        initialMixture={[{ datasetId: 'ds-groot', weight: 3 }, { datasetId: 'ds-dex3', weight: 1 }]}
      />
    );
    await screen.findByLabelText('Weight for GR00T AppleToPlate');
    await advanceToReview();

    const summary = screen.getByTestId('review-mixture');
    expect(summary).toHaveTextContent('Mixture (2 datasets)');
    expect(summary).toHaveTextContent('75%');
    expect(summary).toHaveTextContent('25%');
  });

  it('refuses to submit a mixture the server would reject', async () => {
    checkCompatibility.mockResolvedValue(report('incompatible'));
    render(
      <TrainingJobWizard
        isOpen
        onClose={() => {}}
        onSubmit={vi.fn()}
        datasets={DATASETS}
        initialMixture={[{ datasetId: 'ds-groot' }, { datasetId: 'ds-dex3' }]}
      />
    );
    await screen.findByLabelText('Weight for GR00T AppleToPlate');
    await advanceToReview();
    await screen.findByTestId('compatibility-panel');

    // The reason is on screen next to the disabled button, rather than arriving
    // as a 400 after the modal has closed.
    expect(screen.getByRole('button', { name: 'Submit Training Job' })).toBeDisabled();
  });
});
