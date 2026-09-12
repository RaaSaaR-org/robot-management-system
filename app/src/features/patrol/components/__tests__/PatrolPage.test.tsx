/**
 * @file PatrolPage.test.tsx
 * @description The /patrol page: routes table with Start run / Baseline run in
 *              the row menu (RunStartModal), the Runs tab, the active-run banner
 *              fed by live events, and results shown as toasts.
 * @feature patrol
 */

import { useAuthStore } from '@/features/auth/store/authStore';
import { MOCK_USER } from '@/mocks/mockData';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { getToasts, dismissToast, confirm } from '@/shared/components/ui';
import { renderWithProviders } from '@/test/utils';
import { PatrolPage } from '../../pages/PatrolPage';

// The kit's confirm() opens a ConfirmDialog; here the operator always says yes.
vi.mock('@/shared/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/components/ui')>()),
  confirm: vi.fn(),
}));
const confirmMock = vi.mocked(confirm);
import { usePatrolStore } from '../../store/patrolStore';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { patrolApi } from '../../api/patrolApi';
import type { PatrolRoute, PatrolRun } from '../../types/patrol.types';

// The run history navigates on a row click; MemoryRouter has no window.location
// to assert against, so the navigate call itself is the contract.
const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

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
  useAuthStore.setState({ user: { ...MOCK_USER, role: 'member' } });
  usePatrolStore.getState().reset();
  dismissToast();
  confirmMock.mockResolvedValue(true);
  vi.clearAllMocks();
  useRobotsStore.setState({
    robots: [{ id: 'g1', name: 'Alpha', model: 'Unitree G1', status: 'online', batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' } as never],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
  api.listRoutes.mockResolvedValue([route]);
  api.listRuns.mockResolvedValue([run]);
  api.validateCron.mockResolvedValue({ valid: true, nextRuns: ['2026-08-16T22:00:00.000Z'] });
});

const toastTitles = () => getToasts().map((t) => String(t.title));
const openRowMenu = async (name = 'Night round') => {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
};

describe('PatrolPage', () => {
  it('lists routes with robot, checkpoints, schedule and last run; the Runs tab holds the history', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    const row = (await screen.findByTestId('patrol-route-row')).closest('tr')!;
    expect(row).toHaveTextContent('Night round');
    expect(row).toHaveTextContent('1 checkpoint');
    expect(row).toHaveTextContent('Alpha');
    expect(row).toHaveTextContent('Daily at 22:00');
    expect(row).toHaveTextContent('Done');
    expect(row).toHaveTextContent('Armed');
    expect(screen.getByTestId('patrol-page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Runs/ }));
    const runs = await screen.findAllByTestId('patrol-run-row');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.closest('tr')).toHaveTextContent('2');
    expect(screen.getByTestId('patrol-run-history')).toBeInTheDocument();
  });

  it('opens the run from anywhere in its row', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false, routerEntries: ['/patrol?tab=runs'] });
    const row = (await screen.findAllByTestId('patrol-run-row'))[0]!.closest('tr')!;
    expect(row).toHaveClass('cursor-pointer');
    fireEvent.click(within(row).getByText('Patrol · scheduled'));
    expect(navigateSpy).toHaveBeenCalledWith('/patrol/runs/run-1');
  });

  it('a route row opens its editor', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    fireEvent.click(await screen.findByText('Night round'));
    expect(navigateSpy).toHaveBeenCalledWith('/patrol/routes/route-1');
  });

  it('Start run / Baseline run go through the start dialog; the result is a toast', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'battery', message: 'Battery 12% is below the 30% minimum.' });
    renderWithProviders(<PatrolPage />, { withAuth: false });
    let menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Start run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start Night round' });
    expect(within(dialog).getByTestId('patrol-start-robot')).toHaveValue('g1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(api.startRoute).toHaveBeenCalledWith('route-1', 'patrol', 'g1'));
    await waitFor(() => expect(toastTitles()).toContain('The robot refused the run'));
    // A refusal keeps the dialog open with the reason as the form-level error.
    expect(await within(dialog).findByText(/Refused \(battery\): Battery 12%/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    api.startRoute.mockResolvedValue({ accepted: true, runId: 'run-2', message: 'started' });
    menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Baseline run' }));
    const again = await screen.findByRole('dialog', { name: 'Start Night round' });
    fireEvent.click(within(again).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(api.startRoute).toHaveBeenCalledWith('route-1', 'baseline', 'g1'));
    await waitFor(() => expect(toastTitles()).toContain('Run started'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a live started event raises the active-run banner and swaps the row menu to Abort run', async () => {
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
    const menu = await openRowMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Start run' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Abort run' })).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.click(within(banner).getByTestId('patrol-abort'));
    await waitFor(() => expect(api.abortRoute).toHaveBeenCalledWith('route-1', 'g1'));
    expect(confirmMock).toHaveBeenCalled();
    await waitFor(() => expect(toastTitles()).toContain('Run aborted'));
  });

  it('a live leg-start names the checkpoint and highlights it in the stepper (TASK-222)', async () => {
    const threeLegs = (...statuses: PatrolRun['legs'][number]['status'][]): PatrolRun => ({
      ...run, runId: 'run-4', status: 'running', finishedAt: null,
      startedAt: '2026-08-16T22:00:00.000Z', findingCount: 0,
      legs: statuses.map((status, index) => ({
        index, checkpointId: `cp-${index}`, placeId: `place-${index}`,
        name: ['Hall', 'Kitchen', 'Dock'][index], status, findingIds: [],
      })),
    });
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    act(() => {
      usePatrolStore.getState().applyEvent({ type: 'agent:patrol:leg', robotId: 'g1', timestamp: 'x', patrol: threeLegs('done', 'pending', 'pending') });
    });
    const banner = await screen.findByTestId('patrol-active-banner');
    expect(banner).not.toHaveTextContent(/at leg/);
    expect(within(banner).queryByRole('listitem', { current: 'step' })).toBeNull();
    act(() => {
      usePatrolStore.getState().applyEvent({ type: 'agent:patrol:leg', robotId: 'g1', timestamp: 'x', patrol: threeLegs('done', 'running', 'pending') });
    });
    expect(banner).toHaveTextContent('at leg 2: Kitchen');
    const steps = within(banner).getAllByRole('listitem', { current: 'step' });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toHaveTextContent('Leg 2 Kitchen, running');
  });

  it('says the run history could not be read instead of "No runs yet"', async () => {
    api.listRuns.mockRejectedValue(new Error('Network Error'));
    renderWithProviders(<PatrolPage />, { withAuth: false, routerEntries: ['/patrol?tab=runs'] });
    expect(await screen.findByText("Couldn't load runs")).toBeInTheDocument();
    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByText(/No runs yet/i)).toBeNull();
    // …and the tiles must not assert zeros they could not count.
    await screen.findByTestId('patrol-kpi-runs');
    expect(screen.getByTestId('patrol-kpi-runs')).toHaveTextContent('—');
    expect(screen.getByTestId('patrol-kpi-findings')).toHaveTextContent('History unavailable');
  });

  it('a failed refresh keeps the loaded routes on screen and warns once with a toast', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    act(() => {
      usePatrolStore.setState({ routesStatus: 'error', routesError: 'Network Error' });
    });
    expect(screen.getByTestId('patrol-route-row')).toHaveTextContent('Night round');
    expect(screen.queryByText("Couldn't load routes")).toBeNull();
    const stale = getToasts().filter((t) => t.id === 'patrol-stale');
    expect(stale).toHaveLength(1);
    expect(String(stale[0]!.description)).toContain('Network Error');
  });

  it('deletes a route through the confirm and says so', async () => {
    const del = vi.fn().mockResolvedValue(true);
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    usePatrolStore.setState({ deleteRoute: del as never });
    const menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('route-1'));
    expect(confirmMock).toHaveBeenCalled();
    await waitFor(() => expect(toastTitles()).toContain('Route deleted'));
  });

  it('filters routes and offers Clear filters when nothing matches', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    fireEvent.change(screen.getByPlaceholderText('Search routes'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No routes match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByTestId('patrol-route-row')).toBeInTheDocument();
  });

  it('offers a New route link', async () => {
    renderWithProviders(<PatrolPage />, { withAuth: false });
    await screen.findByTestId('patrol-route-row');
    expect(screen.getByTestId('patrol-new-route').closest('a')).toHaveAttribute('href', '/patrol/routes/new');
  });
});


