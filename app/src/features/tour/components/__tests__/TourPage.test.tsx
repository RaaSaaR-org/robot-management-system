/**
 * @file TourPage.test.tsx
 * @description The /tour page: the tours table with stops, duration, auto-greet
 *              and language; the Visits tab; Start tour through the start
 *              dialog; the active-run banner fed by live events; results as toasts.
 * @feature tour
 */

import { useAuthStore } from '@/features/auth/store/authStore';
import { MOCK_USER } from '@/mocks/mockData';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { getToasts, dismissToast, confirm } from '@/shared/components/ui';
import { renderWithProviders } from '@/test/utils';
import { TourPage } from '../../pages/TourPage';

// The kit's confirm() opens a ConfirmDialog; here the operator always says yes.
vi.mock('@/shared/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/components/ui')>()),
  confirm: vi.fn(),
}));
const confirmMock = vi.mocked(confirm);
import { useTourStore } from '../../store/tourStore';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { tourApi } from '../../api/tourApi';
import type { TourRoute, TourRun } from '../../types/tour.types';

// The history navigates on a row click; MemoryRouter has no window.location to
// assert against, so the navigate call itself is the contract.
const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../api/tourApi', () => ({
  tourApi: {
    listRoutes: vi.fn(),
    listRuns: vi.fn(),
    startRoute: vi.fn(),
    abortRoute: vi.fn(),
  },
}));
vi.mock('../../hooks/useTourEvents', () => ({
  useTourEvents: () => ({ isConnected: true, error: null }),
}));
vi.mock('@/features/robots/api/robotsApi', () => ({
  robotsApi: { getRobots: vi.fn().mockResolvedValue([]) },
}));
const api = vi.mocked(tourApi);

const route: TourRoute = {
  id: 'route-1',
  name: 'ZeMA visitor tour',
  robotId: 'g1',
  twinId: null,
  language: 'de',
  greetingPlaceId: 'STAGING',
  greeting: 'Hallo!',
  offer: 'Soll ich Ihnen alles zeigen?',
  farewell: 'Tschüss!',
  siteCard: ['ZeMA is a research centre in Saarbrücken.'],
  stops: [
    {
      id: 'stop-a',
      placeId: 'STAGING',
      headline: 'Reception',
      talkTrack: 'Willkommen am ZeMA. Ich zeige Ihnen unsere Halle.',
      facts: [],
      demo: null,
      dwellS: 12,
      askToContinue: false,
    },
  ],
  enabled: true,
  autoGreet: true,
  createdAt: 'x',
  updatedAt: 'x',
};

const run: TourRun = {
  runId: 'run-1',
  routeId: 'route-1',
  routeName: 'ZeMA visitor tour',
  robotId: 'g1',
  origin: 'visitor',
  status: 'done',
  startedAt: '2026-08-16T13:00:00.000Z',
  finishedAt: '2026-08-16T13:07:00.000Z',
  legs: [{ index: 0, stopId: 'stop-a', placeId: 'STAGING', name: 'Reception', status: 'done' }],
  turns: [
    { at: '2026-08-16T13:02:00.000Z', stopId: 'stop-a', question: 'Was kostet er?', answer: 'Das weiß ich nicht.', answered: 'declined', language: 'de' },
  ],
  language: 'de',
  disclosureSpoken: true,
};

