/**
 * @file PatrolPage.test.tsx
 * @description The /patrol page: routes table with Baseline run / Patrol now,
 *              run history, the active-run banner fed by live events, and a
 *              refused start shown as a notice (not an error).
 * @feature patrol
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { PatrolPage } from '../../pages/PatrolPage';
import { usePatrolStore } from '../../store/patrolStore';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { patrolApi } from '../../api/patrolApi';
import type { PatrolRoute, PatrolRun } from '../../types/patrol.types';

vi.mock('../../api/patrolApi', () => ({
  patrolApi: {
    listRoutes: vi.fn(),
    listRuns: vi.fn(),
    startRoute: vi.fn(),
    abortRoute: vi.fn(),
    validateCron: vi.fn(),
  },
  photoKeyBasename: (k: string) => k,
}));
vi.mock('../../hooks/usePatrolEvents', () => ({
  usePatrolEvents: () => ({ isConnected: true, error: null }),
}));
vi.mock('@/features/robots/api/robotsApi', () => ({
  robotsApi: { getRobots: vi.fn().mockResolvedValue([]) },
}));
const api = vi.mocked(patrolApi);

const route: PatrolRoute = {
  id: 'route-1', name: 'Night round', robotId: 'g1', twinId: null,
  checkpoints: [{ id: 'cp-a', placeId: 'hall', name: 'Hall', actions: ['capture'], dwellMs: 0 }],
  cronExpression: '0 22 * * *', enabled: true, timeWindows: [], homePlaceId: null, createdAt: 'x', updatedAt: 'x',
};
const run: PatrolRun = {
  runId: 'run-1', routeId: 'route-1', routeName: 'Night round', robotId: 'g1', mode: 'patrol', origin: 'scheduled', window: 'night',
  status: 'done', startedAt: '2026-08-15T22:00:00.000Z', finishedAt: '2026-08-15T22:10:00.000Z',
  legs: [{ index: 0, checkpointId: 'cp-a', placeId: 'hall', name: 'Hall', status: 'done', findingIds: [] }], findingCount: 2,
};

beforeEach(() => {
  usePatrolStore.getState().reset();
  vi.clearAllMocks();
  useRobotsStore.setState({
    robots: [{ id: 'g1', name: 'Alpha', model: 'Unitree G1', status: 'online', batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' } as never],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
  api.listRoutes.mockResolvedValue([route]);
  api.listRuns.mockResolvedValue([run]);
  api.validateCron.mockResolvedValue({ valid: true, nextRuns: ['2026-08-16T22:00:00.000Z'] });
});

describe('PatrolPage', () => {
  it('lists routes with robot, checkpoints, schedule and last run; and the run history', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    const row = await screen.findByTestId('patrol-route-row');
    expect(row).toHaveTextContent('Night round');
    expect(row).toHaveTextContent('Alpha');
    expect(row).toHaveTextContent('0 22 * * *');
    expect(row).toHaveTextContent('Done');
    await waitFor(() => expect(api.validateCron).toHaveBeenCalledWith('0 22 * * *'));
    const runs = await screen.findAllByTestId('patrol-run-row');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveTextContent('2');
    expect(screen.getByTestId('patrol-page')).toBeInTheDocument();
    expect(screen.getByTestId('patrol-run-history')).toBeInTheDocument();
  });

  it('Patrol now / Baseline run start the route on its robot; a refusal is a notice', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'battery', message: 'Battery 12% is below the 30% minimum.' });
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    fireEvent.click(screen.getByTestId('patrol-run-now'));
    await waitFor(() => expect(api.startRoute).toHaveBeenCalledWith('route-1', 'patrol', 'g1'));
    const notice = await screen.findByTestId('patrol-start-result');
    expect(notice).toHaveTextContent('Refused (battery): Battery 12% is below the 30% minimum.');

    api.startRoute.mockResolvedValue({ accepted: true, runId: 'run-2', message: 'started' });
    fireEvent.click(screen.getByTestId('patrol-run-baseline'));
    await waitFor(() => expect(api.startRoute).toHaveBeenCalledWith('route-1', 'baseline', 'g1'));
    await waitFor(() => expect(screen.getByTestId('patrol-start-result')).toHaveTextContent('Run started (run-2)'));
  });

  it('a live started event raises the active-run banner and swaps the row’s buttons for Abort', async () => {
    api.abortRoute.mockResolvedValue({ ok: true, runId: 'run-3' });
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    expect(screen.queryByTestId('patrol-active-banner')).toBeNull();
    act(() => {
      usePatrolStore.getState().applyEvent({
        type: 'agent:patrol:started', robotId: 'g1', timestamp: 'x',
        patrol: { ...run, runId: 'run-3', status: 'running', finishedAt: null, startedAt: '2026-08-16T22:00:00.000Z', findingCount: 0,
          legs: [{ index: 0, checkpointId: 'cp-a', placeId: 'hall', name: 'Hall', status: 'running', findingIds: [] }] },
      });
    });
    const banner = await screen.findByTestId('patrol-active-banner');
    expect(banner).toHaveTextContent('Patrol run · Night round');
    expect(banner).toHaveTextContent('at leg 1: Hall');
    expect(screen.queryByTestId('patrol-run-now')).toBeNull();
    fireEvent.click(screen.getAllByTestId('patrol-abort')[0]);
    await waitFor(() => expect(api.abortRoute).toHaveBeenCalledWith('route-1', 'g1'));
  });

  it('offers a New route link', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    expect(screen.getByTestId('patrol-new-route').closest('a')).toHaveAttribute('href', '/patrol/routes/new');
  });
});
