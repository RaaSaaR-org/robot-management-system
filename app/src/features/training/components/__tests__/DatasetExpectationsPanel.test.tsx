/**
 * @file DatasetExpectationsPanel.test.tsx
 * @description The TASK-353 recovery UI: observed vs expected widths, changing
 *              the robot type, defining a 43-wide configuration, and
 *              revalidating the stored files.
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

/** Let `n` poll intervals pass and their promises settle. */
async function pollTimes(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(EXPECTATIONS_POLL_MS); });
  }
}

describe('DatasetExpectationsPanel', () => {
  it('shows observed widths beside the expected widths and the selected robot type', async () => {
    render(<DatasetExpectationsPanel dataset={failedDataset()} onDatasetChange={vi.fn()} />);
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
    render(<DatasetExpectationsPanel dataset={failedDataset()} onDatasetChange={vi.fn()} />);
    await waitFor(() => expect(api.listRobotTypes).toHaveBeenCalled());
    expect(screen.getByTestId('selected-robot-type')).toHaveTextContent('Unitree_G1');
  });

  it('reassociates with the chosen type and hands back the updated dataset', async () => {
    const updated = failedDataset({ status: 'validating', robotTypeId: 'rt-43' });
    api.reassociateRobotType.mockResolvedValue({ dataset: updated, change: {}, revalidation: 'started' });
    const onChange = vi.fn();
    render(<DatasetExpectationsPanel dataset={failedDataset()} onDatasetChange={onChange} />);

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
    render(<DatasetExpectationsPanel dataset={failedDataset()} onDatasetChange={onChange} />);
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
    render(<DatasetExpectationsPanel dataset={failedDataset({ status: 'validating' })} onDatasetChange={vi.fn()} />);
    expect(screen.getByTestId('revalidate-button')).toBeDisabled();
    await pollTimes(EXPECTATIONS_MAX_POLLS);
    await waitFor(() => expect(screen.getByTestId('validation-gave-up')).toBeInTheDocument());
    expect(screen.getByTestId('revalidate-button')).not.toBeDisabled();
    expect(api.getValidationProgress).toHaveBeenCalledTimes(EXPECTATIONS_MAX_POLLS);
  });

  it('shows why the last pass reached no verdict', () => {
    render(
      <DatasetExpectationsPanel
        dataset={failedDataset({ validation: undefined, expectations: { invalidated: null, history: [], error: 'Storage unavailable — nothing was validated' } })}
        onDatasetChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('validation-error')).toHaveTextContent('Storage unavailable');
  });

  it('locks the controls while the dataset is importing or validating', () => {
    render(<DatasetExpectationsPanel dataset={failedDataset({ status: 'importing' })} onDatasetChange={vi.fn()} />);
    expect(screen.getByTestId('revalidate-button')).toBeDisabled();
    expect(screen.getByTestId('reassociate-button')).toBeDisabled();
    expect(screen.getByText(/Locked while the dataset is importing/)).toBeInTheDocument();
  });

  it('defines a new 43-wide configuration from the G1 EDU + Dex3-1 preset', async () => {
    const created = robotType('rt-new', 'Unitree G1 EDU (Dex3-1)', 43);
    api.createRobotType.mockResolvedValue(created);
    render(<DatasetExpectationsPanel dataset={failedDataset()} onDatasetChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Define a new robot configuration'));
    fireEvent.click(screen.getByText(/G1 EDU \+ Dex3-1 \(43 DOF\) preset/));
    fireEvent.click(screen.getByText('Create configuration'));
    await waitFor(() => expect(api.createRobotType).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Unitree G1 EDU (Dex3-1)', actionDim: 43, proprioceptionDim: 43,
    })));
  });

  it('says when the old verdict was voided and lists the history', () => {
    const change = {
      at: '2026-10-12T10:00:00.000Z', actorId: 'u1', fromRobotTypeId: 'rt-28', fromRobotTypeName: 'Unitree_G1',
      toRobotTypeId: 'rt-43', toRobotTypeName: 'Unitree G1 EDU (Dex3-1)', previousStatus: 'failed', previousValid: false,
      reason: 'intended config',
    };
    render(
      <DatasetExpectationsPanel
        dataset={failedDataset({ status: 'validating', validation: undefined, expectations: { invalidated: change, history: [change] } })}
        onDatasetChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict-invalidated')).toHaveTextContent('Revalidating the stored files');
    expect(screen.getByTestId('expectation-history')).toHaveTextContent('intended config');
    expect(screen.getByText(/Observed \(info\.json\)/)).toBeInTheDocument();
  });
});