beforeEach(() => {
  useAuthStore.setState({ user: { ...MOCK_USER, role: 'member' } });
  useTourStore.getState().reset();
  dismissToast();
  confirmMock.mockResolvedValue(true);
  vi.clearAllMocks();
  useRobotsStore.setState({
    robots: [
      {
        id: 'g1',
        name: 'Alpha',
        model: 'Unitree G1',
        status: 'online',
        batteryLevel: 80,
        location: { x: 0, y: 0, zone: '' },
        lastSeen: 'x',
        capabilities: [],
        createdAt: 'x',
        updatedAt: 'x',
      } as never,
    ],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
  api.listRoutes.mockResolvedValue([route]);
  api.listRuns.mockResolvedValue([run]);
});


const toastTitles = () => getToasts().map((t) => String(t.title));
const openRowMenu = async (name = 'ZeMA visitor tour') => {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
};
const startedTour = (over: Partial<TourRun> = {}): TourRun => ({
  ...run, runId: 'run-3', status: 'running', finishedAt: null, startedAt: '2026-08-17T13:00:00.000Z', turns: [],
  legs: [{ index: 0, stopId: 'stop-a', placeId: 'STAGING', name: 'Reception', status: 'running' }], ...over,
});

describe('TourPage', () => {
  it('lists tours with stops, duration, language and auto-greet; the Visits tab holds the history', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    const cell = await screen.findByTestId('tour-route-row');
    const row = cell.closest('tr')!;
    expect(row).toHaveTextContent('ZeMA visitor tour');
    expect(row).toHaveTextContent('Alpha');
    expect(within(row).getByTestId('tour-route-stops')).toHaveTextContent('1 stop');
    expect(within(row).getByTestId('tour-route-duration')).toHaveTextContent(/about/);
    expect(within(row).getByTestId('tour-route-autogreet')).toHaveTextContent('Greets on sight');
    expect(row).toHaveTextContent('German');
    expect(screen.getByTestId('tour-page')).toBeInTheDocument();
    expect(screen.getByTestId('tour-kpi-questions')).toHaveTextContent('1 the facts did not cover');

    fireEvent.click(screen.getByRole('tab', { name: /Visits/ }));
    const runs = await screen.findAllByTestId('tour-run-row');
    expect(runs).toHaveLength(1);
    // The declined question is the number an operator acts on.
    expect(runs[0]!.closest('tr')).toHaveTextContent('1 declined');
  });

  it('opens the visit from anywhere in its row', async () => {
    renderWithProviders(<TourPage />, { withAuth: false, routerEntries: ['/tour?tab=visits'] });
    const row = (await screen.findAllByTestId('tour-run-row'))[0]!.closest('tr')!;
    expect(row).toHaveClass('cursor-pointer');
    fireEvent.click(within(row).getByText('visitor · de'));
    expect(navigateSpy).toHaveBeenCalledWith('/tour/runs/run-1');
  });

  it('a tour row opens its editor', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    fireEvent.click(await screen.findByText('ZeMA visitor tour'));
    expect(navigateSpy).toHaveBeenCalledWith('/tour/routes/route-1');
  });

  it('Start tour goes through the start dialog on the tour’s robot; the result is a toast', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'person_too_close', message: 'Please give me a little room and I will lead the way.' });
    renderWithProviders(<TourPage />, { withAuth: false });
    let menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Start tour' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start ZeMA visitor tour' });
    expect(within(dialog).getByTestId('tour-start-robot')).toHaveValue('g1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start tour' }));
    await waitFor(() => expect(api.startRoute).toHaveBeenCalledWith('route-1', 'g1'));
    await waitFor(() => expect(toastTitles()).toContain('The robot refused the tour'));
    expect(await within(dialog).findByText(/Refused \(person_too_close\): Please give me a little room/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    api.startRoute.mockResolvedValue({ accepted: true, runId: 'run-2', message: 'started' });
    menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Start tour' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start tour' }));
    await waitFor(() => expect(toastTitles()).toContain('Tour started'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a live started event raises the banner with the current stop and swaps Start for End tour', async () => {
    api.abortRoute.mockResolvedValue({ ok: true, runId: 'run-3' });
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    expect(screen.queryByTestId('tour-active-banner')).toBeNull();
    act(() => {
      useTourStore.getState().applyEvent({ type: 'agent:tour:started', robotId: 'g1', timestamp: 'x', tour: startedTour() });
    });
    const banner = await screen.findByTestId('tour-active-banner');
    expect(banner).toHaveTextContent('ZeMA visitor tour');
    expect(within(banner).getByTestId('tour-banner-stop')).toHaveTextContent('at stop 1: Reception');
    const menu = await openRowMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Start tour' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'End tour' })).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.click(within(banner).getByTestId('tour-abort'));
    await waitFor(() => expect(api.abortRoute).toHaveBeenCalledWith('route-1', 'g1'));
    expect(confirmMock).toHaveBeenCalled();
    await waitFor(() => expect(toastTitles()).toContain('Tour ended'));
  });

  it('a live leg-start names the stop and highlights it in the stepper (TASK-222)', async () => {
    const threeStops = (...statuses: TourRun['legs'][number]['status'][]): TourRun =>
      startedTour({
        runId: 'run-4',
        legs: statuses.map((status, index) => ({ index, stopId: `stop-${index}`, placeId: `PLACE-${index}`, name: ['Reception', 'Workstation', 'Lab'][index], status })),
      });
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    act(() => {
      useTourStore.getState().applyEvent({ type: 'agent:tour:leg', robotId: 'g1', timestamp: 'x', tour: threeStops('done', 'pending', 'pending') });
    });
    const banner = await screen.findByTestId('tour-active-banner');
    expect(within(banner).getByTestId('tour-banner-stop')).toHaveTextContent('· walking');
    expect(within(banner).queryByRole('listitem', { current: 'step' })).toBeNull();
    act(() => {
      useTourStore.getState().applyEvent({ type: 'agent:tour:leg', robotId: 'g1', timestamp: 'x', tour: threeStops('done', 'running', 'pending') });
    });
    const stop = within(banner).getByTestId('tour-banner-stop');
    expect(stop).toHaveTextContent('at stop 2: Workstation');
    expect(stop).not.toHaveTextContent('walking');
    const steps = within(banner).getAllByRole('listitem', { current: 'step' });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toHaveTextContent('Leg 2 Workstation, running');
  });

  it('leg events re-render the banner in place without restarting its 1 s clock', async () => {
    // A remount would restart the elapsed timer mid-visit; `ActiveRunRail` only
    // unmounts when the run count reaches zero, which a leg change never does.
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const legs = (...statuses: TourRun['legs'][number]['status'][]): TourRun =>
      startedTour({ runId: 'run-5', legs: statuses.map((status, index) => ({ index, stopId: `stop-${index}`, placeId: `PLACE-${index}`, name: `Stop ${index}`, status })) });
    try {
      renderWithProviders(<TourPage />, { withAuth: false });
      await screen.findByTestId('tour-route-row');
      act(() => {
        useTourStore.getState().applyEvent({ type: 'agent:tour:started', robotId: 'g1', timestamp: 'x', tour: legs('pending', 'pending', 'pending') });
      });
      const banner = await screen.findByTestId('tour-active-banner');
      const intervalsAtMount = setSpy.mock.calls.length;
      const clearsAtMount = clearSpy.mock.calls.length;
      for (const statuses of [
        ['running', 'pending', 'pending'],
        ['done', 'pending', 'pending'],
        ['done', 'running', 'pending'],
        ['done', 'done', 'pending'],
        ['done', 'done', 'running'],
      ] as TourRun['legs'][number]['status'][][]) {
        act(() => {
          useTourStore.getState().applyEvent({ type: 'agent:tour:leg', robotId: 'g1', timestamp: 'x', tour: legs(...statuses) });
        });
      }
      expect(within(banner).getByTestId('tour-banner-stop')).toHaveTextContent('at stop 3: Stop 2');
      expect(setSpy.mock.calls.length).toBe(intervalsAtMount);
      expect(clearSpy.mock.calls.length).toBe(clearsAtMount);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it('says the history could not be read instead of "No visits yet"', async () => {
    api.listRuns.mockRejectedValue(new Error('Network Error'));
    renderWithProviders(<TourPage />, { withAuth: false, routerEntries: ['/tour?tab=visits'] });
    expect(await screen.findByText("Couldn't load visits")).toBeInTheDocument();
    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByText(/No visits yet/i)).toBeNull();
    await screen.findByTestId('tour-kpi-runs');
    expect(screen.getByTestId('tour-kpi-runs')).toHaveTextContent('—');
    expect(screen.getByTestId('tour-kpi-questions')).toHaveTextContent('History unavailable');
  });

  it('a failed refresh keeps the loaded tours on screen and warns once with a toast', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    act(() => {
      useTourStore.setState({ routesStatus: 'error', routesError: 'Network Error' });
    });
    expect(screen.getByTestId('tour-route-row')).toHaveTextContent('ZeMA visitor tour');
    expect(screen.queryByText("Couldn't load tours")).toBeNull();
    const stale = getToasts().filter((t) => t.id === 'tour-stale');
    expect(stale).toHaveLength(1);
    expect(String(stale[0]!.description)).toContain('Network Error');
  });

  it('deletes a tour through the confirm and says so', async () => {
    const del = vi.fn().mockResolvedValue(true);
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    useTourStore.setState({ deleteRoute: del as never });
    const menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('route-1'));
    expect(confirmMock).toHaveBeenCalled();
    await waitFor(() => expect(toastTitles()).toContain('Tour deleted'));
  });

  it('filters tours and offers Clear filters when nothing matches', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    fireEvent.change(screen.getByPlaceholderText('Search tours'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No tours match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByTestId('tour-route-row')).toBeInTheDocument();
  });

  it('offers a New tour link', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    expect(screen.getByTestId('tour-new-route').closest('a')).toHaveAttribute('href', '/tour/routes/new');
  });
});


