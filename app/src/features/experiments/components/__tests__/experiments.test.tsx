/**
 * @file experiments.test.tsx
 * @description The arm comparison chart shows the episode count on every bar,
 *   the approve dialog spells out the arm diff and the budget, and the arm
 *   table states what each arm varies and how it compares (TASK-242).
 * @feature experiments
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArmComparisonChart } from '../ArmComparisonChart';
import { ApproveExperimentDialog } from '../ApproveExperimentDialog';
import { ArmTable } from '../ArmTable';
import { halfWidth95, rateWithCount } from '../../utils/experiments';
import type { Experiment, ExperimentArm } from '../../types/experiment.types';

function arm(over: Partial<ExperimentArm>): ExperimentArm {
  return {
    id: 'a',
    experimentId: 'e',
    name: 'arm',
    label: null,
    isBaseline: false,
    datasetRefs: [{ datasetId: 'ds-1' }],
    initFromModelVersionId: null,
    hyperparameters: {},
    trainingJobId: 'tj',
    modelVersionId: 'mv',
    simJobId: 'sim',
    status: 'scored',
    failureReason: null,
    result: null,
    varies: [],
    createdAt: '2026-09-30T10:00:00Z',
    updatedAt: '2026-09-30T10:00:00Z',
    ...over,
  };
}

const result = (s: number, n: number) => ({
  successRate: s / n,
  successCount: s,
  episodeCount: n,
  meanDurationMs: 1000,
  domainGapScore: null,
  evaluationEpisodeIds: [],
  simJobId: 'sim',
  taskPrompt: 't',
});

const ARMS: ExperimentArm[] = [
  arm({ id: 'b', name: 'full dataset', isBaseline: true, result: result(8, 12) }),
  arm({ id: 'x', name: 'drop lowest 10%', varies: ['data (ds-1 → view-1)'], result: result(320, 400) }),
  arm({ id: 'f', name: 'lr 3e-4', varies: ['learning_rate (0.0001 → 0.0003)'], status: 'failed', failureReason: 'OOM', result: null }),
];

describe('ArmComparisonChart', () => {
  it('shows the episode count on every bar, so 12 rollouts never read like 400', () => {
    render(<ArmComparisonChart arms={ARMS} winnerArmId={null} />);
    const counts = screen.getAllByTestId('arm-episode-count').map((el) => el.textContent);
    expect(counts).toEqual(['8/12 (66.7%) · n=12', '320/400 (80%) · n=400']);
  });

  it('draws a much wider interval for 12 rollouts than for 400', () => {
    expect(halfWidth95(8 / 12, 12)).toBeGreaterThan(5 * halfWidth95(0.8, 400));
  });

  it('says so when nothing is scored', () => {
    render(<ArmComparisonChart arms={[ARMS[2]]} />);
    expect(screen.getByText('No arm has been scored yet.')).toBeInTheDocument();
  });
});

const EXPERIMENT: Experiment = {
  id: 'e',
  title: 'Drop shaky episodes',
  hypothesis: 'Dropping low-reward episodes raises sim success.',
  status: 'proposed',
  actorType: 'agent',
  actorId: 'planner',
  displayName: 'planner',
  baseModel: 'groot_n1_7',
  fineTuneMethod: 'lora',
  approvedBy: null,
  approvedAt: null,
  rejectedReason: null,
  budget: { maxArms: 4, maxGpuHours: 24, gpuHoursPerArm: 4 },
  evaluation: { environment: 'g1_apple_pnp', rolloutCount: 50 },
  baselineArmId: 'b',
  verdict: null,
  arms: ARMS,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
};

describe('ApproveExperimentDialog', () => {
  it('spells out the arm diff and the spend before anything trains', () => {
    const onApprove = vi.fn(async () => undefined);
    render(<ApproveExperimentDialog experiment={EXPERIMENT} onClose={() => {}} onApprove={onApprove} onReject={async () => {}} />);
    const diffs = screen.getAllByTestId('arm-diff').map((el) => el.textContent);
    expect(diffs).toEqual(['full datasetbaseline', 'drop lowest 10%data (ds-1 → view-1)', 'lr 3e-4learning_rate (0.0001 → 0.0003)']);
    const dialog = screen.getByTestId('approve-dialog');
    expect(within(dialog).getByText('12 of 24 (4 per arm)')).toBeInTheDocument();
    expect(within(dialog).getByText('50 sim rollouts in g1_apple_pnp')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('approve-experiment'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});

describe('ArmTable', () => {
  it('states each result with its count and the comparison against the baseline', () => {
    render(
      <MemoryRouter>
        <ArmTable
          arms={ARMS}
          verdict={{
            winnerArmId: null,
            baselineArmId: 'b',
            baselineSuccessRate: 8 / 12,
            baselineEpisodeCount: 12,
            deltas: [{ armId: 'x', name: 'drop lowest 10%', successRate: 0.8, episodeCount: 400, delta: 0.1333, standardError: 0.12, zScore: 1.1, significant: false, direction: 'within_noise' }],
            criticalZ: 1.96,
            confidenceNote: 'No winner',
            failedArmIds: ['f'],
            concludedAt: '2026-09-30T12:00:00Z',
          }}
        />
      </MemoryRouter>
    );
    const table = screen.getByTestId('arm-table');
    expect(within(table).getByText(rateWithCount(result(320, 400)))).toBeInTheDocument();
    expect(within(table).getByText('+13.3 pts · within noise')).toBeInTheDocument();
    expect(within(table).getByText('OOM')).toBeInTheDocument();
  });
});
