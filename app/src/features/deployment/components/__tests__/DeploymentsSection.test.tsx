/**
 * @file DeploymentsSection.test.tsx
 * @description The History tab must tell the three ways a rollout can end
 *              apart: a crash, a deliberate withdrawal and a cancel. They were
 *              one red "Failed" row until the server learned to write
 *              'rolled_back' and 'cancelled'. (TASK-299)
 * @feature deployment
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, within } from '@/test/utils';
import { DeploymentsSection } from '../DeploymentsSection';
import type { Deployment, DeploymentStatus } from '../../types';
import type { DeploymentActs } from '../useDeploymentActs';

function makeDeployment(id: string, status: DeploymentStatus): Deployment {
  return {
    id,
    modelVersionId: `mv-${id}`,
    strategy: 'canary',
    targetRobotTypes: [],
    targetZones: [],
    trafficPercentage: 100,
    canaryConfig: { stages: [], successThreshold: 0.95 },
    rollbackThresholds: { errorRate: 0.05, latencyP99: 500, failureRate: 0.1 },
    status,
    deployedRobotIds: [],
    failedRobotIds: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    startedAt: '2026-09-01T10:00:00.000Z',
    completedAt: '2026-09-01T11:00:00.000Z',
  };
}

const acts = {
  promote: vi.fn(),
  openRollback: vi.fn(),
  cancel: vi.fn(),
} as unknown as DeploymentActs;

function renderSection(deployments: Deployment[]) {
  return renderWithProviders(
    <DeploymentsSection
      deployments={deployments}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
      acts={acts}
    />,
  );
}

describe('DeploymentsSection — History', () => {
  const finished = [
    makeDeployment('d-failed', 'failed'),
    makeDeployment('d-rolled-back', 'rolled_back'),
    makeDeployment('d-cancelled', 'cancelled'),
  ];

  it('renders the three terminal states as three distinct labels', async () => {
    const user = userEvent.setup();
    renderSection(finished);

    // The section opens on Active, where none of these belong.
    expect(screen.queryByText('Rolled back')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'History' }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    expect(within(table).getByText('Rolled back')).toBeInTheDocument();
    expect(within(table).getByText('Cancelled')).toBeInTheDocument();
  });

  it('keeps every finished rollout out of Active', async () => {
    const user = userEvent.setup();
    renderSection(finished);

    // Active is empty: a withdrawal and a cancel are history, not in flight.
    expect(screen.getByText('No active deployments')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getAllByRole('row').length).toBe(finished.length + 1); // + header
  });
});