it('keeps tours readable for viewers but disables starting and ending them', async () => {
  useAuthStore.setState({ user: { ...MOCK_USER, role: 'viewer' } });
  renderWithProviders(<TourPage />, { withAuth: false });
  await screen.findByTestId('tour-route-row');
  expect(screen.queryByTestId('tour-new-route')).not.toBeInTheDocument();
  expect(screen.getByTestId('tour-read-only')).toHaveTextContent(/Read-only access/);

  const menu = await openRowMenu();
  for (const name of ['Start tour', 'Delete']) {
    const item = within(menu).getByRole('menuitem', { name });
    expect(item).toBeDisabled();
    fireEvent.click(item);
  }
  expect(api.startRoute).not.toHaveBeenCalled();
  // Opening a tour is not a write, so Edit stays — the editor it opens is
  // read-only for this role (see TourEditorPage).
  expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
  fireEvent.keyDown(menu, { key: 'Escape' });

  act(() => {
    useTourStore.getState().applyEvent({ type: 'agent:tour:started', robotId: 'g1', timestamp: 'x', tour: startedTour() });
  });
  const banner = await screen.findByTestId('tour-active-banner');
  const abort = within(banner).getByTestId('tour-abort');
  expect(abort).toBeDisabled();
  fireEvent.click(abort);
  // The row's own verb swapped to End tour, and it is refused as well.
  const live = await openRowMenu();
  expect(within(live).getByRole('menuitem', { name: 'End tour' })).toBeDisabled();
  expect(api.abortRoute).not.toHaveBeenCalled();
});