it('keeps routes readable for viewers but disables starting and aborting runs', async () => {
  useAuthStore.setState({ user: { ...MOCK_USER, role: 'viewer' } });
  renderWithProviders(<PatrolPage />, { withAuth: false });
  await screen.findByTestId('patrol-route-row');
  expect(screen.queryByTestId('patrol-new-route')).not.toBeInTheDocument();
  expect(screen.getByTestId('patrol-read-only')).toHaveTextContent(/Read-only access/);

  const menu = await openRowMenu();
  for (const name of ['Start run', 'Baseline run', 'Delete']) {
    const item = within(menu).getByRole('menuitem', { name });
    expect(item).toBeDisabled();
    fireEvent.click(item);
  }
  expect(api.startRoute).not.toHaveBeenCalled();
  // Reading a route and exporting it are not writes, so both stay open.
  expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
  expect(within(menu).getByRole('menuitem', { name: 'Export VDA5050' })).toBeEnabled();
  fireEvent.keyDown(menu, { key: 'Escape' });

  act(() => {
    usePatrolStore.getState().applyEvent({
      type: 'agent:patrol:started', robotId: 'g1', timestamp: 'x',
      patrol: { ...run, runId: 'run-9', status: 'running', finishedAt: null, findingCount: 0,
        legs: [{ index: 0, checkpointId: 'cp-a', placeId: 'hall', name: 'Hall', status: 'running', findingIds: [] }] },
    });
  });
  const banner = await screen.findByTestId('patrol-active-banner');
  const abort = within(banner).getByTestId('patrol-abort');
  expect(abort).toBeDisabled();
  fireEvent.click(abort);
  // The row's own verb swapped to Abort run, and it is refused as well.
  const live = await openRowMenu();
  expect(within(live).getByRole('menuitem', { name: 'Abort run' })).toBeDisabled();
  expect(api.abortRoute).not.toHaveBeenCalled();
});
