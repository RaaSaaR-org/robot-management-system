/**
 * @file PipelinePage.test.tsx
 * @description TASK-503: the Skill Training overview counts what is on the
 *              instance however it got there — imported datasets cover Collect,
 *              a registered model covers Train — instead of calling those
 *              stages "not started" next to four datasets and a model.
 * @feature pipeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listDatasets: vi.fn(),
  listTrainingJobs: vi.fn(),
  listModelVersions: vi.fn(),
  listDeployments: vi.fn(),
  listJobs: vi.fn(),
}));
vi.mock('@/features/datacollection/api/datacollectionApi', () => ({
  datacollectionApi: { listSessions: api.listSessions },
}));
vi.mock('@/features/training/api/trainingApi', () => ({
  trainingApi: { listDatasets: api.listDatasets, listTrainingJobs: api.listTrainingJobs },
}));
vi.mock('@/features/deployment/api/deploymentApi', () => ({
  deploymentApi: { listModelVersions: api.listModelVersions, listDeployments: api.listDeployments },
}));
vi.mock('@/features/simulation/api/simulationApi', () => ({ simulationApi: { listJobs: api.listJobs } }));
vi.mock('../../components/FirstRunWizard', () => ({ FirstRunWizard: () => <div>First run wizard</div> }));

import { PipelinePage } from '../PipelinePage';

const UPDATED = '2026-11-13T10:00:00.000Z';
const dataset = (id: string) => ({ id, status: 'ready', updatedAt: UPDATED });

async function stages() {
  render(
    <MemoryRouter>
      <PipelinePage />
    </MemoryRouter>,
  );
  const collect = await screen.findByTestId('pipeline-stage-1');
  const stage = (n: number) => within(screen.getByTestId(`pipeline-stage-${n}`));
  return { collect: within(collect), dataset: stage(2), train: stage(3), evaluate: stage(4), deploy: stage(5) };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listSessions.mockResolvedValue({ sessions: [] });
  api.listDatasets.mockResolvedValue({ datasets: [] });
  api.listTrainingJobs.mockResolvedValue({ jobs: [] });
  api.listModelVersions.mockResolvedValue([]);
  api.listDeployments.mockResolvedValue({ deployments: [] });
  api.listJobs.mockResolvedValue([]);
});

describe('an instance with imported datasets and an uploaded model', () => {
  beforeEach(() => {
    api.listDatasets.mockResolvedValue({ datasets: ['a', 'b', 'c', 'd'].map(dataset) });
    api.listModelVersions.mockResolvedValue([{ id: 'm-1' }]);
  });

  it('counts the datasets as collected and the registered model as trained', async () => {
    const s = await stages();

    expect(s.collect.getByText('Datasets imported')).toBeInTheDocument();
    expect(s.collect.getByText('Done')).toBeInTheDocument();
    expect(s.collect.queryByText('Not started')).not.toBeInTheDocument();
    expect(s.dataset.getByText('4 datasets · 4 ready')).toBeInTheDocument();
    expect(s.train.getByText('1 model registered')).toBeInTheDocument();
    expect(s.train.getByText('Done')).toBeInTheDocument();
  });

  it('moves "up next" on to Evaluate and keeps Deploy waiting on it', async () => {
    const s = await stages();

    expect(s.train.queryByText('Up next')).not.toBeInTheDocument();
    expect(s.evaluate.getByText('Up next')).toBeInTheDocument();
    expect(s.evaluate.getByText('Ready to evaluate in simulation')).toBeInTheDocument();
    expect(s.deploy.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run simulation' })).toBeInTheDocument();
    expect(screen.queryByText('First run wizard')).not.toBeInTheDocument();
  });

  it('says "2 models registered" for two', async () => {
    api.listModelVersions.mockResolvedValue([{ id: 'm-1' }, { id: 'm-2' }]);

    const s = await stages();

    expect(s.train.getByText('2 models registered')).toBeInTheDocument();
  });

  it('still reads "Ready to train" when the model registry cannot be read', async () => {
    api.listModelVersions.mockRejectedValue(new Error('boom'));

    const s = await stages();

    expect(s.train.getByText('Ready to train')).toBeInTheDocument();
    expect(s.train.getByText('Up next')).toBeInTheDocument();
  });
});

describe('what stays as it was', () => {
  it('shows an empty instance as not started, with the first-run wizard', async () => {
    const s = await stages();

    expect(s.collect.getByText('No sessions yet')).toBeInTheDocument();
    expect(s.train.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('First run wizard')).toBeInTheDocument();
    expect(api.listModelVersions).toHaveBeenCalledTimes(1);
  });

  it('reports sessions and training jobs when there are some, without asking the registry', async () => {
    api.listSessions.mockResolvedValue({ sessions: [{ id: 's-1', status: 'completed', updatedAt: UPDATED }] });
    api.listDatasets.mockResolvedValue({ datasets: [dataset('a')] });
    api.listTrainingJobs.mockResolvedValue({ jobs: [{ id: 'j-1', status: 'completed', updatedAt: UPDATED }] });

    const s = await stages();

    expect(s.collect.getByText('1 session · 1 completed')).toBeInTheDocument();
    expect(s.train.getByText('1 job · 1 completed')).toBeInTheDocument();
    expect(api.listModelVersions).not.toHaveBeenCalled();
  });
});
