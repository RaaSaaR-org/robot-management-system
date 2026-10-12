/**
 * @file DatasetExpectationsPanel.test.tsx
 * @description The TASK-353 recovery UI: observed vs expected widths, changing
 *              the robot type, defining a 43-wide configuration, and
 *              revalidating the stored files; plus the TASK-363 one-line summary,
 *              the immediate Validating badge and readable unknown types.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  DatasetExpectationsPanel,
  EXPECTATIONS_MAX_POLLS,
  EXPECTATIONS_POLL_MS,
} from '../datasets/DatasetExpectationsPanel';
import type { Dataset, RobotType } from '../../types';

const api = vi.hoisted(() => ({
  listRobotTypes: vi.fn(),
  reassociateRobotType: vi.fn(),
  revalidateDataset: vi.fn(),
  createRobotType: vi.fn(),
  getDataset: vi.fn(),
  getValidationProgress: vi.fn(),
}));

vi.mock('../../api/trainingApi', () => ({ trainingApi: api }));

function robotType(id: string, name: string, dim: number): RobotType {
  return {
    id, name, manufacturer: 'Unitree', model: name, actionDim: dim, proprioceptionDim: dim,
    cameras: [], capabilities: [], limits: {} as RobotType['limits'], createdAt: '', updatedAt: '',
  };
}

const G1_28 = robotType('rt-28', 'Unitree_G1', 28);
const G1_43 = robotType('rt-43', 'Unitree G1 EDU (Dex3-1)', 43);

function failedDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: 'GR00T-N1.7-AppleToPlate',
    robotTypeId: 'rt-28',
    storagePath: '761261f3/',
    lerobotVersion: 'v2.1',
    fps: 30,
    totalFrames: 100,
    totalDuration: 3,
    demonstrationCount: 2,
    infoJson: { features: { 'observation.state': { shape: [43] }, action: { shape: [43] } } } as unknown as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'failed',
    createdAt: '',
    updatedAt: '',
    robotType: { id: 'rt-28', name: 'Unitree_G1', manufacturer: 'Unitree', model: 'Unitree_G1', actionDim: 28, proprioceptionDim: 28 },
    validation: {
      valid: false,
      lerobotVersion: 'v2.1',
      errors: [{ code: 'ROBOT_STATE_DIM_MISMATCH', message: 'observation.state is 43 wide' }],
      warnings: [],
      imageKeys: [],
      fileCount: 5,
      observedStateWidth: 43,
      observedActionWidth: 43,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listRobotTypes.mockResolvedValue([G1_28, G1_43]);
  api.getValidationProgress.mockResolvedValue({ status: 'validating', progress: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Render the panel and open it — it starts as one summary line (TASK-363). */
function renderOpen(dataset: Dataset, onDatasetChange = vi.fn()) {
  const utils = render(<DatasetExpectationsPanel dataset={dataset} onDatasetChange={onDatasetChange} />);
  fireEvent.click(screen.getByTestId('expectations-expand'));
  return utils;
}

/** Let `n` poll intervals pass and their promises settle. */
async function pollTimes(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(EXPECTATIONS_POLL_MS); });
  }
}

