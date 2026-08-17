/**
 * @file TourPage.test.tsx
 * @description The /tour page: tour cards with stops, duration, auto-greet and
 *              language; the visit history; the active-run banner fed by live
 *              events; and a refused start shown as a notice, not an error.
 * @feature tour
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { TourPage } from '../../pages/TourPage';
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
  useTourStore.getState().reset();
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

describe('TourPage', () => {
  it('lists tours with stops, duration, language and auto-greet, plus the visit history', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    const row = await screen.findByTestId('tour-route-row');
    expect(row).toHaveTextContent('ZeMA visitor tour');
    expect(row).toHaveTextContent('Alpha');
    expect(within(row).getByTestId('tour-route-stops')).toHaveTextContent('1');
    expect(within(row).getByTestId('tour-route-duration')).toHaveTextContent(/about/);
    expect(within(row).getByTestId('tour-route-autogreet')).toHaveTextContent('on');
    expect(row).toHaveTextContent('German');

    const runs = await screen.findAllByTestId('tour-run-row');
    expect(runs).toHaveLength(1);
    // The declined question is the number an operator acts on.
    expect(runs[0]).toHaveTextContent('1 declined');
    expect(screen.getByTestId('tour-page')).toBeInTheDocument();
    expect(screen.getByTestId('tour-kpi-questions')).toHaveTextContent('1 the facts did not cover');
  });

  it('opens the visit from anywhere in its row — the row highlights, so it has to be clickable', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    const row = (await screen.findAllByTestId('tour-run-row'))[0]!;
    expect(row).toHaveClass('cursor-pointer');
    fireEvent.click(within(row).getByText('visitor · de'));
    expect(navigateSpy).toHaveBeenCalledWith('/tour/runs/run-1');
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/tour/runs/run-1');
  });

  it('Start tour starts the tour on its robot; a refusal is a notice, not an error', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'person_too_close', message: 'Please give me a little room and I will lead the way.' });
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    fireEvent.click(screen.getByTestId('tour-start'));
    await waitFor(() => expect(api.startRoute).toHaveBeenCalledWith('route-1', 'g1'));
    const notice = await screen.findByTestId('tour-start-result');
    expect(notice).toHaveTextContent('Refused (person_too_close): Please give me a little room');

    api.startRoute.mockResolvedValue({ accepted: true, runId: 'run-2', message: 'started' });
    fireEvent.click(screen.getByTestId('tour-start'));
    await waitFor(() => expect(screen.getByTestId('tour-start-result')).toHaveTextContent('Tour started (run-2)'));
  });

  it('a live started event raises the banner with the current stop and swaps Start for End tour', async () => {
    api.abortRoute.mockResolvedValue({ ok: true, runId: 'run-3' });
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    expect(screen.queryByTestId('tour-active-banner')).toBeNull();
    act(() => {
      useTourStore.getState().applyEvent({
        type: 'agent:tour:started',
        robotId: 'g1',
        timestamp: 'x',
        tour: {
          ...run,
          runId: 'run-3',
          status: 'running',
          finishedAt: null,
          startedAt: '2026-08-17T13:00:00.000Z',
          turns: [],
          legs: [{ index: 0, stopId: 'stop-a', placeId: 'STAGING', name: 'Reception', status: 'running' }],
        },
      });
    });
    const banner = await screen.findByTestId('tour-active-banner');
    expect(banner).toHaveTextContent('ZeMA visitor tour');
    expect(within(banner).getByTestId('tour-banner-stop')).toHaveTextContent('at stop 1: Reception');
    expect(screen.queryByTestId('tour-start')).toBeNull();
    fireEvent.click(screen.getAllByTestId('tour-abort')[0]);
    await waitFor(() => expect(api.abortRoute).toHaveBeenCalledWith('route-1', 'g1'));
  });

  it('says the history could not be read instead of "No tours yet"', async () => {
    api.listRuns.mockRejectedValue(new Error('Network Error'));
    renderWithProviders(<TourPage />, { withAuth: false });
    const err = await screen.findByTestId('tour-runs-error');
    expect(err).toHaveTextContent('Network Error');
    expect(screen.queryByText(/No tours yet/i)).toBeNull();
    // …and the tiles must not assert zeros they could not count.
    expect(screen.getByTestId('tour-kpi-runs')).toHaveTextContent('—');
    expect(screen.getByTestId('tour-kpi-questions')).toHaveTextContent('history unavailable');
  });

  it('a failed refresh keeps the loaded tour cards on screen', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    act(() => {
      useTourStore.setState({ routesStatus: 'error', routesError: 'Network Error' });
    });
    expect(screen.getByTestId('tour-route-row')).toHaveTextContent('ZeMA visitor tour');
    expect(screen.getByTestId('tour-start')).toBeInTheDocument();
    expect(screen.queryByTestId('tour-routes-error')).toBeNull();
    expect(screen.getByTestId('tour-routes-stale')).toHaveTextContent('Network Error');
  });

  it('offers a New tour link', async () => {
    renderWithProviders(<TourPage />, { withAuth: false });
    await screen.findByTestId('tour-route-row');
    expect(screen.getByTestId('tour-new-route').closest('a')).toHaveAttribute('href', '/tour/routes/new');
  });
});
