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
import type { ModelCheckpoint, ModelVersion } from '@/features/deployment/types';

const checkCompatibility = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    checkCompatibility: (...a: unknown[]) => checkCompatibility(...a),
  },
}));

/**
 * The registry the "Continue from an existing model" mode reads. Mocked at the
 * hook so this file stays about the wizard: what the hook does — list the
 * models, then ask each one for the architecture its own run trained — is the
 * hook's own concern. It answers per architecture here because that filtering
 * is what the picker relies on. The fixtures live inside the factory because
 * `vi.mock` is hoisted above the module's own consts. (TASK-239)
 */
vi.mock('../../hooks/useInitFromModelVersions', () => {
  const version: ModelVersion = {
    id: 'mv-groot',
    skillId: 'skill-1',
    trainingJobId: 'job-1',
    name: 'GR00T-N1.7 AppleToPlate',
    sourceKind: 'training',
    parentModelVersionId: null,
    version: '1.0.0',
    artifactUri: 's3://models/mv-groot',
    trainingMetrics: {},
    validationMetrics: {},
    deploymentStatus: 'staging',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const checkpoint = (id: string, epoch: number): ModelCheckpoint => ({
    id,
    modelVersionId: 'mv-groot',
    trainingJobId: 'job-1',
    epoch,
    uri: `s3://checkpoints/${id}`,
    metrics: { loss: 0.081 },
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  const candidates = [
    {
      version,
      baseModel: 'groot_n1_7' as const,
      checkpoints: [checkpoint('cp-7', 7), checkpoint('cp-14', 14)],
    },
  ];

  return {
    useInitFromModelVersions: (baseModel: string) =>
      baseModel === 'groot_n1_7'
        ? { candidates, hiddenCount: 0, isLoading: false }
        : { candidates: [], hiddenCount: candidates.length, isLoading: false },
  };
});

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

  // -------------------------------------------------------------------------
  // Weights the server refuses.
  //
  // A weight is a sampling ratio, so finite-and-positive is the whole domain,
  // and the server rejects the rest. `Number('') === 0`, so clearing the box —
  // the most ordinary thing to do before typing a new number — used to submit
  // a member the trainer would never sample, with nothing said about it.
  // -------------------------------------------------------------------------

  it('will not submit a weight of zero, and says which dataset', async () => {
    const onSubmit = vi.fn();
    render(
      <TrainingJobWizard
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        datasets={DATASETS}
        initialMixture={[{ datasetId: 'ds-groot' }, { datasetId: 'ds-dex3' }]}
      />
    );

    const weight = await screen.findByLabelText('Weight for G1 Dex3 ObjectPlacement');
    fireEvent.change(weight, { target: { value: '' } });

    await advanceToReview();

    expect(await screen.findByTestId('bad-weight-notice')).toHaveTextContent(
      'G1 Dex3 ObjectPlacement'
    );
    expect(screen.getByRole('button', { name: 'Submit Training Job' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('will not submit a negative weight', async () => {
    render(
      <TrainingJobWizard
        isOpen
        onClose={() => {}}
        onSubmit={vi.fn()}
        datasets={DATASETS}
        initialMixture={[{ datasetId: 'ds-groot' }, { datasetId: 'ds-dex3' }]}
      />
    );
    const weight = await screen.findByLabelText('Weight for G1 Dex3 ObjectPlacement');
    fireEvent.change(weight, { target: { value: '-2' } });

    await advanceToReview();
    expect(screen.getByRole('button', { name: 'Submit Training Job' })).toBeDisabled();
  });

  // The api client rejects with a PLAIN OBJECT — `createApiError` in
  // api/client.ts returns `{code, message, details, statusCode}`, not an Error.
  // So `err instanceof Error ? err.message : fallback` always took the
  // fallback, and every message the server had carefully written — the
  // incompatible-mixture headline, the 409 naming the jobs holding a dataset —
  // was replaced on screen by a generic sentence.
  it('shows the server\u2019s message, not a generic fallback', async () => {
    const onSubmit = vi.fn().mockRejectedValue({
      code: 'BAD_REQUEST',
      message:
        'This mixture cannot be trained: 25 fps and 30 fps do not divide, so no subsampling aligns them.',
      statusCode: 400,
    });

    render(
      <TrainingJobWizard
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        datasets={DATASETS}
        initialMixture={[{ datasetId: 'ds-groot', weight: 3 }, { datasetId: 'ds-dex3', weight: 1 }]}
      />
    );
    await screen.findByLabelText('Weight for GR00T AppleToPlate');
    await advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('no subsampling aligns them');
    expect(alert).not.toHaveTextContent('Failed to submit training job');
  });

  it('says nothing when every weight is fine', async () => {
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

    expect(screen.queryByTestId('bad-weight-notice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Training Job' })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Starting from a model that already exists (TASK-239).
//
// `baseModel` used to be the only thing that said where the weights came from,
// so a run continuing a fine-tune was indistinguishable from one starting at
// the foundation model — on the review step and in the submitted body alike.
// ---------------------------------------------------------------------------

/** Open the wizard on the Model step with a dataset chosen. */
function renderOnModelStep(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<TrainingJobWizard isOpen onClose={() => {}} onSubmit={onSubmit} datasets={DATASETS} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // type → dataset
  fireEvent.click(screen.getByRole('button', { name: /GR00T AppleToPlate/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // dataset → model
  return onSubmit;
}

describe('continuing from an existing model', () => {
  it('blocks the Model step until a model is picked, and advances once one is', () => {
    renderOnModelStep();

    fireEvent.click(screen.getByRole('button', { name: /GR00T N1\.7/ }));
    fireEvent.click(screen.getByTestId('weights-source-existing'));

    // Continuing from nothing would silently fall back to the foundation
    // weights, which is the opposite of what was asked for.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Start from GR00T-N1.7 AppleToPlate'));
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('offers no model of another architecture, and stays blocked', () => {
    renderOnModelStep(); // baseModel is pi0 by default

    fireEvent.click(screen.getByTestId('weights-source-existing'));

    expect(screen.getByTestId('init-from-empty')).toHaveTextContent(
      'No registered model was trained as Pi0'
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('sends the picked model as initFromModelVersionId, and no checkpoint', async () => {
    const onSubmit = renderOnModelStep();

    fireEvent.click(screen.getByRole('button', { name: /GR00T N1\.7/ }));
    fireEvent.click(screen.getByTestId('weights-source-existing'));
    fireEvent.click(screen.getByLabelText('Start from GR00T-N1.7 AppleToPlate'));

    await advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0][0];
    expect(body.initFromModelVersionId).toBe('mv-groot');
    // A run starts from one set of weights; the server refuses a body with both.
    expect(body).not.toHaveProperty('initFromCheckpointId');
    // The architecture is still the architecture, not the origin.
    expect(body.baseModel).toBe('groot_n1_7');
  });

  it('sends only the checkpoint id when an epoch is picked', async () => {
    const onSubmit = renderOnModelStep();

    fireEvent.click(screen.getByRole('button', { name: /GR00T N1\.7/ }));
    fireEvent.click(screen.getByTestId('weights-source-existing'));
    fireEvent.click(screen.getByLabelText('Start from GR00T-N1.7 AppleToPlate'));
    fireEvent.change(screen.getByLabelText('Checkpoint'), { target: { value: 'cp-14' } });

    await advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0][0];
    expect(body.initFromCheckpointId).toBe('cp-14');
    expect(body).not.toHaveProperty('initFromModelVersionId');
  });

  it('names the starting model on the review step, not just the architecture', async () => {
    renderOnModelStep();

    fireEvent.click(screen.getByRole('button', { name: /GR00T N1\.7/ }));
    fireEvent.click(screen.getByTestId('weights-source-existing'));
    fireEvent.click(screen.getByLabelText('Start from GR00T-N1.7 AppleToPlate'));

    await advanceToReview();

    const startsFrom = screen.getByTestId('review-starts-from');
    expect(startsFrom).toHaveTextContent('GR00T-N1.7 AppleToPlate');
    expect(startsFrom).toHaveTextContent('(groot_n1_7)');
  });

  it('names the epoch when the run continues from a checkpoint', async () => {
    renderOnModelStep();

    fireEvent.click(screen.getByRole('button', { name: /GR00T N1\.7/ }));
    fireEvent.click(screen.getByTestId('weights-source-existing'));
    fireEvent.click(screen.getByLabelText('Start from GR00T-N1.7 AppleToPlate'));
    fireEvent.change(screen.getByLabelText('Checkpoint'), { target: { value: 'cp-14' } });

    await advanceToReview();

    expect(screen.getByTestId('review-starts-from')).toHaveTextContent(
      'Epoch 14 of GR00T-N1.7 AppleToPlate'
    );
  });

  it('leaves a foundation run exactly as it was', async () => {
    const onSubmit = renderOnModelStep();

    await advanceToReview();
    // Still the architecture, spelled the way it always was.
    expect(screen.getByTestId('review-starts-from')).toHaveTextContent('PI0');

    fireEvent.click(screen.getByRole('button', { name: 'Submit Training Job' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0][0];
    expect(body).not.toHaveProperty('initFromModelVersionId');
    expect(body).not.toHaveProperty('initFromCheckpointId');
  });

  it('drops a picked model when the architecture changes under it', () => {
    // The server refuses a run whose baseModel differs from the weights it
    // starts from, and the picker no longer lists that model at all — leaving
    // the id in the form would submit a body the server has to reject.
    renderOnModelStep();

    fireEvent.click(screen.getByRole('button', { name: /GR00T N1\.7/ }));
    fireEvent.click(screen.getByTestId('weights-source-existing'));
    fireEvent.click(screen.getByLabelText('Start from GR00T-N1.7 AppleToPlate'));
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /OpenVLA/ }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