describe('DatasetExpectationsPanel', () => {
  it('shows observed widths beside the expected widths and the selected robot type', async () => {
    renderOpen(failedDataset());
    expect(screen.getByTestId('selected-robot-type')).toHaveTextContent('Unitree_G1');
    const state = screen.getByTestId('width-row-state');
    expect(within(state).getByText('43')).toBeInTheDocument();
    expect(within(state).getByText('28')).toBeInTheDocument();
    expect(within(state).getByText('mismatch')).toBeInTheDocument();
    expect(screen.getByText(/Observed \(parquet\)/)).toBeInTheDocument();
    await waitFor(() => expect(api.listRobotTypes).toHaveBeenCalled());
  });

  it('still renders when the robot-type list comes back without an array', async () => {
    // The demo build's catch-all `/datasets/:id` mock once answered this call
    // with a dataset, and the panel crashed the whole episodes page.
    api.listRobotTypes.mockResolvedValue(undefined);
    renderOpen(failedDataset());
    await waitFor(() => expect(api.listRobotTypes).toHaveBeenCalled());
    expect(screen.getByTestId('selected-robot-type')).toHaveTextContent('Unitree_G1');
  });

  it('reassociates with the chosen type and hands back the updated dataset', async () => {
    const updated = failedDataset({ status: 'validating', robotTypeId: 'rt-43' });
    api.reassociateRobotType.mockResolvedValue({ dataset: updated, change: {}, revalidation: 'started' });
    const onChange = vi.fn();
    renderOpen(failedDataset(), onChange);

    const select = await screen.findByLabelText('Robot type');
    await waitFor(() => expect(within(select).getByText(/Dex3-1.*widths match/)).toBeInTheDocument());
    // The current type is not offered as a change.
    expect(within(select).queryByText(/^Unitree_G1/)).toBeNull();
    fireEvent.change(select, { target: { value: 'rt-43' } });
    fireEvent.click(screen.getByTestId('reassociate-button'));

    await waitFor(() => expect(api.reassociateRobotType).toHaveBeenCalledWith('ds-1', 'rt-43', undefined));
    expect(onChange).toHaveBeenCalledWith(updated);
  });

  it('revalidates the existing files and shows the verdict once the pass reports one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.revalidateDataset.mockResolvedValue({ state: 'started' });
    const verdict = failedDataset({ status: 'ready' });
    api.getDataset.mockResolvedValue(verdict);
    const onChange = vi.fn();
    // The row stays `failed` while the pass runs — only the progress channel knows.
    renderOpen(failedDataset(), onChange);
    fireEvent.click(screen.getByTestId('revalidate-button'));
    await waitFor(() => expect(api.revalidateDataset).toHaveBeenCalledWith('ds-1'));
    await waitFor(() => expect(screen.getByTestId('validation-running')).toBeInTheDocument());
    expect(screen.getByTestId('revalidate-button')).toBeDisabled();

    api.getValidationProgress.mockResolvedValue({ status: 'ready', progress: 100 });
    await pollTimes(1);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(verdict));
    expect(screen.queryByTestId('validation-running')).toBeNull();
    expect(screen.getByTestId('revalidate-button')).not.toBeDisabled();
  });

  it('unlocks a row stuck in validating once polling gives up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getDataset.mockResolvedValue(failedDataset({ status: 'validating' }));
    renderOpen(failedDataset({ status: 'validating' }));
    expect(screen.getByTestId('revalidate-button')).toBeDisabled();
    await pollTimes(EXPECTATIONS_MAX_POLLS);
    await waitFor(() => expect(screen.getByTestId('validation-gave-up')).toBeInTheDocument());
    expect(screen.getByTestId('revalidate-button')).not.toBeDisabled();
    expect(api.getValidationProgress).toHaveBeenCalledTimes(EXPECTATIONS_MAX_POLLS);
  });

  it('shows why the last pass reached no verdict', () => {
    renderOpen(failedDataset({ validation: undefined, expectations: { invalidated: null, history: [], error: 'Storage unavailable — nothing was validated' } }));
    expect(screen.getByTestId('validation-error')).toHaveTextContent('Storage unavailable');
  });

  it('locks the controls while the dataset is importing or validating', () => {
    renderOpen(failedDataset({ status: 'importing' }));
    expect(screen.getByTestId('revalidate-button')).toBeDisabled();
    expect(screen.getByTestId('reassociate-button')).toBeDisabled();
    expect(screen.getByText(/Locked while the dataset is importing/)).toBeInTheDocument();
  });

  it('defines a new configuration, prefilled with the observed widths', async () => {
    const created = robotType('rt-new', 'Custom 43', 43);
    api.createRobotType.mockResolvedValue(created);
    renderOpen(failedDataset());
    fireEvent.click(screen.getByText('Define a new robot configuration'));
    const form = screen.getByTestId('new-robot-type-form');
    fireEvent.change(within(form).getAllByRole('textbox')[0], { target: { value: 'Custom 43' } });
    fireEvent.click(screen.getByText('Create configuration'));
    await waitFor(() => expect(api.createRobotType).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Custom 43', actionDim: 43, proprioceptionDim: 43,
    })));
  });

  it('collapses to one line when the verdict passes, and opens on demand (TASK-358)', async () => {
    const passing = failedDataset({
      status: 'ready',
      robotTypeId: 'rt-43',
      robotType: { id: 'rt-43', name: 'Unitree G1 EDU (Dex3-1)', manufacturer: 'Unitree', model: 'x', actionDim: 43, proprioceptionDim: 43 },
      validation: { ...failedDataset().validation!, valid: true, errors: [] },
    });
    render(<DatasetExpectationsPanel dataset={passing} onDatasetChange={vi.fn()} />);

    expect(screen.getByTestId('expectations-summary')).toHaveTextContent('Matches Unitree G1 EDU (Dex3-1) — state 43, action 43');
    expect(screen.queryByTestId('width-table')).toBeNull();

    fireEvent.click(screen.getByTestId('expectations-expand'));
    expect(screen.getByTestId('width-table')).toBeInTheDocument();
    await waitFor(() => expect(api.listRobotTypes).toHaveBeenCalled());
  });

  it('collapses a failing verdict to one line that names the mismatch (TASK-363)', () => {
    render(<DatasetExpectationsPanel dataset={failedDataset()} onDatasetChange={vi.fn()} />);
    expect(screen.getByTestId('dataset-expectations')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('expectations-summary')).toHaveTextContent(
      'Does not match Unitree_G1 — state 43 (expects 28), action 43 (expects 28)',
    );
    expect(screen.getByTestId('expectations-status')).toHaveTextContent(/failed/i);
    expect(screen.queryByTestId('width-table')).toBeNull();
  });

  it('collapses again on Hide', () => {
    renderOpen(failedDataset());
    expect(screen.getByTestId('width-table')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('expectations-collapse'));
    expect(screen.queryByTestId('width-table')).toBeNull();
    expect(screen.getByTestId('expectations-summary')).toBeInTheDocument();
  });

  it('shows Validating the moment Revalidate is clicked, before the server answers (TASK-363)', async () => {
    // A `ready` row stays `ready` until the verdict lands; the badge must not.
    api.revalidateDataset.mockReturnValue(new Promise(() => undefined));
    const ready = failedDataset({ status: 'ready', validation: { ...failedDataset().validation!, valid: true, errors: [] } });
    renderOpen(ready);
    expect(screen.getByTestId('selected-robot-type-status')).toHaveTextContent(/ready/i);
    fireEvent.click(screen.getByTestId('revalidate-button'));
    expect(screen.getByTestId('selected-robot-type-status')).toHaveTextContent(/validating/i);
  });

  it('keeps showing Validating while the pass runs and the verdict once it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.revalidateDataset.mockResolvedValue({ state: 'started' });
    const ready = failedDataset({ status: 'ready', validation: { ...failedDataset().validation!, valid: true, errors: [] } });
    api.getDataset.mockResolvedValue(ready);
    renderOpen(ready);
    fireEvent.click(screen.getByTestId('revalidate-button'));
    await waitFor(() => expect(screen.getByTestId('validation-running')).toBeInTheDocument());
    expect(screen.getByTestId('selected-robot-type-status')).toHaveTextContent(/validating/i);
    api.getValidationProgress.mockResolvedValue({ status: 'ready', progress: 100 });
    await pollTimes(1);
    await waitFor(() => expect(screen.getByTestId('selected-robot-type-status')).toHaveTextContent(/ready/i));
  });

  it('names an `unknown` robot type readably, in the summary and the picker', async () => {
    api.listRobotTypes.mockResolvedValue([G1_28, robotType('rt-unk', 'unknown (action 43, state 43)', 43)]);
    const unknownRow = failedDataset({
      robotType: { id: 'rt-x', name: 'unknown', manufacturer: 'Unknown', model: 'unknown', actionDim: 28, proprioceptionDim: 28 },
      robotTypeId: 'rt-x',
    });
    render(<DatasetExpectationsPanel dataset={unknownRow} onDatasetChange={vi.fn()} />);
    expect(screen.getByTestId('expectations-summary')).toHaveTextContent('Does not match Unidentified robot');
    fireEvent.click(screen.getByTestId('expectations-expand'));
    expect(screen.getByTestId('selected-robot-type')).toHaveTextContent('Unidentified robot');
    const select = await screen.findByLabelText('Robot type');
    await waitFor(() => expect(within(select).getByText(/^Unidentified robot — state 43/)).toBeInTheDocument());
    expect(within(select).queryByText(/^unknown/)).toBeNull();
  });

  it('lists the types whose widths match the files first', async () => {
    api.listRobotTypes.mockResolvedValue([
      robotType('rt-6', 'A SO-101', 6), G1_43, robotType('rt-28b', 'B arms', 28),
    ]);
    renderOpen(failedDataset());
    const select = await screen.findByLabelText('Robot type');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(3));
    const labels = within(select).getAllByRole('option').map((o) => o.textContent ?? '').filter((t) => !t.startsWith('Choose'));
    expect(labels[0]).toMatch(/^Unitree G1 EDU \(Dex3-1\).*widths match/);
    expect(labels.slice(1).map((l) => l.split(' — ')[0])).toEqual(['A SO-101', 'B arms']);
  });

  it('says when the old verdict was voided and lists the history', () => {
    const change = {
      at: '2026-10-12T10:00:00.000Z', actorId: 'u1', fromRobotTypeId: 'rt-28', fromRobotTypeName: 'Unitree_G1',
      toRobotTypeId: 'rt-43', toRobotTypeName: 'Unitree G1 EDU (Dex3-1)', previousStatus: 'failed', previousValid: false,
      reason: 'intended config',
    };
    renderOpen(failedDataset({ status: 'validating', validation: undefined, expectations: { invalidated: change, history: [change] } }));
    expect(screen.getByTestId('verdict-invalidated')).toHaveTextContent('Revalidating the stored files');
    expect(screen.getByTestId('expectation-history')).toHaveTextContent('intended config');
    expect(screen.getByText(/Observed \(info\.json\)/)).toBeInTheDocument();
  });
});
